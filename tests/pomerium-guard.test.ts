import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PomeriumAccessDeniedError,
  PomeriumAccessGuard,
  PomeriumJwtVerifier,
  PomeriumPolicyPort,
} from '../src/adapters/pomerium/index.js';
import { NamespacedIdGenerator } from '../src/runtime/primitives.js';

describe('Pomerium application-layer guard', () => {
  it('verifies the signed assertion and enforces the actor tool map', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    jwk.kid = 'test-key';
    const nowSeconds = 1_784_320_000;
    const assertion = jwt(
      privateKey,
      { alg: 'ES256', kid: 'test-key' },
      {
        sub: 'sourcer-service-account',
        iss: 'https://auth.example.test',
        aud: 'https://arena.example.test',
        exp: nowSeconds + 300,
      },
    );
    const verifier = new PomeriumJwtVerifier({
      jwksUrl: 'https://arena.example.test/.well-known/pomerium/jwks.json',
      issuer: 'https://auth.example.test',
      audience: 'https://arena.example.test',
      now: () => nowSeconds * 1000,
      fetch: () => Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })),
    });
    const guard = new PomeriumAccessGuard({
      sourcerSubject: 'sourcer-service-account',
      controllerSubject: 'controller-service-account',
    });

    const identity = guard.resolve(await verifier.verify(assertion));
    expect(identity.actor).toBe('outbound-sourcer');
    expect(() => guard.requireTool(identity, 'recruiting_schedule_screen')).toThrow(
      PomeriumAccessDeniedError,
    );
    expect(() => guard.requireTool(identity, 'recruiting_read_pipeline_event')).not.toThrow();
  });

  it('does not misreport an expired or unknown service identity as tool-policy proof', async () => {
    const port = new PomeriumPolicyPort({
      runId: 'identity-denial-run',
      ids: new NamespacedIdGenerator('identity-denial'),
      clients: {
        'outbound-sourcer': {
          callTool: () =>
            Promise.resolve({
              status: 'denied' as const,
              kind: 'identity_denied' as const,
              summary: 'Pomerium rejected the service identity',
              retriable: false,
            }),
        },
      },
    });
    const observation = await port.authorize(
      {
        episodeId: 'identity-denial-episode',
        attemptId: 'identity-denial-attempt',
        actor: 'outbound-sourcer',
        tool: 'recruiting_schedule_screen',
      },
      {
        episodeId: 'identity-denial-episode',
        attemptId: 'identity-denial-attempt',
        actor: 'outbound-sourcer',
        turn: 3,
        phase: 'authorize',
        occurredAt: '2026-07-17T20:00:00.000Z',
      },
    );

    expect(observation).toMatchObject({
      status: 'error',
      errorCategory: 'upstream_failure',
      provenance: 'pomerium-authorize-log',
    });
    expect(observation.authorization).toBeUndefined();
  });
});

function jwt(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
