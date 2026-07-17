import type {
  ArenaEvent,
  ArenaEventDraft,
  EpisodeRef,
  LoginResult,
  LoginScenarioInput,
  PromotionRequest,
  PromotionResult,
  RedAttackRequest,
  RedMapResult,
  TargetHealth,
  TargetVersion,
  ToolInputMap,
  ToolName,
  ToolOutputMap,
  WhiteLearnRequest,
  WhiteMemory,
  WhiteRemediationResult,
} from './types.js';

export interface TargetGateway {
  health(version: TargetVersion): Promise<TargetHealth>;
  login(version: TargetVersion, input: LoginScenarioInput): Promise<LoginResult>;
}

export interface PolicyToolGateway {
  call<Name extends ToolName>(name: Name, input: ToolInputMap[Name]): Promise<ToolOutputMap[Name]>;
}

export interface ArenaToolGateway {
  execute<Name extends ToolName>(
    name: Name,
    input: ToolInputMap[Name],
  ): Promise<ToolOutputMap[Name]>;
}

export interface AgentGateway {
  redMap(input: EpisodeRef): Promise<RedMapResult>;
  redAttack(input: RedAttackRequest): Promise<ToolOutputMap['arena_submit_attack']>;
  whiteRemediate(input: EpisodeRef): Promise<WhiteRemediationResult>;
  whiteLearn(input: WhiteLearnRequest): Promise<WhiteMemory>;
  promote(input: PromotionRequest): Promise<PromotionResult>;
}

export interface EventSink {
  append(event: ArenaEventDraft): ArenaEvent;
}

export interface Clock {
  now(): string;
  sleep(milliseconds: number): Promise<void>;
}

export interface IdGenerator {
  next(prefix: string): string;
}
