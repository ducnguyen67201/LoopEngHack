import { describe, expect, it } from 'vitest';

import { validateSchedulingEvidence } from '../src/agents/controller-policy.js';
import { learnFromReplay, selectTechnique } from '../src/agents/red-policy.js';
import {
  computeCanonicalDigest,
  createRegression,
  createVerificationEvidence,
  diagnoseEvidenceGap,
  selectVerificationNeed,
} from '../src/agents/white-policy.js';
import type { VerificationEvidence } from '../src/domain/types.js';
import { createInitialState } from '../src/engine/reducer.js';

const createdAt = '2026-07-17T18:00:00.000Z';

function validEvidence(): VerificationEvidence {
  const diagnosis = diagnoseEvidenceGap({
    technique: 'authority_spoof',
    screenRecommended: true,
    independentEvidencePresent: false,
    candidateClaimWasTreatedAsAuthority: true,
    schedulingAuthorizationDenied: true,
  });
  const regression = createRegression({
    id: 'regression-edge',
    episodeId: 'episode-edge',
    diagnosis,
    verificationNeed: selectVerificationNeed(diagnosis),
    capabilityId: 'capability-edge',
    hostileCaseIds: ['hostile-edge'],
    legitimateCaseIds: ['control-edge'],
    falsePositiveCount: 0,
    createdAt,
  });
  return createVerificationEvidence({
    id: 'evidence-edge',
    episodeId: 'episode-edge',
    candidateId: 'candidate-edge',
    roleId: 'role-edge',
    regressionId: regression.id,
    capabilityId: regression.capabilityId,
    artifacts: [
      {
        id: 'artifact-edge',
        kind: 'evidence',
        digest: 'a'.repeat(64),
        metadata: { source: 'zero' },
      },
    ],
    hostilePassed: true,
    legitimateControlPassed: true,
    falsePositiveCount: 0,
    createdAt,
  });
}

describe('controller evidence rejection reasons', () => {
  it('rejects missing and mismatched references before a side effect', () => {
    const evidence = validEvidence();
    const expected = {
      episodeId: evidence.episodeId,
      candidateId: evidence.candidateId,
      roleId: evidence.roleId,
      regressionId: evidence.regressionId,
      capabilityId: evidence.capabilityId,
      artifactHash: evidence.artifactHash,
    };

    expect(validateSchedulingEvidence(undefined, expected, createdAt)).toEqual({
      ok: false,
      reason: 'missing_evidence',
    });
    const cases = [
      [{ ...evidence, episodeId: 'wrong' }, 'episode_mismatch'],
      [{ ...evidence, candidateId: 'wrong' }, 'candidate_mismatch'],
      [{ ...evidence, roleId: 'wrong' }, 'role_mismatch'],
      [{ ...evidence, regressionId: 'wrong' }, 'regression_mismatch'],
    ] as const;
    for (const [candidate, reason] of cases) {
      expect(validateSchedulingEvidence(candidate, expected, createdAt)).toEqual({
        ok: false,
        reason,
      });
    }
    expect(
      validateSchedulingEvidence(evidence, { ...expected, capabilityId: 'wrong' }, createdAt),
    ).toEqual({ ok: false, reason: 'capability_mismatch' });
    expect(
      validateSchedulingEvidence(
        evidence,
        { ...expected, artifactHash: 'b'.repeat(64) },
        createdAt,
      ),
    ).toEqual({ ok: false, reason: 'artifact_hash_mismatch' });
  });

  it('rejects incomplete results, stale evidence, and digest tampering', () => {
    const evidence = validEvidence();
    const expected = {
      episodeId: evidence.episodeId,
      candidateId: evidence.candidateId,
      roleId: evidence.roleId,
      regressionId: evidence.regressionId,
    };
    const invalidCases = [
      [{ ...evidence, artifactIds: [] }, 'missing_verification_artifact'],
      [{ ...evidence, artifactIds: ['duplicate', 'duplicate'] }, 'invalid_verification_artifact'],
      [{ ...evidence, hostilePassed: false }, 'hostile_test_failed'],
      [{ ...evidence, legitimateControlPassed: false }, 'legitimate_control_failed'],
      [{ ...evidence, falsePositiveCount: 1 }, 'false_positive_detected'],
      [{ ...evidence, createdAt: 'not-a-date' }, 'invalid_timestamp'],
    ] as const;
    for (const [candidate, reason] of invalidCases) {
      expect(
        validateSchedulingEvidence(candidate as VerificationEvidence, expected, createdAt),
      ).toEqual({ ok: false, reason });
    }
    expect(validateSchedulingEvidence(evidence, expected, '2026-07-17T17:59:59.000Z')).toEqual({
      ok: false,
      reason: 'future_evidence',
    });
    expect(validateSchedulingEvidence(evidence, expected, '2026-07-17T19:00:00.000Z')).toEqual({
      ok: false,
      reason: 'stale_evidence',
    });
    expect(
      validateSchedulingEvidence({ ...evidence, digest: 'b'.repeat(64) }, expected, createdAt),
    ).toEqual({ ok: false, reason: 'digest_mismatch' });
  });
});

describe('policy edge behavior', () => {
  it('selects a higher score and records both privileged and shallow outcomes', () => {
    const memory = createInitialState().redMemory;
    memory.urgency_pressure.successReward = 10;
    expect(selectTechnique(memory)).toBe('urgency_pressure');

    const privileged = learnFromReplay(memory, 'urgency_pressure', {
      reachedScreenRecommendation: true,
      reachedPrivilegedAction: true,
      detected: false,
      novelVariant: false,
      cost: 2,
    });
    expect(privileged.urgency_pressure).toMatchObject({
      privilegedActionWins: 1,
      bypassDepth: 2,
      lastMutation: null,
    });
    const shallow = learnFromReplay(memory, 'credential_mismatch', {
      reachedScreenRecommendation: false,
      reachedPrivilegedAction: false,
      detected: false,
      novelVariant: false,
      cost: 0,
    });
    expect(shallow.credential_mismatch.bypassDepth).toBe(0);
  });

  it('routes portfolio and credential gaps to their bounded verification needs', () => {
    const portfolio = diagnoseEvidenceGap({
      technique: 'portfolio_prompt_injection',
      screenRecommended: false,
      independentEvidencePresent: false,
      candidateClaimWasTreatedAsAuthority: false,
      schedulingAuthorizationDenied: false,
    });
    const credential = diagnoseEvidenceGap({
      technique: 'credential_mismatch',
      screenRecommended: false,
      independentEvidencePresent: true,
      candidateClaimWasTreatedAsAuthority: false,
      schedulingAuthorizationDenied: false,
    });
    expect(selectVerificationNeed(portfolio)).toBe('public_page_capture');
    expect(selectVerificationNeed(credential)).toBe('public_claim_lookup');
  });

  it('rejects empty evidence/regressions and non-canonical hash inputs', () => {
    const diagnosis = diagnoseEvidenceGap({
      technique: 'authority_spoof',
      screenRecommended: false,
      independentEvidencePresent: true,
      candidateClaimWasTreatedAsAuthority: false,
      schedulingAuthorizationDenied: true,
    });
    expect(() =>
      createRegression({
        id: 'regression-empty',
        episodeId: 'episode-edge',
        diagnosis,
        verificationNeed: 'public_claim_lookup',
        capabilityId: 'capability-edge',
        hostileCaseIds: [],
        legitimateCaseIds: ['control'],
        falsePositiveCount: 0,
        createdAt,
      }),
    ).toThrow(/hostile and legitimate/);
    expect(() =>
      createVerificationEvidence({
        id: 'evidence-empty',
        episodeId: 'episode-edge',
        candidateId: 'candidate-edge',
        roleId: 'role-edge',
        regressionId: 'regression-edge',
        capabilityId: 'capability-edge',
        artifacts: [],
        hostilePassed: true,
        legitimateControlPassed: true,
        falsePositiveCount: 0,
        createdAt,
      }),
    ).toThrow(/at least one artifact/);
    expect(computeCanonicalDigest({ b: -0, a: [true, null] })).toHaveLength(64);
    expect(() => computeCanonicalDigest(Number.NaN)).toThrow(/finite numbers/);
    expect(() => computeCanonicalDigest(undefined)).toThrow(/undefined/);
    expect(() => computeCanonicalDigest(new Date())).toThrow(/plain objects/);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => computeCanonicalDigest(cyclic)).toThrow(/cyclic/);
  });
});
