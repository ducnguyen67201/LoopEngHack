export type CalendarAdapterFailureKind =
  | 'invalid_input'
  | 'calendar_not_allowed'
  | 'authentication_failed'
  | 'permission_denied'
  | 'idempotency_conflict'
  | 'timeout'
  | 'upstream_failure'
  | 'protocol_error';

export class CalendarAdapterError extends Error {
  public override readonly name = 'CalendarAdapterError';

  public constructor(
    public readonly kind: CalendarAdapterFailureKind,
    message: string,
    public readonly retriable: boolean,
  ) {
    super(message);
  }
}

/** Server-owned, evidence-bound input for one sandbox screening event. */
export interface ScheduleSandboxScreenInput {
  readonly sandboxCalendarId: string;
  readonly episodeId: string;
  readonly evidenceId: string;
  readonly candidateId: string;
  readonly roleId: string;
  readonly attendeeEmail: string;
  readonly title: string;
  readonly description: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** Deliberately excludes Calendar URLs, attendee data, and provider diagnostics. */
export interface CalendarScheduleResult {
  readonly operationId: string;
  readonly eventId: string;
  readonly idempotentReplay: boolean;
}

export interface CalendarSchedulePort {
  scheduleScreen(input: ScheduleSandboxScreenInput): Promise<CalendarScheduleResult>;
}

/** Compatibility aliases for callers that prefer provider-specific names. */
export type GoogleCalendarSandboxPort = CalendarSchedulePort;
export type ScheduleSandboxScreenResult = CalendarScheduleResult;

export interface GoogleCalendarSandboxOptions {
  readonly accessToken: string;
  readonly sandboxCalendarId: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly apiBaseUrl?: string | URL;
  /** Local-test escape hatch only. Production Calendar API traffic must use HTTPS. */
  readonly allowInsecureHttp?: boolean;
}

export type GoogleCalendarSandboxPortOptions = GoogleCalendarSandboxOptions;
export type CalendarAdapterErrorKind = CalendarAdapterFailureKind;

export type CalendarEnvironment = Readonly<Record<string, string | undefined>>;
