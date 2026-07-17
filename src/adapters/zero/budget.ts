import { ZeroAdapterError, type ZeroBudget } from './types.js';

const MICRO_USD_PER_USD = 1_000_000;

export function parseUsdToMicroUsd(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * MICRO_USD_PER_USD);
  }

  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^\$?\s*(\d+)(?:\.(\d{1,6}))?/);
  if (!match) return null;

  const whole = Number.parseInt(match[1] ?? '0', 10);
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const fractional = Number.parseInt(fraction || '0', 10);
  if (!Number.isFinite(whole) || !Number.isFinite(fractional)) return null;
  return whole * MICRO_USD_PER_USD + fractional;
}

export function formatMicroUsdAsUsd(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new ZeroAdapterError('budget_exceeded', 'budget values must be non-negative integers');
  }

  const whole = Math.floor(value / MICRO_USD_PER_USD);
  const fraction = String(value % MICRO_USD_PER_USD)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

export function assertWithinBudget(costMicroUsd: number, budget: ZeroBudget): void {
  if (!Number.isInteger(costMicroUsd) || costMicroUsd < 0) {
    throw new ZeroAdapterError('budget_exceeded', 'capability has an invalid declared cost');
  }
  if (costMicroUsd > budget.maxPerCallMicroUsd) {
    throw new ZeroAdapterError('budget_exceeded', 'capability exceeds per-call Zero budget');
  }
  if (budget.spentMicroUsd + costMicroUsd > budget.maxEpisodeMicroUsd) {
    throw new ZeroAdapterError('budget_exceeded', 'capability exceeds episode Zero budget');
  }
}
