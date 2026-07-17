export interface LoopClosureContext {
  readonly loopId: string;
  readonly toNumber?: string;
  readonly resultStatus: 'complete' | 'failed';
  readonly readinessScore: number;
  readonly reason: string;
  readonly episodeCount: number;
  readonly hostileEvaluations: number;
  readonly legitimateControls: number;
  readonly attackFamiliesCovered: number;
}

export interface LoopClosureReceipt {
  readonly conversationId: string;
  readonly callSid?: string;
}

export interface LoopClosurePort {
  requestClosure(context: LoopClosureContext): Promise<LoopClosureReceipt>;
  waitForSpokenResponse?(
    receipt: LoopClosureReceipt,
    context: LoopClosureContext,
  ): Promise<SpokenLoopClosure>;
}

export interface SpokenLoopClosure {
  readonly loopId: string;
  readonly conversationId: string;
  readonly response: string;
}
