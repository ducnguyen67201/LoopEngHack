import type {
  AuthorizeToolCommand,
  CreateRoleCommand,
  DiscoverCapabilityCommand,
  ExecutionContext,
  GameEvent,
  InvokeCapabilityCommand,
  Observation,
  ReadCandidateEventCommand,
  ScheduleScreenCommand,
  SendOutreachCommand,
  SourceCandidatesCommand,
} from './types.js';

export interface RecruitingOpsPort {
  createRole(input: CreateRoleCommand, context: ExecutionContext): Promise<Observation>;
  sourceCandidates(input: SourceCandidatesCommand, context: ExecutionContext): Promise<Observation>;
  sendOutreach(input: SendOutreachCommand, context: ExecutionContext): Promise<Observation>;
  readCandidateEvent(
    input: ReadCandidateEventCommand,
    context: ExecutionContext,
  ): Promise<Observation>;
  scheduleScreen(input: ScheduleScreenCommand, context: ExecutionContext): Promise<Observation>;
}
export interface ZeroPort {
  discover(input: DiscoverCapabilityCommand, context: ExecutionContext): Promise<Observation>;
  invoke(input: InvokeCapabilityCommand, context: ExecutionContext): Promise<Observation>;
}
export interface PolicyPort {
  authorize(input: AuthorizeToolCommand, context: ExecutionContext): Promise<Observation>;
}
export interface EventSink {
  append(event: GameEvent): void;
}
export interface Clock {
  now(): string;
}
export interface IdGenerator {
  next(prefix: string): string;
}
