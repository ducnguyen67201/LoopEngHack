export type FailurePlan<Operation extends string, Failure extends string> = Readonly<
  Partial<Record<Operation, Failure | readonly Failure[]>>
>;

/**
 * Consumes a copied failure plan in a stable order. Configuration is constrained
 * to known failure codes so arbitrary messages or secrets cannot enter observations.
 */
export class DeterministicFailureInjector<Operation extends string, Failure extends string> {
  private readonly failuresByOperation = new Map<Operation, Failure[]>();

  public constructor(
    plan: FailurePlan<Operation, Failure> | undefined,
    operations: readonly Operation[],
    failures: readonly Failure[],
  ) {
    if (plan === undefined) {
      return;
    }

    const knownOperations = new Set<string>(operations);
    const knownFailures = new Set<string>(failures);

    for (const [operation, configured] of Object.entries(plan)) {
      if (!knownOperations.has(operation)) {
        throw new TypeError('Failure plan contains an unsupported operation.');
      }

      const queue = Array.isArray(configured) ? configured : [configured];
      if (queue.some((failure) => typeof failure !== 'string' || !knownFailures.has(failure))) {
        throw new TypeError('Failure plan contains an unsupported failure category.');
      }

      this.failuresByOperation.set(operation as Operation, [...(queue as Failure[])]);
    }
  }

  public take(operation: Operation): Failure | undefined {
    const queue = this.failuresByOperation.get(operation);
    const failure = queue?.shift();

    if (queue?.length === 0) {
      this.failuresByOperation.delete(operation);
    }

    return failure;
  }
}
