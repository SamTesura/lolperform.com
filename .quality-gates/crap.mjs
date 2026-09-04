/**
 * CRAP (Change Risk Anti-Patterns) analyzer.
 *
 *   CRAP(f) = CC(f)^2 * (1 - cov(f))^3 + CC(f)
 *
 * Reads an Istanbul-shaped `coverage-final.json` (what @vitest/coverage-v8 and
 * nyc both emit with the `json` reporter) and derives, per function:
 *
 *   - cyclomatic complexity, as 1 + the number of extra branch paths whose
 *     source location falls inside the function body
 *   - statement coverage, as covered statements inside the body / all
 *     statements inside the body
 *
 * No extra dependencies: everything needed is already in the coverage report.
 */

import { readFileSync } from 'node:fs';

const inRange = (loc, outer) => {
  if (!loc?.start || !outer?.start || loc.start.line == null || outer.start.line == null) return false;
  const afterStart =
    loc.start.line > outer.start.line ||
    (loc.start.line === outer.start.line && (loc.start.column ?? 0) >= (outer.start.column ?? 0));
  const endLine = loc.end?.line ?? loc.start.line;
  const outerEndLine = outer.end?.line ?? outer.start.line;
  const beforeEnd =
    endLine < outerEndLine ||
    (endLine === outerEndLine && (loc.end?.column ?? 0) <= (outer.end?.column ?? Infinity));
  return afterStart && beforeEnd;
};

/** Complexity + coverage for every function in an Istanbul coverage report. */
export function analyzeCoverage(coveragePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
  } catch {
    return null;
  }

  const functions = [];
  let totalStatements = 0;
  let coveredStatements = 0;

  for (const [file, data] of Object.entries(raw)) {
    const statements = Object.entries(data.statementMap ?? {});
    const branches = Object.values(data.branchMap ?? {});

    for (const [id] of statements) {
      totalStatements += 1;
      if ((data.s?.[id] ?? 0) > 0) coveredStatements += 1;
    }

    for (const [id, fn] of Object.entries(data.fnMap ?? {})) {
      // `loc` is the body; `decl` is just the signature. Prefer the body.
      const body = fn.loc ?? fn.decl;
      if (!body) continue;

      let complexity = 1;
      for (const branch of branches) {
        const bLoc = branch.loc ?? branch.locations?.[0];
        if (!inRange(bLoc, body)) continue;
        const paths = Array.isArray(branch.locations) ? branch.locations.length : 2;
        complexity += Math.max(1, paths - 1);
      }

      let stmtTotal = 0;
      let stmtCovered = 0;
      for (const [sid, sLoc] of statements) {
        if (!inRange(sLoc, body)) continue;
        stmtTotal += 1;
        if ((data.s?.[sid] ?? 0) > 0) stmtCovered += 1;
      }

      // A function with no statements of its own (an arrow returning an
      // expression, say) falls back to whether the function itself was hit.
      const coverage =
        stmtTotal > 0 ? stmtCovered / stmtTotal : (data.f?.[id] ?? 0) > 0 ? 1 : 0;

      const crap = complexity ** 2 * (1 - coverage) ** 3 + complexity;

      functions.push({
        file: file.replace(/\\/g, '/'),
        name: fn.name || '(anonymous)',
        line: body.start.line,
        complexity,
        coverage,
        crap: Math.round(crap * 100) / 100,
      });
    }
  }

  return {
    functions,
    totalCoverage: totalStatements > 0 ? coveredStatements / totalStatements : 0,
    totalStatements,
    worstCrap: functions.reduce((m, f) => Math.max(m, f.crap), 0),
    maxComplexity: functions.reduce((m, f) => Math.max(m, f.complexity), 0),
  };
}

export function formatReport(analysis, { crapMax, complexityMax, limit = 10 } = {}) {
  if (!analysis || analysis.functions.length === 0) {
    return '  (no coverage data — no functions analyzed)';
  }
  const offenders = [...analysis.functions]
    .sort((a, b) => b.crap - a.crap)
    .filter((f) => f.crap > (crapMax ?? 30) || f.complexity > (complexityMax ?? 6))
    .slice(0, limit);

  if (offenders.length === 0) return '  all functions within CRAP and complexity limits';

  const rows = offenders.map((f) => {
    const loc = `${f.file}:${f.line}`;
    return `  CRAP ${String(f.crap).padStart(7)}  CC ${String(f.complexity).padStart(3)}  cov ${String(
      Math.round(f.coverage * 100),
    ).padStart(3)}%  ${f.name}\n      ${loc}`;
  });
  return rows.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? 'coverage/coverage-final.json';
  const analysis = analyzeCoverage(path);
  if (!analysis) {
    console.error(`No coverage report at ${path}`);
    process.exit(2);
  }
  console.log(`Functions analyzed: ${analysis.functions.length}`);
  console.log(`Overall statement coverage: ${(analysis.totalCoverage * 100).toFixed(2)}%`);
  console.log(`Worst CRAP: ${analysis.worstCrap}   Max complexity: ${analysis.maxComplexity}`);
  console.log(formatReport(analysis, { crapMax: 30, complexityMax: 6 }));
}
