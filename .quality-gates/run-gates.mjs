#!/usr/bin/env node
/**
 * Deterministic quality gates.
 *
 * Runs the checks a script can prove — tests pass, lint is clean, types check,
 * coverage did not fall, complexity and CRAP did not get worse, no secrets, no
 * known-vulnerable dependencies, no SAST findings — and either reports them
 * (warn mode) or rejects the push (block mode).
 *
 * The point is that nothing here asks an LLM whether the code is good. Every
 * number comes from a tool, and the thresholds ratchet: a repo can only get
 * better than the day the gates were installed.
 *
 *   node .quality-gates/run-gates.mjs            # run the gates
 *   node .quality-gates/run-gates.mjs --record   # re-record the baseline
 *   node .quality-gates/run-gates.mjs --report   # print numbers, never fail
 *   node .quality-gates/run-gates.mjs --security-only   # just the scanners
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONFIG_PATH = join(HERE, 'gates.config.json');
const ALLOWLIST_PATH = join(HERE, 'security-allowlist.json');

const argv = new Set(process.argv.slice(2));
const FORCE_RECORD = argv.has('--record');
const REPORT_ONLY = argv.has('--report');
const SECURITY_ONLY = argv.has('--security-only');

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
  if (REPORT_ONLY) return false; // report mode promises never to fail. Including here.
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
    console.error('\n⚠ warn mode — push allowed despite the gate failing to run.\n');
    process.exit(0);
  });
}

const { analyzeCoverage, formatReport } = await import('./crap.mjs');
const security = await import('./security.mjs');

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
const BLOCKING = !REPORT_ONLY && blockAfter !== null && Date.now() >= blockAfter.getTime();

/**
 * CI checks out, runs, and throws the working tree away. Anything written here
 * is discarded, so CI must never be the thing that records a baseline.
 */
const inCI = Boolean(process.env.CI);

/**
 * Node's default maxBuffer for spawnSync is 1MB. A verbose suite or a lint run
 * with many warnings overruns it, at which point the child is killed, `status`
 * comes back null, and a passing command reads as a failing gate. Repos with a
 * few hundred tests hit this. Raise it, and surface spawn errors explicitly so
 * an environment problem is never reported as a code defect.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

function run(label, command) {
  process.stdout.write(`${C.dim}· ${label}${C.off}\n`);
  const res = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: MAX_BUFFER,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { ok: res.status === 0, code: res.status, output, spawnError: res.error ?? null };
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

let testsRan = false;
let testsPassed = false;

if (!SECURITY_ONLY) {
  // -------------------------------------------------------------- lint
  if (config.gates?.lint !== false && scripts.lint && canRun) {
    const r = run('lint', `${pm} run lint`);
    if (!r.ok) {
      fail('lint', r.spawnError ? `could not run lint: ${r.spawnError.message}` : r.output.trim().split('\n').slice(-25).join('\n'));
    }
  } else if (config.gates?.lint !== false && scripts.lint) {
    // There is a lint script; it was skipped for environment reasons, not
    // because the repo has none. Saying otherwise sends people looking for a
    // missing script that is right there in package.json.
    notes.push('lint: skipped — dependencies or package manager unavailable here');
  } else {
    notes.push('lint: no `lint` script — skipped');
  }

  // ---------------------------------------------------------- typecheck
  if (config.gates?.typecheck !== false && scripts.typecheck && canRun) {
    const r = run('typecheck', `${pm} run typecheck`);
    if (!r.ok) {
      fail('typecheck', r.spawnError ? `could not run typecheck: ${r.spawnError.message}` : r.output.trim().split('\n').slice(-25).join('\n'));
    }
  } else if (config.gates?.typecheck !== false && scripts.typecheck) {
    notes.push('typecheck: skipped — dependencies or package manager unavailable here');
  } else if (config.gates?.typecheck !== false && existsSync(join(ROOT, 'tsconfig.json'))) {
    notes.push('typecheck: tsconfig.json present but no `typecheck` script — skipped');
  }
}

// --------------------------------------------------- tests + coverage
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

if (SECURITY_ONLY) {
  // skip
} else if (config.gates?.test !== false && scripts.test && !toolingReady) {
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

  /**
   * Package managers disagree about forwarding `-- <flags>` to a script: npm
   * passes them through, pnpm does not reliably, and the failure is silent —
   * the suite runs, the coverage flags evaporate, no report is written, and the
   * CRAP gate quietly skips. When the test script is a plain vitest call, drive
   * the binary directly so the flags cannot be lost in translation.
   */
  const VITEST_BIN = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  const plainVitest = /^vitest(\s+run)?(\s+--[\w-]+(=\S+)?)*\s*$/.test((scripts.test ?? '').trim());
  const passWithNoTests = (scripts.test ?? '').includes('--passWithNoTests')
    ? ' --passWithNoTests'
    : '';

  const coverageFlags = wantCoverage
    ? ` --coverage --coverage.all ${globArgs} --coverage.reporter=json --coverage.reporter=text-summary`
    : '';

  // pnpm links `node_modules/vitest` rather than unpacking it, so fall back to
  // npx, which resolves the .bin shim whatever the layout or platform.
  const hasBinShim = ['vitest', 'vitest.cmd', 'vitest.CMD', 'vitest.ps1'].some((b) =>
    existsSync(join(ROOT, 'node_modules', '.bin', b)),
  );

  let command;
  if (plainVitest && existsSync(VITEST_BIN)) {
    command = `node "${VITEST_BIN}" run${passWithNoTests}${coverageFlags}`;
  } else if (plainVitest && hasBinShim) {
    command = `npx --no-install vitest run${passWithNoTests}${coverageFlags}`;
  } else {
    command = `${pm} run test${coverageFlags ? ` --${coverageFlags}` : ''}`;
  }

  const r = run(wantCoverage ? 'tests + coverage' : 'tests', command);
  testsRan = true;
  testsPassed = r.ok;
  if (!r.ok) {
    fail(
      'tests',
      r.spawnError
        ? `could not run the test suite: ${r.spawnError.message}`
        : r.output.trim().split('\n').slice(-30).join('\n'),
    );
  }
  if (wantCoverage) {
    analysis = analyzeCoverage(join(ROOT, 'coverage', 'coverage-final.json'));
    if (!analysis) {
      /**
       * The runner asked for coverage, the tooling was present, and the suite
       * ran — so an absent report means something went wrong, not that there
       * was nothing to measure. Reporting that as a passing note is how a gate
       * ends up silently measuring nothing, which is worse than no gate at all.
       */
      fail(
        'coverage',
        'coverage was requested but coverage/coverage-final.json was not produced.\n' +
          'The suite ran, so this is a tooling problem — most often the coverage flags\n' +
          'not reaching vitest, or @vitest/coverage-v8 failing to load.\n' +
          `Reproduce with: ${command}`,
      );
    }
  }
} else {
  notes.push('tests: no `test` script — skipped');
}

// ------------------------------------------------ ratchet comparisons
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

/**
 * A baseline taken from a run whose tests failed is worthless — the suite may
 * have died halfway and written a partial report — and it becomes the permanent
 * floor. Refuse rather than enshrine a bad number.
 */
const measurementTrustworthy = measured !== null && testsRan && testsPassed;

if (measured) {
  const wantRecord = FORCE_RECORD || (!baseline && !inCI);
  if (wantRecord && inCI) {
    notes.push('baseline not recorded: CI discards its working tree, so recording there is a no-op.');
  } else if (wantRecord && !measurementTrustworthy) {
    notes.push('baseline not recorded: the test suite did not pass, so this measurement is not trustworthy.');
  } else if (wantRecord) {
    config.baseline = { ...measured, recordedAt: new Date().toISOString().slice(0, 10) };
    writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    notes.push(
      `baseline recorded: coverage ${(measured.coverage * 100).toFixed(1)}%, ` +
        `worst CRAP ${measured.worstCrap}, max complexity ${measured.maxComplexity}`,
    );
  } else if (!baseline) {
    const msg =
      'no committed baseline — the coverage, CRAP and complexity ratchets are INACTIVE. ' +
      'Run `node .quality-gates/run-gates.mjs --record` locally and commit gates.config.json.';
    if (BLOCKING) fail('baseline', msg);
    else notes.push(`⚠ ${msg}`);
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

    /**
     * The ratchet is supposed to be one-way. Anchoring it at install time and
     * never moving it means a repo that improves keeps the slack it earned and
     * can silently slide back to where it started. When a clean run measures
     * better than the committed baseline, tighten it — coverage floor up, CRAP
     * and complexity ceilings down, never the reverse. Local only: CI's tree is
     * discarded, so a tightening written there would be lost, and a tightening
     * written on a failing run would be based on nothing.
     */
    const autoTighten = th.autoTighten !== false && !inCI && !REPORT_ONLY && measurementTrustworthy;
    if (autoTighten && failures.length === 0) {
      const next = { ...baseline };
      const moved = [];
      if (measured.coverage > baseline.coverage + 0.005) {
        next.coverage = measured.coverage;
        moved.push(`coverage floor ${(baseline.coverage * 100).toFixed(2)}% → ${(measured.coverage * 100).toFixed(2)}%`);
      }
      if (measured.worstCrap < baseline.worstCrap) {
        next.worstCrap = measured.worstCrap;
        moved.push(`CRAP ceiling ${baseline.worstCrap} → ${measured.worstCrap}`);
      }
      if (measured.maxComplexity < baseline.maxComplexity) {
        next.maxComplexity = measured.maxComplexity;
        moved.push(`complexity ceiling ${baseline.maxComplexity} → ${measured.maxComplexity}`);
      }
      if (moved.length) {
        next.functions = measured.functions;
        next.recordedAt = new Date().toISOString().slice(0, 10);
        config.baseline = next;
        writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
        notes.push(`ratchet tightened: ${moved.join('; ')} — commit gates.config.json to keep it.`);
      }
    }
  }
}

// ---------------------------------------------------------- security
/**
 * Scanners are deterministic and their findings are compared against a
 * committed allowlist. The allowlist is never written automatically, by any
 * code path: an absent or empty allowlist means nothing is accepted, so the
 * gate fails closed. Accepting a finding is a deliberate, reviewed commit.
 */
const secCfg = config.security ?? {};
if (config.gates?.security !== false) {
  const allowlist = security.loadAllowlist(ALLOWLIST_PATH) ?? [];
  const findings = [];
  const scannerProblems = [];

  const wantSecrets = secCfg.secrets !== false;
  const wantDeps = secCfg.dependencies !== false && (inCI || SECURITY_ONLY);
  const wantSast = secCfg.sast === true && (inCI || SECURITY_ONLY);

  if (wantSecrets) {
    const mode = inCI || SECURITY_ONLY ? 'history' : 'files';
    const res = security.scanSecrets(ROOT, mode);
    if (!res.available) scannerProblems.push('gitleaks is not installed');
    else if (res.error) scannerProblems.push(`gitleaks: ${res.error}`);
    else {
      findings.push(...res.findings);
      notes.push(`secrets: gitleaks scanned ${mode === 'history' ? 'full history' : 'the working tree'}`);
    }
  }

  if (wantDeps) {
    const res = security.scanDependencies(ROOT, pm);
    if (!res.available) scannerProblems.push(`${pm} audit unavailable`);
    else if (res.error) scannerProblems.push(`${pm} audit: ${res.error}`);
    else findings.push(...res.findings);
  }

  if (wantSast) {
    const res = security.scanSast(ROOT, secCfg.semgrepConfig ?? 'p/ci');
    if (!res.available) scannerProblems.push('semgrep is not installed');
    else if (res.error) scannerProblems.push(`semgrep: ${res.error}`);
    else findings.push(...res.findings);
  }

  const { live, accepted, expired } = security.partitionFindings(findings, allowlist);

  for (const e of expired) {
    notes.push(`⚠ allowlist entry expired ${e.expiredOn} — ${e.id} is live again`);
  }
  if (accepted.length) {
    notes.push(`security: ${accepted.length} finding(s) suppressed by the committed allowlist`);
  }

  if (live.length) {
    const bySeverity = (a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0);
    fail(
      'security',
      [...live].sort(bySeverity).slice(0, 25).map((f) =>
        `[${f.tool}] ${f.detail}\n      ${f.file}${f.line ? `:${f.line}` : ''}\n      allowlist id: ${f.id}`,
      ).join('\n'),
    );
  }

  /**
   * A scanner that is missing locally is an environment gap. A scanner that is
   * missing in CI means the security gate measured nothing while reporting
   * success — the exact failure this stack exists to prevent — so once the
   * gates are blocking, CI treats it as a failure.
   */
  if (scannerProblems.length) {
    const msg = scannerProblems.join('\n');
    if (inCI && BLOCKING) fail('security-tooling', msg);
    else notes.push(`security scanners unavailable — ${scannerProblems.join('; ')}`);
  }
}

// ----------------------------------------------------------- report
const repo = pkg.name ?? ROOT.split(/[/\\]/).pop();
console.info(`\n${C.bold}quality gates${C.off} ${C.dim}${repo}${C.off}`);

if (measured) {
  const b = config.baseline;
  console.info(
    `  coverage       ${(measured.coverage * 100).toFixed(2)}%` +
      (b ? `${C.dim}  floor ${(b.coverage * 100).toFixed(2)}%${C.off}` : ''),
  );
  console.info(
    `  worst CRAP     ${measured.worstCrap}` +
      (b ? `${C.dim}  ceiling ${Math.max(b.worstCrap, crapMax)}${C.off}` : ''),
  );
  console.info(
    `  max complexity ${measured.maxComplexity}` +
      (b ? `${C.dim}  ceiling ${Math.max(b.maxComplexity, complexityMax)}${C.off}` : ''),
  );
  console.info(`  functions      ${measured.functions}`);
  const offenders = formatReport(analysis, { crapMax, complexityMax });
  if (!offenders.includes('within CRAP')) {
    console.info(`\n${C.yellow}  worst offenders${C.off}`);
    console.info(offenders);
  }
}

for (const n of notes) console.info(`  ${C.dim}${n}${C.off}`);

if (failures.length === 0) {
  console.info(`\n${C.green}✓ all gates passed${C.off}\n`);
  process.exit(0);
}

console.info(`\n${C.red}✗ ${failures.length} gate(s) failed${C.off}`);
for (const f of failures) {
  console.info(`\n${C.red}  [${f.gate}]${C.off}`);
  console.info(
    f.detail
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
}

if (REPORT_ONLY) {
  console.info(`\n${C.dim}report mode — not failing${C.off}\n`);
  process.exit(0);
}

if (!BLOCKING) {
  const when = config.blockAfter ?? 'never';
  console.info(
    `\n${C.yellow}⚠ warn mode — these become blocking on ${when}. Push allowed.${C.off}\n`,
  );
  process.exit(0);
}

console.info(`\n${C.red}Push rejected. Fix the above, or run with --report to inspect.${C.off}\n`);
process.exit(1);
