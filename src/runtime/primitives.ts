import type { Clock, IdGenerator } from '../domain/ports.js';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class NamespacedIdGenerator implements IdGenerator {
  private readonly sequenceByPrefix = new Map<string, number>();

  constructor(private readonly namespace: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(namespace)) {
      throw new TypeError('ID namespace must be a bounded identifier');
    }
  }

  next(prefix: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,71}$/.test(prefix)) {
      throw new TypeError('ID prefix must be a bounded identifier');
    }
    const sequence = this.sequenceByPrefix.get(prefix) ?? 1;
    this.sequenceByPrefix.set(prefix, sequence + 1);
    return `${prefix}-${this.namespace}-${sequence}`;
  }
}
