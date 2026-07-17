export const pomeriumMachineIdentities = [
  'fillmore-sourcer',
  'white-verifier',
  'hiring-controller',
] as const;

export type PomeriumMachineIdentity = (typeof pomeriumMachineIdentities)[number];

export type PomeriumCredentialSet = Readonly<
  Partial<Record<PomeriumMachineIdentity, string | undefined>>
>;

const minimumJwtLength = 24;

export class MissingPomeriumCredentialError extends Error {
  readonly identity: PomeriumMachineIdentity;

  constructor(identity: PomeriumMachineIdentity) {
    super(`Pomerium credential is unavailable for ${identity}`);
    this.name = 'MissingPomeriumCredentialError';
    this.identity = identity;
  }
}

/**
 * Resolves credentials supplied by the composition root. Credentials are never
 * accepted as tool inputs and never appear in error messages.
 */
export class PomeriumCredentialResolver {
  readonly #credentials: PomeriumCredentialSet;

  constructor(credentials: PomeriumCredentialSet) {
    this.#credentials = credentials;
  }

  authorizationHeader(identity: PomeriumMachineIdentity): string {
    const configured = this.#credentials[identity]?.trim();

    if (configured === undefined || configured.length < minimumJwtLength) {
      throw new MissingPomeriumCredentialError(identity);
    }

    const serviceAccountToken = configured.startsWith('Pomerium-')
      ? configured
      : `Pomerium-${configured}`;

    return `Bearer ${serviceAccountToken}`;
  }
}
