import { createHash } from 'node:crypto';

import type {
  CalendarEnvironment,
  CalendarSchedulePort,
  CalendarScheduleResult,
  GoogleCalendarSandboxOptions,
  ScheduleSandboxScreenInput,
} from './types.js';
import { CalendarAdapterError } from './types.js';

const DEFAULT_API_BASE_URL = 'https://www.googleapis.com/calendar/v3/';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ATTENDEE_LENGTH = 254;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_CALENDAR_ID_LENGTH = 1_024;
const MIN_SCREEN_MS = 5 * 60 * 1_000;
const MAX_SCREEN_MS = 8 * 60 * 60 * 1_000;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const emailPattern = /^[^\s@]+@[^\s@]+$/;

interface ValidatedScheduleInput extends ScheduleSandboxScreenInput {
  readonly attendeeEmail: string;
  readonly title: string;
  readonly description: string;
}

interface EventIdentity {
  readonly id: string;
  readonly extendedProperties?: {
    readonly private?: Readonly<Record<string, unknown>>;
  };
}

interface PreparedEvent {
  readonly operationId: string;
  readonly eventId: string;
  readonly bindingHash: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export class GoogleCalendarSandboxAdapter implements CalendarSchedulePort {
  readonly #accessToken: string;
  readonly #apiBaseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sandboxCalendarId: string;
  readonly #timeoutMs: number;

  public constructor(options: GoogleCalendarSandboxOptions) {
    this.#accessToken = validateAccessToken(options.accessToken);
    this.#sandboxCalendarId = validateConfiguredCalendarId(options.sandboxCalendarId);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error('Google Calendar timeout must be between 1 and 60000 milliseconds');
    }

    this.#apiBaseUrl = normalizeApiBaseUrl(
      options.apiBaseUrl ?? DEFAULT_API_BASE_URL,
      options.allowInsecureHttp === true,
    );
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async scheduleScreen(
    rawInput: ScheduleSandboxScreenInput,
  ): Promise<CalendarScheduleResult> {
    if (rawInput.sandboxCalendarId !== this.#sandboxCalendarId) {
      throw new CalendarAdapterError(
        'calendar_not_allowed',
        'The requested calendar is not the configured sandbox calendar',
        false,
      );
    }

    const input = validateScheduleInput(rawInput);
    const prepared = prepareEvent(input);
    const collectionUrl = this.#eventCollectionUrl();
    collectionUrl.searchParams.set('sendUpdates', 'none');
    const response = await this.#request(collectionUrl, {
      method: 'POST',
      headers: this.#headers(true),
      body: JSON.stringify(prepared.body),
    });

    if (response.status === 409) {
      await this.#verifyExistingEvent(prepared);
      return sanitizedResult(prepared, true);
    }
    if (!response.ok) throwForHttpStatus(response.status);

    const created = await parseEventIdentity(response);
    assertExactBinding(created, prepared);
    return sanitizedResult(prepared, false);
  }

  async #verifyExistingEvent(prepared: PreparedEvent): Promise<void> {
    const response = await this.#request(this.#eventUrl(prepared.eventId), {
      method: 'GET',
      headers: this.#headers(false),
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) throw idempotencyConflict();
      throwForHttpStatus(response.status);
    }

    const existing = await parseEventIdentity(response);
    assertExactBinding(existing, prepared);
  }

  async #request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) {
        throw new CalendarAdapterError(
          'timeout',
          'Google Calendar did not respond before the configured timeout',
          true,
        );
      }
      throw new CalendarAdapterError(
        'upstream_failure',
        'Google Calendar could not be reached',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  #headers(hasBody: boolean): Headers {
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${this.#accessToken}`,
    });
    if (hasBody) headers.set('Content-Type', 'application/json');
    return headers;
  }

  #eventCollectionUrl(): URL {
    return new URL(
      `calendars/${encodeURIComponent(this.#sandboxCalendarId)}/events`,
      this.#apiBaseUrl,
    );
  }

  #eventUrl(eventId: string): URL {
    return new URL(
      `calendars/${encodeURIComponent(this.#sandboxCalendarId)}/events/${encodeURIComponent(eventId)}`,
      this.#apiBaseUrl,
    );
  }
}

export function createGoogleCalendarSandboxPort(
  options: GoogleCalendarSandboxOptions,
): CalendarSchedulePort {
  return new GoogleCalendarSandboxAdapter(options);
}

export function createGoogleCalendarSandboxPortFromEnv(
  environment: CalendarEnvironment = process.env,
): CalendarSchedulePort {
  const accessToken = requiredEnvironmentValue(environment, 'GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN');
  const sandboxCalendarId = requiredEnvironmentValue(environment, 'GOOGLE_CALENDAR_SANDBOX_ID');
  const timeout = environment.GOOGLE_CALENDAR_TIMEOUT_MS?.trim();

  return new GoogleCalendarSandboxAdapter({
    accessToken,
    sandboxCalendarId,
    ...(timeout === undefined || timeout === '' ? {} : { timeoutMs: parseTimeout(timeout) }),
  });
}

function validateScheduleInput(input: ScheduleSandboxScreenInput): ValidatedScheduleInput {
  validateIdentifier(input.episodeId, 'episodeId');
  validateIdentifier(input.evidenceId, 'evidenceId');
  validateIdentifier(input.candidateId, 'candidateId');
  validateIdentifier(input.roleId, 'roleId');

  const title = input.title.trim();
  if (
    title.length < 1 ||
    title.length > MAX_TITLE_LENGTH ||
    title.includes('\n') ||
    title.includes('\r') ||
    hasUnsafeTextControl(title)
  ) {
    throw invalidInput(`title must contain 1 to ${MAX_TITLE_LENGTH} safe characters`);
  }

  const description = input.description.trim();
  if (
    description.length < 1 ||
    description.length > MAX_DESCRIPTION_LENGTH ||
    hasUnsafeTextControl(description)
  ) {
    throw invalidInput(`description must contain 1 to ${MAX_DESCRIPTION_LENGTH} safe characters`);
  }

  const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
  if (
    attendeeEmail.length < 3 ||
    attendeeEmail.length > MAX_ATTENDEE_LENGTH ||
    !emailPattern.test(attendeeEmail) ||
    hasUnsafeTextControl(attendeeEmail)
  ) {
    throw invalidInput('attendeeEmail must be one valid email address of at most 254 characters');
  }

  const startMs = parseDateTime(input.startAt, 'startAt');
  const endMs = parseDateTime(input.endAt, 'endAt');
  const durationMs = endMs - startMs;
  if (durationMs < MIN_SCREEN_MS || durationMs > MAX_SCREEN_MS) {
    throw invalidInput('screen duration must be between 5 minutes and 8 hours');
  }

  return { ...input, attendeeEmail, title, description };
}

function prepareEvent(input: ValidatedScheduleInput): PreparedEvent {
  const operationKey = JSON.stringify([
    input.sandboxCalendarId,
    input.episodeId,
    input.evidenceId,
    input.candidateId,
    input.roleId,
  ]);
  const eventId = `screen${sha256(operationKey)}`;
  const operationId = `calendar${sha256(`operation:${operationKey}`)}`;
  const bindingHash = sha256(
    JSON.stringify([
      operationId,
      eventId,
      input.sandboxCalendarId,
      input.episodeId,
      input.evidenceId,
      input.candidateId,
      input.roleId,
      input.attendeeEmail,
      input.title,
      input.description,
      input.startAt,
      input.endAt,
    ]),
  );

  return {
    operationId,
    eventId,
    bindingHash,
    body: {
      id: eventId,
      summary: input.title,
      description: input.description,
      attendees: [{ email: input.attendeeEmail }],
      start: { dateTime: input.startAt },
      end: { dateTime: input.endAt },
      visibility: 'private',
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          loop_operation_id: operationId,
          loop_binding_hash: bindingHash,
          loop_episode_id: input.episodeId,
          loop_evidence_id: input.evidenceId,
          loop_candidate_id: input.candidateId,
          loop_role_id: input.roleId,
        },
      },
    },
  };
}

function sanitizedResult(
  prepared: PreparedEvent,
  idempotentReplay: boolean,
): CalendarScheduleResult {
  return {
    operationId: prepared.operationId,
    eventId: prepared.eventId,
    idempotentReplay,
  };
}

async function parseEventIdentity(response: Response): Promise<EventIdentity> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) throw protocolError();

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw protocolError();
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw protocolError();

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw protocolError();
  }
  if (typeof value !== 'object' || value === null) throw protocolError();
  const candidate = value as Partial<EventIdentity>;
  if (typeof candidate.id !== 'string') throw protocolError();
  return {
    id: candidate.id,
    ...(candidate.extendedProperties === undefined
      ? {}
      : { extendedProperties: candidate.extendedProperties }),
  };
}

function assertExactBinding(event: EventIdentity, prepared: PreparedEvent): void {
  const privateProperties = event.extendedProperties?.private;
  if (
    event.id !== prepared.eventId ||
    privateProperties?.loop_operation_id !== prepared.operationId ||
    privateProperties.loop_binding_hash !== prepared.bindingHash
  ) {
    throw idempotencyConflict();
  }
}

function throwForHttpStatus(status: number): never {
  if (status === 401) {
    throw new CalendarAdapterError(
      'authentication_failed',
      'Google Calendar rejected the configured OAuth access token',
      false,
    );
  }
  if (status === 403) {
    throw new CalendarAdapterError(
      'permission_denied',
      'The configured identity cannot write to the sandbox calendar',
      false,
    );
  }
  if (status === 429 || status >= 500) {
    throw new CalendarAdapterError(
      'upstream_failure',
      'Google Calendar was temporarily unavailable',
      true,
    );
  }
  throw new CalendarAdapterError(
    'protocol_error',
    'Google Calendar rejected the event request',
    false,
  );
}

function normalizeApiBaseUrl(value: string | URL, allowInsecureHttp: boolean): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) {
    throw new Error('Google Calendar API base URL must use HTTPS');
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Google Calendar API base URL is invalid');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function validateAccessToken(value: string): string {
  const token = value.trim();
  if (
    token.length < 16 ||
    token.length > 8_192 ||
    token !== value ||
    /\s/.test(token) ||
    hasAsciiControl(token)
  ) {
    throw new Error('Google Calendar OAuth access token is invalid');
  }
  return token;
}

function validateConfiguredCalendarId(value: string): string {
  const calendarId = value.trim();
  if (
    calendarId.length < 1 ||
    calendarId.length > MAX_CALENDAR_ID_LENGTH ||
    calendarId !== value ||
    calendarId.toLowerCase() === 'primary' ||
    hasAsciiControl(calendarId)
  ) {
    throw new Error('Google sandbox calendar ID is invalid');
  }
  return calendarId;
}

function validateIdentifier(value: string, field: string): void {
  if (value.length < 1 || value.length > MAX_IDENTIFIER_LENGTH || !identifierPattern.test(value)) {
    throw invalidInput(`${field} is invalid`);
  }
}

function parseDateTime(value: string, field: string): number {
  if (!rfc3339Pattern.test(value)) throw invalidInput(`${field} must be an RFC3339 date-time`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw invalidInput(`${field} must be an RFC3339 date-time`);
  return parsed;
}

function parseTimeout(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('GOOGLE_CALENDAR_TIMEOUT_MS must be an integer');
  return Number(value);
}

function requiredEnvironmentValue(environment: CalendarEnvironment, key: string): string {
  const value = environment[key];
  if (value === undefined || value.trim() === '') throw new Error(`${key} is required`);
  return value;
}

function invalidInput(message: string): CalendarAdapterError {
  return new CalendarAdapterError('invalid_input', message, false);
}

function idempotencyConflict(): CalendarAdapterError {
  return new CalendarAdapterError(
    'idempotency_conflict',
    'The deterministic calendar event ID is already bound to another operation',
    false,
  );
}

function protocolError(): CalendarAdapterError {
  return new CalendarAdapterError(
    'protocol_error',
    'Google Calendar returned an invalid event response',
    false,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hasUnsafeTextControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  });
}

function hasAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
