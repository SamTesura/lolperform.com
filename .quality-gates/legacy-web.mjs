#!/usr/bin/env node
// legacy-web.mjs: legacy web-platform scan for Sam's quality gates.
//
// Runs Google Chrome's modern-web-guidance `legacy-scan` (pinned, vetted,
// telemetry off) and turns its output into a gate decision. The scanner on its
// own always exits 0, silently stops at 5,000 files, skips files over 1 MB, and
// reports "No legacy patterns found" for an empty directory. Every one of those
// is a gate that passes while measuring nothing, so this wrapper:
//
//   1. refuses to run any scanner build except the vetted one (sha256 of the
//      code it executes),
//   2. proves on every run that the scanner still detects a planted instance of
//      each enforced rule (self-test),
//   3. counts the files itself and refuses a scan the scanner would truncate,
//   4. decides pass/fail from committed config and security-allowlist.json:
//      never from an agent.
//
// Exit codes: 0 = scanned, nothing blocking. 1 = enforced finding on or after
// blockAfter (as in run-gates.mjs). 2 = could not measure (not a pass).

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

export const VETTED = Object.freeze({
  version: '1.0.1',
  integrity:
    'sha512-5ztUh5F1p2PewnSkA6EhsGUXqomaZY9qe6iWJCU4JbIQxHTky7s5lMJcPE4EbD1uhbQZIhl0HROH0+s6fIiGzg==',
  files: Object.freeze({
    'modern-web.mjs': '40ad56075492fda04cc03b3b9b92f9aea0b02dc4a3826486a5f520bcad4bf12d',
    'legacy-scan.mjs': '7ca00dac985faca2871879801860e9c7388298d1868a69b8b599de52617b2725',
  }),
});

export const DEFAULTS = Object.freeze({
  enforce: Object.freeze(['secure-external-subresources']),
  blockAfter: '2026-12-02',
  includeDocsAndTests: false,
});

export const MAX_FILES = 5000;
export const MAX_FILE_BYTES = 1_000_000;
export const EXIT = Object.freeze({ OK: 0, BLOCKED: 1, CANNOT_MEASURE: 2 });

// A planted instance of every rule this gate may enforce. Enforcing a rule with
// no plant here is a config error: the gate must prove, on every run, that it
// can see what it claims to block.
export const CANARY = Object.freeze({
  files: Object.freeze({
    'index.html': [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <title>legacy-web self-test</title>',
      '  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>',
      '</head>',
      '<body>',
      '  <form action="/login" method="post">',
      '    <label>Email <input type="email" name="email"></label>',
      '    <label>Password <input type="password" name="password"></label>',
      '    <button>Sign in</button>',
      '  </form>',
      '  <label><input type="checkbox" role="switch"> Notifications</label>',
      '</body>',
      '</html>',
      '',
    ].join('\n'),
    'app.js': 'export const cloneState = (state) => JSON.parse(JSON.stringify(state));\n',
  }),
  expect: Object.freeze([
    'secure-external-subresources',
    'autofill-sign-in-form',
    'switch',
    'js/structured-clone',
  ]),
});

// The scanner's own file filter, copied from the pinned 1.0.1 bundle (pir, pde, Gpt,
// cir, lir, uir, Qpt) so the file count matches what it reads. The only part not
// copied is its content heuristics (minified-looking files), so the count here is an
// upper bound. tests/legacy-web.test.mjs proves the match path by path.
const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.html',
  '.htm',
  '.php',
  '.vue',
  '.svelte',
  '.gts',
  '.gjs',
  '.astro',
  '.css',
  '.scss',
  '.less',
]);
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '_generated',
  'coverage',
  'venv',
  'test-results',
  'playwright-report',
  'tmp',
  'temp',
  'gen',
  'generated',
  'snapshots',
  'extracted_snapshots',
  'vendor',
  'third_party',
  'third-party',
  'external',
  'bower_components',
  'jspm_packages',
  'bundle',
  'libs',
  'non-npm',
]);
const DOCS_TEST_DIRS = new Set([
  'docs',
  'doc',
  'examples',
  'example',
  'demo',
  'demos',
  'test',
  'tests',
  '__tests__',
  'spec',
  'specs',
  'fixtures',
  '__fixtures__',
  'testing',
  'e2e',
]);
const DOCS_TEST_FILES = [
  /(?:(?:^|\.)(?:test|spec)\.|_test_runner\.(?:js|ts|html)$|(?:^|[._-])(?:testrunner|tests)\.(?:js|ts)$)/i,
  /[A-Za-z0-9](?:TestRunner|Tests)\.(?:js|ts)$/,
];
const SKIPPED_SUFFIXES = [
  '.min.js',
  '.min.css',
  '.min.scss',
  '.min.less',
  '.bundle.js',
  '.bundle.css',
  '.bundle.scss',
  '.bundle.less',
  '.pack.js',
  '-opt.js',
  '.opt.js',
  '.map',
  '.d.ts',
];
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS));

class CannotMeasure extends Error {}

// ---------------------------------------------------------------- pure helpers

export function ruleMatches(entry, ruleId) {
  return ruleId === entry || ruleId.startsWith(`${entry}/`);
}

export function posix(p) {
  return p.split(sep).join('/');
}

// Matching control characters is the point: they are stripped from scanned text
// before it reaches a log, an annotation or a step summary.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function clean(text, max = 200) {
  const flat = String(text ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function escapeData(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(text) {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export function isDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- config

export function mergeConfig(raw) {
  if (raw === undefined) return { ...DEFAULTS, enforce: [...DEFAULTS.enforce] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new CannotMeasure('gates.config.json legacyWeb must be an object');
  const unknown = Object.keys(raw).filter((k) => !CONFIG_KEYS.has(k));
  if (unknown.length > 0)
    throw new CannotMeasure(`unknown legacyWeb config key(s): ${unknown.join(', ')}`);
  return { ...DEFAULTS, enforce: [...DEFAULTS.enforce], ...raw };
}

export function validateConfig(config) {
  const problems = [];
  if (
    !Array.isArray(config.enforce) ||
    !config.enforce.every((e) => typeof e === 'string' && e.length > 0)
  )
    problems.push('enforce must be an array of rule ids');
  if (!isDate(config.blockAfter)) problems.push('blockAfter must be a YYYY-MM-DD date');
  if (typeof config.includeDocsAndTests !== 'boolean')
    problems.push('includeDocsAndTests must be true or false');
  if (problems.length > 0) return problems;
  return config.enforce
    .filter((entry) => !CANARY.expect.some((id) => ruleMatches(entry, id)))
    .map((entry) => `cannot enforce "${entry}": the self-test has no planted instance of it`);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CannotMeasure(`${label} is not valid JSON (${err.message})`);
  }
}

// Same files run-gates.mjs and security.mjs read: <repo>/.quality-gates/.
export function gatesDir(root) {
  return join(root, '.quality-gates');
}

export function loadConfig(root) {
  const path = join(gatesDir(root), 'gates.config.json');
  const raw = existsSync(path) ? readJson(path, 'gates.config.json').legacyWeb : undefined;
  const config = mergeConfig(raw);
  const problems = validateConfig(config);
  if (problems.length > 0) throw new CannotMeasure(problems.join('; '));
  return config;
}

// ---------------------------------------------------------------- allowlist

function entryProblem(entry) {
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') return 'missing reason';
  if (!isDate(entry.expires)) return 'missing or invalid expires (YYYY-MM-DD)';
  return null;
}

// security.mjs's format: { "accepted": [{ "id", "reason", "expires" }] }. Its
// semantics too: an entry stops suppressing on its expires date (00:00 UTC).
// Stricter on one point: an entry without both reason and expires is ignored.
function legacyWebEntries(doc) {
  const accepted = Array.isArray(doc?.accepted) ? doc.accepted : [];
  return accepted.filter((e) => typeof e?.id === 'string' && e.id.startsWith('legacy-web:'));
}

export function loadAllowlist(root, onDate) {
  const path = join(gatesDir(root), 'security-allowlist.json');
  const result = { active: new Map(), expired: new Map(), invalid: [] };
  if (!existsSync(path)) return result;
  for (const entry of legacyWebEntries(readJson(path, 'security-allowlist.json'))) {
    const problem = entryProblem(entry);
    if (problem) result.invalid.push({ id: entry.id, problem });
    else (onDate >= entry.expires ? result.expired : result.active).set(entry.id, entry);
  }
  return result;
}

export function findingId(finding) {
  return `legacy-web:${finding.ruleId}:${finding.file}`;
}

// ---------------------------------------------------------------- scanner

export function scannerEntry(pkgRoot) {
  return join(pkgRoot, 'skills', 'modern-web-guidance', 'modern-web.mjs');
}

export function locateScanner(root, env = process.env) {
  if (env.MWG_HOME) {
    if (existsSync(scannerEntry(env.MWG_HOME))) return resolve(env.MWG_HOME);
    throw new CannotMeasure(`MWG_HOME is set but ${scannerEntry(env.MWG_HOME)} does not exist`);
  }
  const candidates = [
    join(HERE, 'tools', 'node_modules', 'modern-web-guidance'),
    join(root, '.quality-gates', 'tools', 'node_modules', 'modern-web-guidance'),
    join(dirname(root), '.quality-gates-kit', 'tools', 'node_modules', 'modern-web-guidance'),
  ];
  const found = candidates.find((c) => existsSync(scannerEntry(c)));
  if (!found)
    throw new CannotMeasure(
      'scanner not installed; run: npm ci --prefix .quality-gates/tools --ignore-scripts',
    );
  return found;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyScanner(pkgRoot) {
  const version = readJson(join(pkgRoot, 'package.json'), 'scanner package.json').version;
  const problems =
    version === VETTED.version ? [] : [`version ${version}, vetted ${VETTED.version}`];
  for (const [file, expected] of Object.entries(VETTED.files)) {
    const path = join(pkgRoot, 'skills', 'modern-web-guidance', file);
    if (!existsSync(path) || sha256(path) !== expected) problems.push(`${file} hash mismatch`);
  }
  if (problems.length > 0)
    throw new CannotMeasure(`scanner does not match the vetted build (${problems.join('; ')})`);
}

export function scannerEnv(env = process.env) {
  return { ...env, DISABLE_TELEMETRY: '1', ENABLE_FILE_LOGGING: 'false' };
}

export async function runScanner(pkgRoot, dir, includeDocsAndTests) {
  const args = [scannerEntry(pkgRoot), 'legacy-scan', dir, '--json'];
  if (includeDocsAndTests) args.push('--include-docs-and-tests');
  const options = {
    cwd: dir,
    env: scannerEnv(),
    timeout: 300_000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  };
  try {
    return (await run(process.execPath, args, options)).stdout;
  } catch (err) {
    if (typeof err.stdout === 'string' && err.stdout.trim().startsWith('{')) return err.stdout;
    throw new CannotMeasure(`scanner failed to run (${clean(err.message)})`);
  }
}

function isRule(rule) {
  return typeof rule?.ruleId === 'string' && Array.isArray(rule.findings);
}

function isFinding(finding) {
  return typeof finding?.file === 'string' && Number.isInteger(finding.line);
}

function checkRule(rule) {
  if (!isRule(rule) || rule.count !== rule.findings.length)
    throw new CannotMeasure('scanner output has an unexpected rule shape');
  if (!rule.findings.every(isFinding))
    throw new CannotMeasure('scanner output has an unexpected finding shape');
  return rule.count;
}

function rulesOf(guide) {
  if (!Array.isArray(guide?.rules))
    throw new CannotMeasure('scanner output has an unexpected guide shape');
  return guide.rules;
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new CannotMeasure('scanner output is not JSON');
  }
}

function checkTop(data) {
  if (typeof data?.error === 'string')
    throw new CannotMeasure(`scanner error: ${clean(data.error)}`);
  if (!Number.isInteger(data?.totalFindings) || !Array.isArray(data.guides))
    throw new CannotMeasure('scanner output is missing totalFindings/guides');
}

export function parseScan(stdout) {
  const data = parseJson(stdout);
  checkTop(data);
  const counted = data.guides.flatMap(rulesOf).reduce((sum, rule) => sum + checkRule(rule), 0);
  if (counted !== data.totalFindings)
    throw new CannotMeasure(
      `scanner output is inconsistent (${counted} listed, ${data.totalFindings} reported)`,
    );
  return data;
}

export function flattenFindings(data, prefix) {
  return data.guides.flatMap((guide) =>
    guide.rules.flatMap((rule) =>
      rule.findings.map((f) => ({
        guideId: guide.guideId,
        ruleId: rule.ruleId,
        file: posix(prefix ? join(prefix, f.file) : f.file),
        line: f.line,
        message: clean(f.message, 300),
        lineContent: clean(f.lineContent),
      })),
    ),
  );
}

export function checkCanary(data) {
  const seen = new Set(flattenFindings(data, '').map((f) => f.ruleId));
  const missing = CANARY.expect.filter((id) => !seen.has(id));
  if (missing.length > 0)
    throw new CannotMeasure(`self-test failed: scanner missed planted ${missing.join(', ')}`);
  return CANARY.expect.length;
}

export async function runCanary(pkgRoot, scan = runScanner) {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-web-canary-'));
  try {
    for (const [name, body] of Object.entries(CANARY.files))
      writeFileSync(join(dir, name), body, 'utf8');
    return checkCanary(parseScan(await scan(pkgRoot, dir, false)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- inventory

async function gitFiles(dir) {
  try {
    const { stdout } = await run(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true },
    );
    return stdout.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

// Fallback when the target is not a git checkout. Symlinks are not followed.
function walkFiles(root) {
  const out = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) out.push(posix(relative(root, full)));
    }
  }
  return out;
}

function segments(path) {
  return path
    .toLowerCase()
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..');
}

// Dot-directories (.github, .quality-gates, .factory…), vendor/build output, bundles.
function ignoredByScanner(path) {
  const segs = segments(path);
  const dirs = segs.slice(0, -1);
  if (dirs.some((d) => d.startsWith('.') || IGNORED_DIRS.has(d))) return true;
  if (segs.length === 1 && IGNORED_DIRS.has(segs[0])) return true;
  return SKIPPED_SUFFIXES.some((suffix) => path.toLowerCase().endsWith(suffix));
}

function docsOrTest(path) {
  const dirs = segments(path).slice(0, -1);
  const base = path.split('/').at(-1) ?? '';
  return (
    dirs.some((d) => DOCS_TEST_DIRS.has(d) || d.endsWith('_test_runner')) ||
    DOCS_TEST_FILES.some((re) => re.test(base))
  );
}

export function isCandidate(path, includeDocsAndTests) {
  if (ignoredByScanner(path) || (!includeDocsAndTests && docsOrTest(path))) return false;
  return (
    path.toLowerCase().endsWith('package.json') ||
    SCANNED_EXTENSIONS.has(extname(path).toLowerCase())
  );
}

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

export async function candidateFiles(dir, includeDocsAndTests) {
  const listed = await gitFiles(dir);
  const files = (listed ?? walkFiles(dir))
    .map(posix)
    .filter((p) => isCandidate(p, includeDocsAndTests));
  return { method: listed ? 'git ls-files' : 'directory walk', files };
}

export async function inventory(dir, includeDocsAndTests, prefix = '') {
  const { method, files } = await candidateFiles(dir, includeDocsAndTests);
  const sized = files
    .map((p) => ({ path: posix(join(prefix, p)), size: sizeOf(join(dir, p)) }))
    .filter((f) => f.size >= 0);
  return {
    method,
    count: sized.length,
    large: sized.filter((f) => f.size > MAX_FILE_BYTES).map((f) => f.path),
  };
}

// ---------------------------------------------------------------- decision

function bucketFor(finding, config, allow) {
  if (!config.enforce.some((entry) => ruleMatches(entry, finding.ruleId)))
    return ['advisory', finding];
  const id = findingId(finding);
  if (allow.active.has(id)) return ['allowlisted', { ...finding, id, entry: allow.active.get(id) }];
  return ['enforced', { ...finding, id, expired: allow.expired.get(id)?.expires ?? null }];
}

export function classify(findings, config, allow, onDate) {
  const result = { enforced: [], allowlisted: [], advisory: [] };
  for (const finding of findings) {
    const [bucket, item] = bucketFor(finding, config, allow);
    result[bucket].push(item);
  }
  result.blocking = onDate >= config.blockAfter; // as run-gates.mjs: blocking from 00:00 UTC that day
  result.exitCode = result.blocking && result.enforced.length > 0 ? EXIT.BLOCKED : EXIT.OK;
  return result;
}

// ---------------------------------------------------------------- reporting

function retrieveHint(root, pkgRoot) {
  return `DISABLE_TELEMETRY=1 node ${posix(relative(root, scannerEntry(pkgRoot)))} retrieve <guide-id>`;
}

function groupByGuide(findings) {
  const groups = new Map();
  for (const f of findings) groups.set(f.guideId, [...(groups.get(f.guideId) ?? []), f]);
  return groups;
}

function enforcedLines(verdict, config) {
  const mode = verdict.blocking ? 'BLOCKING' : `warn-only, blocking from ${config.blockAfter}`;
  const lines = [
    `ENFORCED (${config.enforce.join(', ')}): ${verdict.enforced.length} open, ${mode}`,
  ];
  for (const f of verdict.enforced) {
    const note = f.expired ? ` [allowlist entry expired ${f.expired}]` : '';
    lines.push(`  ${f.file}:${f.line}  ${f.message}${note}`, `    allowlist id: ${f.id}`);
  }
  for (const f of verdict.allowlisted)
    lines.push(
      `  allowlisted until ${f.entry.expires}: ${f.file}:${f.line} (${clean(f.entry.reason, 120)})`,
    );
  return lines;
}

function advisoryLines(verdict) {
  const groups = groupByGuide(verdict.advisory);
  const lines = [
    `ADVISORY: ${verdict.advisory.length} finding(s) in ${groups.size} guide(s) (never blocks)`,
  ];
  for (const [guideId, items] of groups) {
    const where = items
      .slice(0, 8)
      .map((f) => `${f.file}:${f.line}`)
      .join(', ');
    lines.push(`  ${guideId} (${items.length}): ${where}${items.length > 8 ? ', …' : ''}`);
  }
  return lines;
}

function inventoryLines(inv) {
  const lines = [
    `scanned: ${inv.count} web file(s) via ${inv.method} (dot-dirs, build output, vendor, minified and test/docs files are skipped, as upstream does)`,
  ];
  if (inv.count === 0)
    lines.push(
      'nothing to scan: no HTML/CSS/JS/TS/Astro/Vue/Svelte files here, so no findings means nothing was measured',
    );
  if (inv.large.length > 0) lines.push(`not scanned (over 1 MB): ${inv.large.join(', ')}`);
  return lines;
}

export function humanReport(ctx) {
  const { verdict, config, inv, canaryCount, root, pkgRoot, allow } = ctx;
  const lines = [
    `legacy-web: modern-web-guidance ${VETTED.version} (vetted build, telemetry off)`,
    `self-test: ${canaryCount}/${CANARY.expect.length} planted patterns detected`,
    ...inventoryLines(inv),
  ];
  for (const bad of allow.invalid) lines.push(`ignored allowlist entry ${bad.id}: ${bad.problem}`);
  lines.push(...enforcedLines(verdict, config), ...advisoryLines(verdict));
  if (verdict.enforced.length + verdict.advisory.length > 0)
    lines.push(`guides: ${retrieveHint(root, pkgRoot)}`);
  if (verdict.exitCode === EXIT.BLOCKED)
    lines.push(
      'FAIL: fix the enforced findings above, or ask Sam to allowlist them (reason + expires).',
    );
  return lines.join('\n');
}

function annotation(level, f, title) {
  return `::${level} file=${escapeProperty(f.file)},line=${f.line},title=${escapeProperty(title)}::${escapeData(f.message)}`;
}

export function annotations(verdict) {
  const level = verdict.blocking ? 'error' : 'warning';
  const enforced = verdict.enforced
    .slice(0, 10)
    .map((f) => annotation(level, f, `legacy-web ${f.ruleId}`));
  const advisory = verdict.advisory
    .slice(0, 10)
    .map((f) => annotation('notice', f, `modern-web ${f.ruleId}`));
  return [...enforced, ...advisory];
}

function mdCell(text) {
  return clean(text, 160).replace(/[|`<>*_[\]]/g, (c) => `\\${c}`);
}

export function stepSummary(verdict, config) {
  const rows = [
    ...verdict.enforced.map((f) => ['enforced', f]),
    ...verdict.advisory.map((f) => ['advisory', f]),
  ];
  const head = [
    '### legacy-web (modern-web-guidance ' + VETTED.version + ')',
    '',
    `${verdict.enforced.length} enforced (${verdict.blocking ? 'blocking' : 'warn-only, blocking from ' + config.blockAfter}), ${verdict.advisory.length} advisory, ${verdict.allowlisted.length} allowlisted.`,
  ];
  if (rows.length === 0) return head.join('\n') + '\n';
  const table = ['', '| | rule | location | finding |', '|---|---|---|---|'];
  for (const [kind, f] of rows.slice(0, 200))
    table.push(
      `| ${kind} | ${mdCell(f.ruleId)} | ${mdCell(`${f.file}:${f.line}`)} | ${mdCell(f.message)} |`,
    );
  return [...head, ...table, ''].join('\n');
}

function emit(ctx, io) {
  const report = humanReport(ctx);
  if (io.env.GITHUB_ACTIONS !== 'true') {
    io.stdout(`${report}\n`);
    return;
  }
  const token = randomUUID().replace(/-/g, '');
  io.stdout(`::stop-commands::${token}\n${report}\n::${token}::\n`);
  for (const line of annotations(ctx.verdict)) io.stdout(`${line}\n`);
  if (io.env.GITHUB_STEP_SUMMARY)
    appendFileSync(io.env.GITHUB_STEP_SUMMARY, stepSummary(ctx.verdict, ctx.config));
}

function writeJson(path, ctx) {
  const { verdict, inv, canaryCount } = ctx;
  const body = {
    tool: 'legacy-web',
    scanner: { name: 'modern-web-guidance', version: VETTED.version, integrity: VETTED.integrity },
    selfTest: { detected: canaryCount, planted: CANARY.expect.length },
    scanned: inv,
    blocking: verdict.blocking,
    exitCode: verdict.exitCode,
    enforced: verdict.enforced,
    allowlisted: verdict.allowlisted.map(({ entry, ...f }) => ({ ...f, expires: entry.expires })),
    advisory: verdict.advisory,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------- main

const USAGE = `usage: node .quality-gates/legacy-web.mjs [dir] [--json <file>]

Scans [dir] (default: current directory) for legacy web-platform patterns with
the vetted modern-web-guidance ${VETTED.version} scanner. Exit 0 = nothing blocking,
1 = enforced finding on/after blockAfter, 2 = could not measure.
Config: .quality-gates/gates.config.json "legacyWeb" { enforce, blockAfter, includeDocsAndTests }.
Allowlist: .quality-gates/security-allowlist.json "accepted" entries (id, reason, expires).`;

function parseCli(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { json: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (err) {
    throw new CannotMeasure(`${err.message}\n${USAGE}`);
  }
}

async function repoRoot(dir) {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      timeout: 30_000,
      windowsHide: true,
    });
    return resolve(stdout.trim());
  } catch {
    return dir;
  }
}

function targetDir(positionals, cwd) {
  if (positionals.length > 1) throw new CannotMeasure(`expected at most one directory\n${USAGE}`);
  const dir = resolve(cwd, positionals[0] ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new CannotMeasure(`not a directory: ${dir}`);
  return dir;
}

async function measure(dir, root, deps) {
  const config = loadConfig(root);
  const pkgRoot = locateScanner(root, deps.env);
  verifyScanner(pkgRoot);
  const prefix = posix(relative(root, dir));
  const inv = await inventory(dir, config.includeDocsAndTests, prefix);
  if (inv.count > MAX_FILES)
    throw new CannotMeasure(
      `${inv.count} candidate files exceed the scanner's ${MAX_FILES}-file cap; results would be silently truncated`,
    );
  const canaryCount = await runCanary(pkgRoot, deps.scan);
  const data =
    inv.count === 0
      ? { guides: [] }
      : parseScan(await deps.scan(pkgRoot, dir, config.includeDocsAndTests));
  const onDate = deps.today();
  const allow = loadAllowlist(root, onDate);
  const verdict = classify(flattenFindings(data, prefix), config, allow, onDate);
  return { verdict, config, inv, canaryCount, root, pkgRoot, allow };
}

function makeIo(deps) {
  return {
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? ((s) => process.stdout.write(s)),
    stderr: deps.stderr ?? ((s) => process.stderr.write(s)),
  };
}

async function execute(argv, deps, io) {
  const { values, positionals } = parseCli(argv);
  if (values.help) {
    io.stdout(`${USAGE}\n`);
    return EXIT.OK;
  }
  const dir = targetDir(positionals, deps.cwd ?? process.cwd());
  const runDeps = { env: io.env, scan: deps.scan ?? runScanner, today: deps.today ?? today };
  const ctx = await measure(dir, await repoRoot(dir), runDeps);
  emit(ctx, io);
  if (values.json) writeJson(values.json, ctx);
  return ctx.verdict.exitCode;
}

export async function main(argv, deps = {}) {
  const io = makeIo(deps);
  try {
    return await execute(argv, deps, io);
  } catch (err) {
    if (!(err instanceof CannotMeasure)) throw err;
    io.stderr(`legacy-web: cannot measure: ${err.message}\nThis is not a pass.\n`);
    return EXIT.CANNOT_MEASURE;
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`legacy-web: internal error: ${err?.stack ?? err}\n`);
      process.exitCode = EXIT.CANNOT_MEASURE;
    },
  );
}
