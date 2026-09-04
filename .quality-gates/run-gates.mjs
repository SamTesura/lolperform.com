#!/usr/bin/env node
/**
 * Deterministic quality gates.
 *
 * Runs the checks a script can prove — tests pass, lint is clean, types check,
 * coverage did not fall, complexity and CRAP did not get worse — and either
 * reports them (warn mode) or rejects the push (block mode).
 *
 * The point is that nothing here asks an LLM whether the code is good. Every
 * number comes from a tool, and the thresholds ratchet: a repo can only get
 * better than the day the gates were installed.
 *
 *   node .quality-gates/run-gates.mjs            # run the gates
 *   node .quality-gates/run-gates.mjs --record   # re-record the baseline
 *   node .quality-gates/run-gates.mjs --report   # print numbers, never fail
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONFIG_PATH = join(HERE, 'gates.config.json');

/**
 * If the gate script itself breaks — a bug in this file, a malformed config, a
 * broken import — that is not evidence the code under test is bad. During the
 * warn ramp it must never block work. Once the gates are blocking, a gate that
 * cannot run is treated as a failure rather than waved through.
 *
 * Registered before anything that can throw, and it reads `blockAfter` itself,
 * because the parsed config may be exactly what failed.
 */
function blockingNow() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return Boolean(raw.blockAfter) && Date.now() >= new Date(`${raw.blockAfter}T00:00:00Z`).getTime();
  } catch {
    return false;
  }
}

for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    console.error('\nquality gates: the gate script itself failed —');
    console.error(err?.stack ?? String(err));
    if (blockingNow()) {
      console.error('\nPush rejected: gates are in blocking mode and could not run.');
      process.exit(1);
    }
    console.error('\n\u26a0 warn mode — push allowed despite the gate failing to run.\n');
    process.exit(0);
  });
}

const { analyzeCoverage, formatReport } = await import('./crap.mjs');

const argv = new Set(process.argv.slice(2));
const FORCE_RECORD = argv.has('--record');
const REPORT_ONLY = argv.has('--report');

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', bold: '', off: '' };

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const pkg = existsSync(join(ROOT, 'package.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  : { scripts: {} };
const scripts = pkg.scripts ?? {};

const pm = existsSync(join(ROOT, 'pnpm-lock.yaml'))
  ? 'pnpm'
  : existsSync(join(ROOT, 'yarn.lock'))
    ? 'yarn'
    : 'npm';

/** Block mode kicks in once the ramp date passes. */
const blockAfter = config.blockAfter ? new Date(`${config.blockAfter}T00:00:00Z`) : null;
const BLOCKING = !REPORT_ONLY && blockAfter != null && Date.now() >= blockAfter.getTime();

function run(label, command) {
  process.stdout.write(`${C.dim}· ${label}${C.off}\n`);
  const res = spawnSync(command, { cwd: ROOT, shell: true, encoding: 'utf8', stdio: 'pipe' });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { ok: res.status === 0, code: res.status, output };
}

const failures = [];
const notes = [];
const fail = (gate, detail) => failures.push({ gate, detail });

const depsInstalled = existsSync(join(ROOT, 'node_modules'));
if (!depsInstalled) {
  notes.push(`dependencies not installed — run \`${pm} install\`. CI still enforces every gate.`);
}

/**
 * The lockfile picks the package manager, but the machine running the hook may
 * not have it on PATH. Reporting three failed gates in that case is noise, not
 * signal — it says nothing about the code.
 */
const pmAvailable =
  spawnSync(`${pm} --version`, { cwd: ROOT, shell: true, stdio: 'ignore' }).status === 0;
if (depsInstalled && !pmAvailable) {
  notes.push(`${pm} is not on PATH here — local gates skipped. CI still enforces every gate.`);
}
const canRun = depsInstalled && pmAvailable;

// ---------------------------------------------------------------- lint
if (config.gates?.lint !== false && scripts.lint && canRun) {
  const r = run('lint', `${pm} run lint`);
  if (!r.ok) {
    fail('lint', r.output.trim().split('\n').slice(-25).join('\n'));
  }
} else {
  notes.push('lint: no `lint` script — skipped');
}

// ------------------------------------------------------------ typecheck
if (config.gates?.typecheck !== false && scripts.typecheck && canRun) {
  const r = run('typecheck', `${pm} run typecheck`);
  if (!r.ok) {
    fail('typecheck', r.output.trim().split('\n').slice(-25).join('\n'));
  }
} else if (config.gates?.typecheck !== false && existsSync(join(ROOT, 'tsconfig.json')) && !scripts.typecheck) {
  notes.push('typecheck: tsconfig.json present but no `typecheck` script — skipped');
}

// ----------------------------------------------------- tests + coverage
let analysis = null;
const wantCoverage = config.gates?.coverage !== false;

/**
 * Dependencies live outside the repo, so a fresh clone (or a machine that has
 * not run an install since the gates were added) has no test runner. That is
 * an environment gap, not a code defect — note it and move on. CI installs
 * from the lockfile and enforces the gate for real.
 */
const toolingReady =
  canRun &&
  ['vitest', 'vitest.cmd', 'vitest.CMD'].some((bin) =>
    existsSync(join(ROOT, 'node_modules', '.bin', bin)),
  );
// The coverage provider is a separate package; vitest exits non-zero without it,
// which would otherwise read as a failing test suite rather than a missing dep.
const coverageProviderReady =
  !wantCoverage || existsSync(join(ROOT, 'node_modules', '@vitest', 'coverage-v8'));

if (config.gates?.test !== false && scripts.test && !toolingReady) {
  notes.push(`tests: test runner not installed — run \`${pm} install\`. CI still enforces this gate.`);
} else if (config.gates?.test !== false && scripts.test && !coverageProviderReady) {
  notes.push(
    `tests: @vitest/coverage-v8 not installed — run \`${pm} install\`. CI still enforces this gate.`,
  );
} else if (config.gates?.test !== false && scripts.test) {
  /**
   * `--coverage.all` plus explicit include globs is the difference between a
   * coverage number that means something and one that does not. Without them a
   * brand-new untested file never enters the report at all, so adding dead,
   * untested code would *raise* the average and sail through the gate.
   * Set `coverageInclude: false` in gates.config.json to defer to the repo's
   * own vitest coverage config instead.
   */
  const DEFAULT_INCLUDE = [
    'src/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'functions/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'lib/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'worker/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'workers/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'packages/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'pipeline/**/*.{js,mjs,cjs,jsx,ts,tsx}',
    'app/**/*.{js,mjs,cjs,jsx,ts,tsx}',
  ];
  const EXCLUDE = [
    '**/*.{test,spec}.*',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.wrangler/**',
    '**/.stryker-tmp/**',
    '**/reports/**',
    '**/*.d.ts',
    '**/*.config.*',
    '**/test/**',
    '**/__tests__/**',
  ];
  const includes =
    config.coverageInclude === false
      ? []
      : (Array.isArray(config.coverageInclude) ? config.coverageInclude : DEFAULT_INCLUDE);
  const globArgs = [
    ...includes.map((g) => `--coverage.include='${g}'`),
    ...(includes.length ? EXCLUDE.map((g) => `--coverage.exclude='${g}'`) : []),
  ].join(' ');

  const coverageArgs = wantCoverage
    ? ` -- --coverage --coverage.all ${globArgs} --coverage.reporter=json --coverage.reporter=text-summary`
    : '';
  const r = run(wantCoverage ? 'tests + coverage' : 'tests', `${pm} run test${coverageArgs}`);
  if (!r.ok) {
    fail('tests', r.output.trim().split('\n').slice(-30).join('\n'));
  }
  if (wantCoverage) {
    analysis = analyzeCoverage(join(ROOT, 'coverage', 'coverage-final.json'));
    if (!analysis) notes.push('coverage: no coverage/coverage-final.json produced — CRAP gate skipped');
  }
} else {
  notes.push('tests: no `test` script — skipped');
}

// -------------------------------------------------- ratchet comparisons
const measured = analysis
  ? {
      coverage: Number(analysis.totalCoverage.toFixed(4)),
      worstCrap: Number(analysis.worstCrap.toFixed(2)),
      maxComplexity: analysis.maxComplexity,
      functions: analysis.functions.length,
    }
  : null;

const baseline = config.baseline ?? null;
const th = config.thresholds ?? {};
const crapMax = th.crapMax ?? 30;
const complexityMax = th.complexityMax ?? 6;

if (measured) {
  if (!baseline || FORCE_RECORD) {
    config.baseline = { ...measured, recordedAt: new Date().toISOString().slice(0, 10) };
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    notes.push(
      `baseline recorded: coverage ${(measured.coverage * 100).toFixed(1)}%, ` +
        `worst CRAP ${measured.worstCrap}, max complexity ${measured.maxComplexity}`,
    );
  } else {
    if (th.coverageRatchet !== false && measured.coverage < baseline.coverage - 0.005) {
      fail(
        'coverage',
        `dropped to ${(measured.coverage * 100).toFixed(2)}% from a floor of ${(baseline.coverage * 100).toFixed(2)}%`,
      );
    }
    const crapCeiling = Math.max(baseline.worstCrap, crapMax);
    if (measured.worstCrap > crapCeiling) {
      fail('crap', `worst CRAP ${measured.worstCrap} exceeds ceiling ${crapCeiling}`);
    }
    const ccCeiling = Math.max(baseline.maxComplexity, complexityMax);
    if (measured.maxComplexity > ccCeiling) {
      fail('complexity', `max cyclomatic complexity ${measured.maxComplexity} exceeds ceiling ${ccCeiling}`);
    }
  }
}

// ------------------------------------------------------------- report
const repo = pkg.name ?? ROOT.split(/[/\\]/).pop();
console.log(`\n${C.bold}quality gates${C.off} ${C.dim}${repo}${C.off}`);

if (measured) {
  const b = config.baseline;
  console.log(
    `  coverage       ${(measured.coverage * 100).toFixed(2)}%` +
      (b ? `${C.dim}  floor ${(b.coverage * 100).toFixed(2)}%${C.off}` : ''),
  );
  console.log(
    `  worst CRAP     ${measured.worstCrap}` +
      (b ? `${C.dim}  ceiling ${Math.max(b.worstCrap, crapMax)}${C.off}` : ''),
  );
  console.log(
    `  max complexity ${measured.maxComplexity}` +
      (b ? `${C.dim}  ceiling ${Math.max(b.maxComplexity, complexityMax)}${C.off}` : ''),
  );
  console.log(`  functions      ${measured.functions}`);
  const offenders = formatReport(analysis, { crapMax, complexityMax });
  if (!offenders.includes('within CRAP')) {
    console.log(`\n${C.yellow}  worst offenders${C.off}`);
    console.log(offenders);
  }
}

for (const n of notes) console.log(`  ${C.dim}${n}${C.off}`);

if (failures.length === 0) {
  console.log(`\n${C.green}✓ all gates passed${C.off}\n`);
  process.exit(0);
}

console.log(`\n${C.red}✗ ${failures.length} gate(s) failed${C.off}`);
for (const f of failures) {
  console.log(`\n${C.red}  [${f.gate}]${C.off}`);
  console.log(
    f.detail
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
}

if (REPORT_ONLY) {
  console.log(`\n${C.dim}report mode — not failing${C.off}\n`);
  process.exit(0);
}

if (!BLOCKING) {
  const when = config.blockAfter ?? 'never';
  console.log(
    `\n${C.yellow}⚠ warn mode — these become blocking on ${when}. Push allowed.${C.off}\n`,
  );
  process.exit(0);
}

console.log(`\n${C.red}Push rejected. Fix the above, or run with --report to inspect.${C.off}\n`);
process.exit(1);
