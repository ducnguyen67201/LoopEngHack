import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface PomeriumIdentityClaims {
  readonly subject: string;
  readonly email?: string;
  readonly groups: readonly string[];
}

export interface PomeriumJwtVerifierOptions {
  readonly jwksUrl: string | URL;
  readonly issuer: string;
  readonly audience: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly cacheMs?: number;
  readonly clockSkewSeconds?: number;
  readonly now?: () => number;
}

interface JwtHeader {
  readonly alg: string;
  readonly kid: string;
}

interface JwtPayload {
  readonly sub?: unknown;
  readonly email?: unknown;
  readonly groups?: unknown;
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly nbf?: unknown;
}

interface JwkDocument {
  readonly keys: JsonWebKey[];
}

export class PomeriumJwtVerifier {
  private readonly audience: string;
  private readonly baseFetch: typeof globalThis.fetch;
  private readonly cacheMs: number;
  private readonly clockSkewSeconds: number;
  private readonly issuer: string;
  private readonly jwksUrl: URL;
  private readonly now: () => number;
  private cached: { expiresAt: number; keys: JsonWebKey[] } | null = null;

  constructor(options: PomeriumJwtVerifierOptions) {
    this.jwksUrl = new URL(options.jwksUrl);
    if (this.jwksUrl.protocol !== 'https:') throw new Error('Pomerium JWKS URL must use HTTPS');
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.baseFetch = options.fetch ?? globalThis.fetch;
    this.cacheMs = options.cacheMs ?? 300_000;
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
    this.now = options.now ?? Date.now;
  }

  async verify(assertion: string): Promise<PomeriumIdentityClaims> {
    if (assertion.length < 32 || assertion.length > 16_384) {
      throw new Error('Pomerium assertion has an invalid length');
    }
    const parts = assertion.split('.');
    if (parts.length !== 3) throw new Error('Pomerium assertion is not a compact JWT');
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (
      encodedHeader === undefined ||
      encodedPayload === undefined ||
      encodedSignature === undefined
    ) {
      throw new Error('Pomerium assertion is incomplete');
    }
    const header = decodeJson<JwtHeader>(encodedHeader);
    const payload = decodeJson<JwtPayload>(encodedPayload);
    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || header.kid === '') {
      throw new Error('Pomerium assertion must use ES256 with a key id');
    }

    let key = (await this.keys()).find((candidate) => isSupportedSigningKey(candidate, header.kid));
    if (key === undefined) {
      key = (await this.keys(true)).find((candidate) =>
        isSupportedSigningKey(candidate, header.kid),
      );
    }
    if (key === undefined) throw new Error('Pomerium assertion signing key was not found');
    const verified = verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
      { key: createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!verified) throw new Error('Pomerium assertion signature is invalid');

    this.validateClaims(payload);
    const claims: PomeriumIdentityClaims = {
      subject: payload.sub,
      groups: Array.isArray(payload.groups)
        ? payload.groups.filter((group): group is string => typeof group === 'string')
        : [],
    };
    return typeof payload.email === 'string' ? { ...claims, email: payload.email } : claims;
  }

  private validateClaims(payload: JwtPayload): asserts payload is JwtPayload & { sub: string } {
    const nowSeconds = Math.floor(this.now() / 1000);
    if (payload.iss !== this.issuer) throw new Error('Pomerium assertion issuer is invalid');
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(this.audience))
      throw new Error('Pomerium assertion audience is invalid');
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new Error('Pomerium assertion subject is missing');
    }
    if (typeof payload.exp !== 'number' || payload.exp < nowSeconds - this.clockSkewSeconds) {
      throw new Error('Pomerium assertion is expired');
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + this.clockSkewSeconds) {
      throw new Error('Pomerium assertion is not active yet');
    }
  }

  private async keys(forceRefresh = false): Promise<JsonWebKey[]> {
    const now = this.now();
    if (!forceRefresh && this.cached !== null && this.cached.expiresAt > now) {
      return this.cached.keys;
    }
    const response = await this.baseFetch(this.jwksUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Pomerium JWKS request failed with HTTP ${response.status}`);
    const body = (await response.json()) as Partial<JwkDocument>;
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error('Pomerium JWKS did not contain any keys');
    }
    this.cached = { expiresAt: now + this.cacheMs, keys: body.keys };
    return body.keys;
  }
}

function isSupportedSigningKey(key: JsonWebKey, kid: string): boolean {
  return (
    key.kid === kid &&
    key.kty === 'EC' &&
    key.crv === 'P-256' &&
    (key.alg === undefined || key.alg === 'ES256') &&
    (key.use === undefined || key.use === 'sig')
  );
}

function decodeJson<T>(encoded: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Pomerium assertion contains invalid JSON');
  }
}
