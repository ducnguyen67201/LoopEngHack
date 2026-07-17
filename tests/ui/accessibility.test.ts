import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');

describe('recruiting arena accessibility shell', () => {
  it('exposes semantic landmarks and an announcement region', () => {
    expect(html).toContain('<main class="app-shell">');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('<dialog id="proof-dialog"');
  });

  it('provides keyboard-native controls with explicit button types', () => {
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];

    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button).toContain('type="button"');
    }
  });

  it('preserves state changes while honoring reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.001ms !important');
  });
});
