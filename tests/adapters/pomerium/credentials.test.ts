import { describe, expect, it } from 'vitest';

import {
  MissingPomeriumCredentialError,
  PomeriumCredentialResolver,
} from '../../../src/adapters/pomerium/credentials.js';

const jwt = 'eyJhbGciOiJIUzI1NiJ9.test-service-account-jwt';

describe('PomeriumCredentialResolver', () => {
  it('formats a raw service-account JWT exactly once', () => {
    const resolver = new PomeriumCredentialResolver({ 'outbound-sourcer': jwt });

    expect(resolver.authorizationHeader('outbound-sourcer')).toBe(`Bearer Pomerium-${jwt}`);
  });

  it('accepts the Pomerium-prefixed token form used by MCP clients', () => {
    const resolver = new PomeriumCredentialResolver({
      'hiring-controller': `Pomerium-${jwt}`,
    });

    expect(resolver.authorizationHeader('hiring-controller')).toBe(`Bearer Pomerium-${jwt}`);
  });

  it('fails with a sanitized identity-only error when a credential is absent', () => {
    const resolver = new PomeriumCredentialResolver({ 'white-verifier': jwt });

    expect(() => resolver.authorizationHeader('outbound-sourcer')).toThrow(
      MissingPomeriumCredentialError,
    );
    expect(() => resolver.authorizationHeader('outbound-sourcer')).toThrow(
      'Pomerium credential is unavailable for outbound-sourcer',
    );
  });
});
