import { actorToolMap } from '../../domain/schemas.js';
import type { ActorId, ToolName } from '../../domain/types.js';
import type { PomeriumIdentityClaims } from './jwt-verifier.js';

export interface VerifiedMachineIdentity extends PomeriumIdentityClaims {
  readonly actor: Exclude<ActorId, 'red-candidate' | 'arena'>;
}

export interface PomeriumAccessGuardOptions {
  readonly sourcerSubject: string;
  readonly controllerSubject: string;
  readonly verifierSubject?: string;
}

export class PomeriumAccessGuard {
  constructor(private readonly options: PomeriumAccessGuardOptions) {}

  resolve(claims: PomeriumIdentityClaims): VerifiedMachineIdentity {
    const actor = this.actorForSubject(claims.subject);
    if (actor === null) throw new PomeriumAccessDeniedError('unknown Pomerium machine identity');
    return { ...claims, actor };
  }

  requireTool(identity: VerifiedMachineIdentity, tool: ToolName): void {
    if (!(actorToolMap[identity.actor] as readonly ToolName[]).includes(tool)) {
      throw new PomeriumAccessDeniedError(`${identity.actor} cannot access ${tool}`);
    }
  }

  private actorForSubject(subject: string): VerifiedMachineIdentity['actor'] | null {
    if (subject === this.options.sourcerSubject) return 'outbound-sourcer';
    if (subject === this.options.controllerSubject) return 'hiring-controller';
    if (subject === this.options.verifierSubject) return 'white-verifier';
    return null;
  }
}

export class PomeriumAccessDeniedError extends Error {}
