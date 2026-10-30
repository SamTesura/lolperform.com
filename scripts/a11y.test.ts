// @vitest-environment node
/**
 * Screen-reader and keyboard regression guard for the web app. Reads the
 * source, so it runs with the rest of `pnpm test` and needs no build.
 *
 * Each check pins a fix that is easy to undo without noticing: a token nudged
 * back under 4.5:1, the skip link dropped from the layout, or an aria-label on
 * a plain span (screen readers ignore it there).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

const tokens = read('styles/tokens.css');
function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1]!;
}

/** WCAG 2.x relative luminance contrast ratio. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('colour tokens meet WCAG AA', () => {
  const surfaces = ['bg-base', 'bg-surface', 'bg-elevated', 'bg-overlay'];
  const chips = [
    'positive-subtle',
    'negative-subtle',
    'warning-subtle',
    'info-subtle',
    'accent-subtle',
  ];

  it.each([...surfaces, ...chips])('text-muted is at least 4.5:1 on %s', (bg) => {
    expect(contrast(token('text-muted'), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg-base', 'bg-surface', 'bg-elevated'])('delta-flat is at least 4.5:1 on %s', (bg) => {
    expect(contrast(token('delta-flat'), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['bg-base', 'bg-surface', 'bg-elevated'])(
    'form-control border is at least 3:1 on %s (1.4.11)',
    (bg) => {
      expect(contrast(token('border-input'), token(bg))).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(surfaces)('focus ring is at least 3:1 on %s', (bg) => {
    expect(contrast(token('focus-ring'), token(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('layout', () => {
  const base = read('layouts/Base.astro');

  it('puts a skip link before the header, targeting a focusable main', () => {
    const skip = base.indexOf('href="#main"');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(base.indexOf('<SiteHeader'));
    expect(base).toMatch(/<main[^>]*\bid="main"[^>]*\btabindex="-1"/);
  });

  it('declares the page language', () => {
    expect(base).toMatch(/<html lang="en">/);
  });
});

describe('components', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : /\.(tsx|astro)$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    );

  it('never puts aria-label on a span or div without a role', () => {
    const offenders = walk(WEB).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/<(span|div)\b[^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => /\baria-label=/.test(tag) && !/\brole=/.test(tag))
        .map((tag) => `${file.slice(WEB.length)}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the header search an ARIA combobox', () => {
    const search = read('components/islands/ChampionSearch.tsx');
    for (const attr of [
      'role="combobox"',
      'aria-expanded=',
      'aria-controls=',
      'aria-activedescendant=',
    ]) {
      expect(search).toContain(attr);
    }
    expect(search).toContain('role="listbox"');
    expect(search).toContain('role="option"');
  });
});
