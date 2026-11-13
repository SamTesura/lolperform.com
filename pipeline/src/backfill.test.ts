import { describe, expect, it } from 'vitest';
import { buildBackfillSql } from './backfill.js';

/**
 * D1 refuses a compound SELECT of more than this many terms ("too many terms in
 * compound SELECT"): workerd sets SQLITE_LIMIT_COMPOUND_SELECT to 5. node:sqlite
 * keeps SQLite's default of 500, so slices.e2e.test.ts cannot see the limit.
 */
const D1_COMPOUND_SELECT_LIMIT = 5;

/** Comments, quoted names and strings (skipped whole), parentheses, compound operators. */
const TOKENS =
  /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"]|"")*"|'(?:[^']|'')*'|\(|\)|\b(?:UNION|INTERSECT|EXCEPT)\b/gi;

/**
 * Terms in each compound SELECT chain of `sql`: one entry per parenthesised
 * group, plus one for the top level.
 */
function compoundTerms(sql: string): number[] {
  const terms: number[] = [];
  const open: number[] = [1];
  for (const [token] of sql.matchAll(TOKENS)) {
    if (token === '(') open.push(1);
    else if (token === ')') terms.push(open.pop()!);
    else if (/^(?:UNION|INTERSECT|EXCEPT)$/i.test(token)) open[open.length - 1]!++;
  }
  return [...terms, ...open];
}

describe('compoundTerms', () => {
  it('counts the terms of each chain, nested chains separately', () => {
    expect(Math.max(...compoundTerms('SELECT 1 UNION SELECT 2 UNION ALL SELECT 3'))).toBe(3);
    const nested = compoundTerms('SELECT * FROM (SELECT 1 UNION SELECT 2) UNION SELECT 3');
    expect(nested.sort()).toEqual([2, 2]);
    expect(Math.max(...compoundTerms("SELECT 'a UNION b' WHERE x IN (1, 2)"))).toBe(1);
  });

  it('skips what sits inside comments, quoted names and strings', () => {
    const chain = Array.from({ length: 6 }, (_, i) => `SELECT ${i}`).join(' UNION ');
    expect(Math.max(...compoundTerms(`-- every source's keys (\n${chain}`))).toBe(6);
    expect(Math.max(...compoundTerms(`/* don't ( */ ${chain}`))).toBe(6);
    expect(Math.max(...compoundTerms(`SELECT "a UNION (b" UNION SELECT 'c''s UNION ('`))).toBe(2);
  });
});

describe('buildBackfillSql', () => {
  it('keeps every compound SELECT within what D1 accepts', () => {
    const sql = buildBackfillSql('16.12', 'na1', 'emerald_plus');
    for (const [name, statement] of Object.entries(sql)) {
      const longest = Math.max(...compoundTerms(statement));
      expect(longest, name).toBeLessThanOrEqual(D1_COMPOUND_SELECT_LIMIT);
    }
  });
});
