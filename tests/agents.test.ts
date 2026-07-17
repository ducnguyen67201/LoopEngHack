import { describe, expect, it } from 'vitest';

import { validateSchedulingEvidence } from '../src/agents/controller-policy.js';
import {
  createBoundedMutation,
  learnFromReplay,
  selectTechnique,
} from '../src/agents/red-policy.js';
import {
  createRegression,
  createVerificationEvidence,
  diagnoseEvidenceGap,
  selectVerificationNeed,
} from '../src/agents/white-policy.js';
import { createInitialState } from '../src/engine/reducer.js';

describe('inspectable agent learning', () => {
  it('selects deterministically, mutates one family, and learns without mutating prior memory', () => {
    const before = createInitialState().redMemory;
    const selected = selectTechnique(before);
    const mutation = createBoundedMutation(selected);
    const after = learnFromReplay(before, selected, {
      reachedScreenRecommendation: true,
      reachedPrivilegedAction: false,
      detected: true,
      novelVariant: true,
      cost: 0,
      mutationId: mutation.toTemplateId,
    });

    expect(selected).toBe('authority_spoof');
    expect(mutation.technique).toBe(selected);
    expect(mutation.mutationCount).toBe(1);
    expect(before[selected].attempts).toBe(0);
    expect(after[selected]).toMatchObject({ attempts: 1, screeningWins: 1, detections: 1 });
  });

  it('builds digest-bound evidence and rejects a tampered copy', () => {
    const diagnosis = diagnoseEvidenceGap({
      technique: 'authority_spoof',
      screenRecommended: true,
      independentEvidencePresent: false,
      candidateClaimWasTreatedAsAuthority: true,
      schedulingAuthorizationDenied: true,
    });
    const need = selectVerificationNeed(diagnosis);
    const createdAt = '2026-07-17T18:00:00.000Z';
    const regression = createRegression({
      id: 'regression-1',
      episodeId: 'episode-1',
      diagnosis,
      verificationNeed: need,
      capabilityId: 'zero-capability-1',
      hostileCaseIds: ['hostile-1'],
      legitimateCaseIds: ['control-1'],
      falsePositiveCount: 0,
      createdAt,
    });
    const evidence = createVerificationEvidence({
      id: 'evidence-1',
      episodeId: 'episode-1',
      candidateId: 'candidate-control',
      roleId: 'role-1',
      regressionId: regression.id,
      capabilityId: regression.capabilityId,
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'evidence',
          digest: 'a'.repeat(64),
          metadata: { provider: 'zero' },
        },
      ],
      hostilePassed: true,
      legitimateControlPassed: true,
      falsePositiveCount: 0,
      createdAt,
    });
    const expected = {
      episodeId: evidence.episodeId,
      candidateId: evidence.candidateId,
      roleId: evidence.roleId,
      regressionId: evidence.regressionId,
      capabilityId: evidence.capabilityId,
    };

    expect(validateSchedulingEvidence(evidence, expected, createdAt)).toEqual({ ok: true });
    expect(
      validateSchedulingEvidence(
        { ...evidence, candidateId: 'candidate-attacker' },
        expected,
        createdAt,
      ),
    ).toEqual({ ok: false, reason: 'candidate_mismatch' });
  });
});
