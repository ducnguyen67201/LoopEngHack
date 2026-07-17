import { createHash } from 'node:crypto';

import type { z } from 'zod';

import type { IdGenerator, RecruitingOpsPort } from '../../domain/ports.js';
import {
  createRoleCommandSchema,
  observationSchema,
  readCandidateEventCommandSchema,
  scheduleScreenCommandSchema,
  sendOutreachCommandSchema,
  sourceCandidatesCommandSchema,
} from '../../domain/schemas.js';
import type {
  CreateRoleCommand,
  ErrorCategory,
  ExecutionContext,
  Observation,
  ReadCandidateEventCommand,
  RiskSignal,
  ScheduleScreenCommand,
  SendOutreachCommand,
  SourceCandidatesCommand,
} from '../../domain/types.js';
import {
  type CandidateEventSignalCode,
  createRoleRequestSchema,
  createRoleResponseSchema,
  type OutboundRecruitingAllowlist,
  outboundAllowlistSchema,
  readCandidateEventRequestSchema,
  readCandidateEventResponseSchema,
  scheduleScreenRequestSchema,
  scheduleScreenResponseSchema,
  sendOutreachRequestSchema,
  sendOutreachResponseSchema,
  sourceCandidatesRequestSchema,
  sourceCandidatesResponseSchema,
} from './contracts.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const TOKEN_68 = /^[A-Za-z0-9._~+/-]+=*$/;

const ROUTES = Object.freeze({
  createRole: 'v1/sandbox/roles',
  sourceCandidates: 'v1/sandbox/candidates:source',
  sendOutreach: 'v1/sandbox/outreach:send',
  readCandidateEvent: 'v1/sandbox/candidate-events:read',
  scheduleScreen: 'v1/sandbox/screens:schedule',
});

type GatewayOperation = keyof typeof ROUTES;

interface ParsedAllowlist {
  readonly roleIds: ReadonlySet<string>;
  readonly candidateIds: ReadonlySet<string>;
  readonly templateIds: ReadonlySet<string>;
  readonly eventIds: ReadonlySet<string>;
  readonly sandboxIds: ReadonlySet<string>;
  readonly sandboxCalendarIds: ReadonlySet<string>;
}

export interface HttpOutboundRecruitingOpsPortOptions {
  /** Fixed sponsor/ATS gateway root. HTTPS is mandatory. */
  readonly baseUrl: string | URL;
  /** Raw token68 credential. Do not include the `Bearer ` prefix. */
  readonly bearerToken: string;
  readonly ids: IdGenerator;
  readonly allowlist: OutboundRecruitingAllowlist;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

class OutboundGatewayError extends Error {
  public constructor(
    public readonly category: ErrorCategory,
    public readonly summary: string,
  ) {
    super(summary);
  }
}

/**
 * Bounded HTTP RecruitingOpsPort for a sponsor-owned ATS gateway.
 *
 * It has five fixed routes and accepts no destination URL, recipient address, or message body.
 */
export class HttpOutboundRecruitingOpsPort implements RecruitingOpsPort {
  private readonly baseUrl: URL;
  private readonly bearerToken: string;
  private readonly ids: IdGenerator;
  private readonly allowlist: ParsedAllowlist;
  private readonly timeoutMs: number;
  private readonly baseFetch: typeof globalThis.fetch;

  public constructor(options: HttpOutboundRecruitingOpsPortOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    this.bearerToken = parseBearerToken(options.bearerToken);
    this.ids = options.ids;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`HTTP outbound timeout must be an integer from 1 to ${MAX_TIMEOUT_MS}.`);
    }
    this.baseFetch = options.fetch ?? globalThis.fetch;

    const allowlist = outboundAllowlistSchema.parse(options.allowlist);
    this.allowlist = {
      roleIds: new Set(allowlist.roleIds),
      candidateIds: new Set(allowlist.candidateIds),
      templateIds: new Set(allowlist.templateIds),
      eventIds: new Set(allowlist.eventIds),
      sandboxIds: new Set(allowlist.sandboxIds),
      sandboxCalendarIds: new Set(allowlist.sandboxCalendarIds),
    };
  }

  public async createRole(
    input: CreateRoleCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    if (
      !createRoleCommandSchema.safeParse(input).success ||
      !this.contextMatches(input, context, 'outbound-sourcer') ||
      !this.allowlist.roleIds.has(input.role.id) ||
      !this.allowlist.sandboxIds.has(input.role.sandboxId) ||
      !this.allowlist.sandboxCalendarIds.has(input.role.testCalendarId)
    ) {
      return this.error(context, 'contract_violation');
    }

    const request = createRoleRequestSchema.parse({
      schemaVersion: 1,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      role: input.role,
    });
    try {
      const response = await this.post('createRole', input, request, createRoleResponseSchema);
      if (response.roleId !== input.role.id || response.sandboxId !== input.role.sandboxId) {
        return this.error(context, 'contract_violation');
      }
      return this.success(context, {
        summary: response.replayed
          ? 'The outbound gateway returned the existing sandbox role.'
          : 'The outbound gateway created the sandbox recruiting role.',
        facts: [
          { key: 'role_id', value: response.roleId, sourceRef: response.operationId },
          { key: 'sandbox_id', value: response.sandboxId, sourceRef: response.operationId },
          { key: 'idempotent_replay', value: response.replayed, sourceRef: response.operationId },
        ],
        nextActions: ['recruiting_source_test_candidates'],
        artifacts: [
          {
            id: response.roleId,
            kind: 'role',
            metadata: {
              sandboxId: response.sandboxId,
              testCalendarId: input.role.testCalendarId,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromGatewayError(context, error);
    }
  }

  public async sourceCandidates(
    input: SourceCandidatesCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    if (
      !sourceCandidatesCommandSchema.safeParse(input).success ||
      !this.contextMatches(input, context, 'outbound-sourcer') ||
      !this.allowlist.roleIds.has(input.roleId) ||
      input.candidates.some(
        (candidate) =>
          !this.allowlist.candidateIds.has(candidate.id) || candidate.roleId !== input.roleId,
      )
    ) {
      return this.error(context, 'contract_violation');
    }

    const request = sourceCandidatesRequestSchema.parse({
      schemaVersion: 1,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      roleId: input.roleId,
      candidates: input.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        roleId: candidate.roleId,
        ...(candidate.claimId === undefined ? {} : { claimId: candidate.claimId }),
      })),
    });
    try {
      const response = await this.post(
        'sourceCandidates',
        input,
        request,
        sourceCandidatesResponseSchema,
      );
      const expectedIds = input.candidates.map(({ id }) => id);
      if (
        response.roleId !== input.roleId ||
        !sameStringArray(response.candidateIds, expectedIds)
      ) {
        return this.error(context, 'contract_violation');
      }
      return this.success(context, {
        summary: response.replayed
          ? 'The outbound gateway returned the existing controlled candidate set.'
          : 'The outbound gateway sourced the controlled candidate set.',
        facts: [
          { key: 'role_id', value: response.roleId, sourceRef: response.operationId },
          {
            key: 'candidate_count',
            value: response.candidateIds.length,
            sourceRef: response.operationId,
          },
          { key: 'idempotent_replay', value: response.replayed, sourceRef: response.operationId },
        ],
        nextActions: ['recruiting_send_test_outreach'],
        artifacts: input.candidates.map((candidate) => ({
          id: candidate.id,
          kind: 'candidate' as const,
          metadata: { kind: candidate.kind, roleId: candidate.roleId },
        })),
      });
    } catch (error) {
      return this.fromGatewayError(context, error);
    }
  }

  public async sendOutreach(
    input: SendOutreachCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    if (
      !sendOutreachCommandSchema.safeParse(input).success ||
      !this.contextMatches(input, context, 'outbound-sourcer') ||
      !this.allowlist.roleIds.has(input.roleId) ||
      !this.allowlist.candidateIds.has(input.candidateId) ||
      !this.allowlist.templateIds.has(input.templateId)
    ) {
      return this.error(context, 'contract_violation');
    }

    const request = sendOutreachRequestSchema.parse({
      schemaVersion: 1,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      roleId: input.roleId,
      candidateId: input.candidateId,
      templateId: input.templateId,
    });
    try {
      const response = await this.post('sendOutreach', input, request, sendOutreachResponseSchema);
      if (response.candidateId !== input.candidateId || response.templateId !== input.templateId) {
        return this.error(context, 'contract_violation');
      }
      return this.success(context, {
        summary: response.replayed
          ? 'The outbound gateway returned the existing sandbox outreach operation.'
          : 'The outbound gateway sent an approved template to the controlled candidate.',
        facts: [
          { key: 'candidate_id', value: response.candidateId, sourceRef: response.operationId },
          { key: 'template_id', value: response.templateId, sourceRef: response.operationId },
          { key: 'idempotent_replay', value: response.replayed, sourceRef: response.operationId },
        ],
        nextActions: ['recruiting_read_pipeline_event'],
        artifacts: [
          {
            id: response.messageId,
            kind: 'message',
            metadata: {
              candidateId: response.candidateId,
              templateId: response.templateId,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromGatewayError(context, error);
    }
  }

  public async readCandidateEvent(
    input: ReadCandidateEventCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    if (
      !readCandidateEventCommandSchema.safeParse(input).success ||
      !this.contextMatches(input, context, 'outbound-sourcer') ||
      !this.allowlist.candidateIds.has(input.candidateId) ||
      !this.allowlist.eventIds.has(input.eventId)
    ) {
      return this.error(context, 'contract_violation');
    }

    const request = readCandidateEventRequestSchema.parse({
      schemaVersion: 1,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      candidateId: input.candidateId,
      eventId: input.eventId,
    });
    try {
      const response = await this.post(
        'readCandidateEvent',
        input,
        request,
        readCandidateEventResponseSchema,
      );
      if (response.candidateId !== input.candidateId || response.eventId !== input.eventId) {
        return this.error(context, 'contract_violation');
      }
      const requiresVerification =
        response.screenRecommended && !response.independentEvidencePresent;
      return this.success(context, {
        status: requiresVerification ? 'warning' : 'success',
        summary: requiresVerification
          ? 'The outbound gateway reported a candidate event that requires verification.'
          : 'The outbound gateway reported a bounded candidate event.',
        facts: [
          { key: 'candidate_id', value: response.candidateId, sourceRef: response.operationId },
          {
            key: 'screen_recommended',
            value: response.screenRecommended,
            sourceRef: response.operationId,
          },
          {
            key: 'independent_evidence_present',
            value: response.independentEvidencePresent,
            sourceRef: response.operationId,
          },
        ],
        riskSignals: response.signalCodes.map(mapSignal),
        uncertainties: requiresVerification
          ? ['The candidate event has not been independently verified.']
          : [],
        nextActions: requiresVerification ? ['recruiting_request_screen'] : [],
        artifacts: [
          {
            id: response.eventId,
            kind: 'claim',
            metadata: {
              candidateId: response.candidateId,
              eventType: response.eventType,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromGatewayError(context, error);
    }
  }

  public async scheduleScreen(
    input: ScheduleScreenCommand,
    context: ExecutionContext,
  ): Promise<Observation> {
    if (
      !scheduleScreenCommandSchema.safeParse(input).success ||
      !this.contextMatches(input, context, 'hiring-controller') ||
      !this.allowlist.roleIds.has(input.roleId) ||
      !this.allowlist.candidateIds.has(input.candidateId) ||
      !this.allowlist.sandboxCalendarIds.has(input.sandboxCalendarId)
    ) {
      return this.error(context, 'contract_violation');
    }

    const request = scheduleScreenRequestSchema.parse({
      schemaVersion: 1,
      episodeId: input.episodeId,
      attemptId: input.attemptId,
      candidateId: input.candidateId,
      roleId: input.roleId,
      evidenceId: input.evidenceId,
      sandboxCalendarId: input.sandboxCalendarId,
    });
    try {
      const response = await this.post(
        'scheduleScreen',
        input,
        request,
        scheduleScreenResponseSchema,
      );
      if (
        response.candidateId !== input.candidateId ||
        response.roleId !== input.roleId ||
        response.sandboxCalendarId !== input.sandboxCalendarId
      ) {
        return this.error(context, 'contract_violation');
      }
      return this.success(context, {
        summary: response.replayed
          ? 'The outbound gateway returned the existing sandbox screen.'
          : 'The outbound gateway scheduled one screen on the sandbox calendar.',
        facts: [
          {
            key: 'calendar_event_id',
            value: response.calendarEventId,
            sourceRef: response.operationId,
          },
          { key: 'candidate_id', value: response.candidateId, sourceRef: response.operationId },
          { key: 'idempotent_replay', value: response.replayed, sourceRef: response.operationId },
        ],
        nextActions: ['episode_complete'],
        artifacts: [
          {
            id: response.calendarEventId,
            kind: 'calendar',
            metadata: {
              candidateId: response.candidateId,
              roleId: response.roleId,
              evidenceId: input.evidenceId,
              sandboxCalendarId: response.sandboxCalendarId,
            },
          },
        ],
      });
    } catch (error) {
      return this.fromGatewayError(context, error);
    }
  }

  private contextMatches(
    input: Readonly<{ episodeId: string; attemptId: string }>,
    context: ExecutionContext,
    actor: 'outbound-sourcer' | 'hiring-controller',
  ): boolean {
    return (
      input.episodeId === context.episodeId &&
      input.attemptId === context.attemptId &&
      context.actor === actor &&
      context.phase === 'execute'
    );
  }

  private async post<T>(
    operation: GatewayOperation,
    input: Readonly<{ episodeId: string; attemptId: string; tool: string }>,
    body: unknown,
    responseSchema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.baseFetch(new URL(ROUTES[operation], this.baseUrl), {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.bearerToken}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey(input),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new OutboundGatewayError(
        'upstream_failure',
        'The outbound gateway operation did not complete.',
      );
    }

    if (!response.ok) {
      const category = classifyHttpFailure(response.status);
      throw new OutboundGatewayError(category, errorSummary(category));
    }
    if (!JSON_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) {
      throw invalidResponse();
    }
    const contentLength = response.headers.get('content-length');
    if (
      contentLength !== null &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > MAX_RESPONSE_BYTES
    ) {
      throw invalidResponse();
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new OutboundGatewayError(
        'upstream_failure',
        'The outbound gateway operation did not complete.',
      );
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw invalidResponse();

    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw invalidResponse();
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  }

  private success(
    context: ExecutionContext,
    details: Pick<Observation, 'summary' | 'facts' | 'nextActions' | 'artifacts'> &
      Partial<Pick<Observation, 'status' | 'riskSignals' | 'uncertainties'>>,
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.ids.next('http-outbound-observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: details.status ?? 'success',
      summary: details.summary,
      facts: details.facts,
      riskSignals: details.riskSignals ?? [],
      uncertainties: details.uncertainties ?? [],
      nextActions: details.nextActions,
      artifacts: details.artifacts,
      provenance: 'recruiting-pipeline',
      occurredAt: context.occurredAt,
    });
  }

  private fromGatewayError(context: ExecutionContext, error: unknown): Observation {
    return error instanceof OutboundGatewayError
      ? this.error(context, error.category, error.summary)
      : this.error(context, 'upstream_failure');
  }

  private error(
    context: ExecutionContext,
    category: ErrorCategory,
    summary = errorSummary(category),
  ): Observation {
    return observationSchema.parse({
      schemaVersion: 1,
      id: this.ids.next('http-outbound-observation'),
      episodeId: context.episodeId,
      attemptId: context.attemptId,
      turn: context.turn,
      actor: context.actor,
      phase: context.phase,
      status: 'error',
      errorCategory: category,
      summary,
      facts: [],
      riskSignals: [],
      uncertainties:
        category === 'upstream_failure'
          ? ['The remote operation outcome is unknown until reconciled by idempotency key.']
          : [],
      nextActions: [],
      artifacts: [],
      recovery: recoveryFor(category),
      provenance: 'recruiting-pipeline',
      occurredAt: context.occurredAt,
    });
  }
}

function parseBaseUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input.toString());
  } catch {
    throw new Error('HTTP outbound base URL must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw new Error('HTTP outbound base URL must use HTTPS.');
  if (url.username !== '' || url.password !== '') {
    throw new Error('HTTP outbound base URL must not contain credentials.');
  }
  if (url.search !== '') throw new Error('HTTP outbound base URL must not contain a query.');
  if (url.hash !== '') throw new Error('HTTP outbound base URL must not contain a fragment.');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

function parseBearerToken(token: string): string {
  if (token.length < 1 || token.length > 4_096 || !TOKEN_68.test(token)) {
    throw new Error('HTTP outbound bearer token must be a raw token68 credential.');
  }
  return token;
}

function idempotencyKey(
  input: Readonly<{ episodeId: string; attemptId: string; tool: string }>,
): string {
  const canonical = JSON.stringify([input.episodeId, input.attemptId, input.tool]);
  return `outbound-${createHash('sha256').update(canonical).digest('hex')}`;
}

function sameStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function mapSignal(code: CandidateEventSignalCode): RiskSignal {
  switch (code) {
    case 'candidate_authority_claim':
      return {
        code,
        severity: 'high',
        summary: 'Candidate-provided authority was not independently verified.',
      };
    case 'candidate_urgency_claim':
      return {
        code,
        severity: 'medium',
        summary: 'Candidate-provided urgency is not authorization evidence.',
      };
    case 'portfolio_instruction':
      return {
        code,
        severity: 'high',
        summary: 'Candidate-controlled portfolio content contained an instruction.',
      };
    case 'credential_mismatch':
      return {
        code,
        severity: 'high',
        summary: 'The candidate credential claim requires independent verification.',
      };
  }
}

function classifyHttpFailure(status: number): ErrorCategory {
  if (status === 401 || status === 403) return 'authorization_denied';
  if (status === 400 || status === 409 || status === 422) return 'contract_violation';
  return 'upstream_failure';
}

function invalidResponse(): OutboundGatewayError {
  return new OutboundGatewayError(
    'contract_violation',
    'The outbound gateway returned an invalid response contract.',
  );
}

function errorSummary(category: ErrorCategory): string {
  switch (category) {
    case 'authorization_denied':
      return 'The outbound gateway rejected the configured machine credential.';
    case 'contract_violation':
      return 'The outbound operation violated its bounded contract.';
    case 'upstream_failure':
      return 'The outbound gateway operation did not complete.';
    case 'capability_unavailable':
    case 'invalid_evidence':
    case 'budget_exceeded':
      return 'The outbound operation failed closed.';
  }
}

function recoveryFor(category: ErrorCategory): Observation['recovery'] {
  if (category === 'upstream_failure') {
    return {
      rootCauseHint: 'The HTTPS request failed, timed out, or returned an unavailable status.',
      safeRetry: 'Reconcile or retry the same command with its unchanged idempotency key.',
      stopCondition: 'Stop after a repeated failure with the same idempotency key.',
    };
  }
  if (category === 'authorization_denied') {
    return {
      rootCauseHint: 'The sponsor gateway rejected the configured machine credential.',
      safeRetry: null,
      stopCondition: 'Stop until an operator restores the configured credential or policy.',
    };
  }
  return {
    rootCauseHint: 'The local command, allowlist, or gateway response violated the fixed contract.',
    safeRetry: null,
    stopCondition: 'Stop and correct the contract or allowlist before retrying.',
  };
}
