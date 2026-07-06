/**
 * Guard against Astro's inline-whitespace trap: a template line break adjacent
 * to an inline element (<strong>/<code>/<a>/<em>) is dropped by the compiler,
 * silently joining words on the rendered page ("laid out assix item slots").
 * Scans every built page's <main> content and fails the build on any join, so
 * the bug can't ship again. Run after `pnpm --filter @lolperform/web build`.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'apps/web/dist';
// letter/punctuation hard against an inline tag boundary = a swallowed space
const JOIN = /<\/(strong|code|a|em)>[a-zA-Z(]|[a-zA-Z,;)]<(strong|code|a|em)[ >]/g;

if (!existsSync(DIST)) {
  console.error(`${DIST} not found — build the web app first.`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [],
  );

let failures = 0;
let pages = 0;
for (const file of walk(DIST)) {
  pages += 1;
  const html = readFileSync(file, 'utf8');
  const main = html.split(/<main[^>]*>/)[1]?.split('</main>')[0] ?? '';
  for (const m of main.matchAll(JOIN)) {
    failures += 1;
    const ctx = main.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ');
    console.error(`JOIN in ${file}: …${ctx}…`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} tag-adjacent word join(s) found. In .astro copy, break lines only between ` +
      'plain words — never directly before or after an inline tag.',
  );
  process.exit(1);
}
console.info(`inline-whitespace check: ${pages} pages clean`);
