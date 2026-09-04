/**
 * Security scanners — deterministic, no model in the decision path.
 *
 *   secrets       gitleaks       (pre-push and CI)
 *   dependencies  npm/pnpm audit (CI)
 *   sast          semgrep        (CI)
 *
 * Every finding is compared against a committed allowlist. A finding that is
 * not allowlisted fails the gate. Nothing here asks a model whether a finding
 * is real — a model that reads dependency metadata, README text and source
 * comments is reading attacker-influenced input, and a security control whose
 * bypass is "write a convincing comment" is not a control. Triage happens out
 * of band; its output is a reviewed, committed allowlist entry.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

/** Repo-relative, forward-slashed, so an id means the same thing everywhere. */
function relativePath(root, file) {
  if (!file) return '';
  const rel = isAbsolute(file) ? relative(root, file) : file;
  return rel.replace(/\\/g, '/');
}

/** Big enough that a chatty scanner is never mistaken for a failing one. */
const MAX_BUFFER = 64 * 1024 * 1024;

export function haveBinary(name) {
  const probe = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`;
  return spawnSync(probe, { shell: true, stdio: 'ignore' }).status === 0;
}

/**
 * Finding gitleaks without requiring everyone to install it system-wide.
 * Checked in order: an explicit GITLEAKS_PATH, the PATH, a copy vendored
 * beside the repo in the shared kit, or one dropped into .quality-gates/bin.
 * Returns a shell-safe invocation, or null when there is genuinely none.
 */
export function resolveGitleaks(root) {
  // Both spellings in every location: the same checkout gets used from Windows,
  // from a Linux VM over the same mount, and from CI, and a vendored copy is
  // useless if it is only looked for under one platform's filename.
  const names = ['gitleaks.exe', 'gitleaks'];
  const dirs = [join(root, '.quality-gates', 'bin'), join(root, '..', '.quality-gates-kit', 'bin')];
  const candidates = [process.env.GITLEAKS_PATH];
  for (const d of dirs) for (const n of names) candidates.push(join(d, n));
  for (const c of candidates.filter(Boolean)) {
    if (existsSync(c)) return `"${c}"`;
  }
  return haveBinary('gitleaks') ? 'gitleaks' : null;
}

function run(command, cwd) {
  const res = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: MAX_BUFFER,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error ?? null,
  };
}

/* ------------------------------------------------------------------ secrets */

/**
 * `--redact` is not optional. A caught secret must never be written into a CI
 * log, a terminal scrollback, or a gate report — those are all places it can
 * be read later by someone who could not read the repo.
 *
 * mode 'files'   — scan the working tree (fast; what the pre-push hook wants)
 * mode 'history' — scan all of git history (what CI wants, and the one-time audit)
 */
export function scanSecrets(root, mode = 'files') {
  const bin = resolveGitleaks(root);
  if (!bin) return { available: false, findings: [] };

  /**
   * gitleaks renamed its subcommands at v8.19: `detect` became `git`, and
   * `detect --no-git` became `dir`. On a new gitleaks the old spelling is
   * accepted but scans nothing and exits 0 — a silent no-op that reports
   * success. Probe for the modern commands rather than trusting either.
   */
  const modern = spawnSync(`${bin} dir --help`, { shell: true, stdio: 'ignore' }).status === 0;
  const cmd = modern
    ? `${bin} ${mode === 'history' ? 'git' : 'dir'} "${root}"`
    : `${bin} detect --source "${root}"${mode === 'history' ? '' : ' --no-git'}`;

  const dir = mkdtempSync(join(tmpdir(), 'gl-'));
  const report = join(dir, 'gitleaks.json');
  try {
    const r = run(
      `${cmd} --redact --no-banner --report-format json --report-path "${report}" --exit-code 0`,
      root,
    );

    if (!existsSync(report)) {
      // The scanner ran but produced nothing to read. Treat as a hard error
      // rather than "no findings" — silently measuring nothing is the failure
      // mode this whole stack exists to prevent.
      return {
        available: true,
        error: `gitleaks produced no report.\n${(r.stderr || r.stdout).slice(-500)}`,
        findings: [],
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(report, 'utf8') || '[]');
    } catch (err) {
      return { available: true, error: `unreadable gitleaks report: ${err.message}`, findings: [] };
    }

    const findings = (parsed ?? []).map((f) => {
      // gitleaks reports the path it was handed, which is absolute here. An id
      // built from that would be machine-specific: an entry accepted on a dev
      // box would never match the same finding in CI, so the allowlist would
      // silently do nothing where it matters most.
      const rel = relativePath(root, f.File ?? '');
      return {
        tool: 'gitleaks',
        // Line-sensitive on purpose: a moved secret resurfaces rather than
        // staying allowlisted. For secrets that is the correct way to fail.
        id: `gitleaks:${f.RuleID}:${rel}:${f.StartLine}`,
        rule: f.RuleID ?? 'unknown',
        file: rel,
        line: f.StartLine ?? 0,
        severity: 'critical',
        // Description only. The match itself is redacted by gitleaks and must
        // never be reconstructed here.
        detail: f.Description ?? f.RuleID ?? 'secret detected',
      };
    });
    return { available: true, findings };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- dependencies */

/**
 * `--omit=dev` / `--prod` is load-bearing. Without it, CVEs in build tooling
 * that never ships to production dominate the output, the allowlist becomes a
 * landfill, and the real findings are lost in it.
 */
export function scanDependencies(root, pm = 'npm') {
  const findings = [];
  if (!existsSync(join(root, 'package.json'))) return { available: false, findings };
  if (!haveBinary(pm)) return { available: false, findings };

  const cmd =
    pm === 'pnpm'
      ? 'pnpm audit --prod --json'
      : pm === 'yarn'
        ? 'yarn npm audit --environment production --json'
        : 'npm audit --omit=dev --json';

  const r = run(cmd, root);
  const text = r.stdout.trim();
  if (!text) {
    return {
      available: true,
      error: `${pm} audit produced no output.\n${r.stderr.slice(-400)}`,
      findings,
    };
  }

  // npm emits one JSON object; pnpm emits an object; yarn berry emits NDJSON.
  let docs;
  try {
    docs = [JSON.parse(text)];
  } catch {
    docs = text
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const SEVERE = new Set(['high', 'critical']);
  for (const doc of docs) {
    // npm 7+ / pnpm shape
    const vulns = doc?.vulnerabilities ?? doc?.advisories ?? {};
    for (const [name, v] of Object.entries(vulns)) {
      const severity = String(v.severity ?? '').toLowerCase();
      if (!SEVERE.has(severity)) continue;
      const via = Array.isArray(v.via) ? v.via.find((x) => typeof x === 'object') : null;
      const advisory = via?.url ?? via?.source ?? v.url ?? name;
      findings.push({
        tool: `${pm}-audit`,
        id: `${pm}-audit:${name}:${severity}`,
        rule: String(advisory),
        file: 'package.json',
        line: 0,
        severity,
        detail: `${name}: ${via?.title ?? v.title ?? 'known vulnerability'} (${severity})`,
      });
    }
  }
  return { available: true, findings };
}

/* --------------------------------------------------------------------- sast */

export function scanSast(root, config = 'p/ci') {
  if (!haveBinary('semgrep')) return { available: false, findings: [] };

  const r = run(`semgrep scan --config ${config} --json --quiet --no-error --timeout 120`, root);
  const text = r.stdout.trim();
  if (!text) {
    return { available: true, error: `semgrep produced no output.\n${r.stderr.slice(-400)}`, findings: [] };
  }

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { available: true, error: `unreadable semgrep output: ${err.message}`, findings: [] };
  }

  /**
   * semgrep exits 0 and emits well-formed JSON with zero results when it could
   * not fetch its ruleset — a network block, a bad config name, an expired
   * token. That reads identically to "your code is clean". Its own `errors`
   * array is the only thing that distinguishes them, so an error there is a
   * scanner failure, never a pass.
   */
  const errs = Array.isArray(doc.errors) ? doc.errors : [];
  if (errs.length) {
    const first = errs
      .slice(0, 3)
      .map((e) => e.message ?? e.type ?? JSON.stringify(e))
      .join('; ');
    return { available: true, error: `semgrep reported ${errs.length} error(s): ${first}`, findings: [] };
  }
  if (!Array.isArray(doc.results)) {
    return { available: true, error: 'semgrep output had no results array', findings: [] };
  }

  const SEVERE = new Set(['ERROR', 'WARNING']);
  const findings = (doc.results ?? [])
    .filter((res) => SEVERE.has(String(res.extra?.severity ?? '').toUpperCase()))
    .map((res) => ({
      tool: 'semgrep',
      // check_id + path, deliberately without the line number, so ordinary
      // edits above a finding do not resurface an accepted one.
      id: `semgrep:${res.check_id}:${relativePath(root, res.path)}`,
      rule: res.check_id,
      file: relativePath(root, res.path),
      line: res.start?.line ?? 0,
      severity: String(res.extra?.severity ?? 'warning').toLowerCase(),
      detail: res.extra?.message ?? res.check_id,
    }));
  return { available: true, findings };
}

/* ---------------------------------------------------------------- allowlist */

export function loadAllowlist(path) {
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(doc.accepted) ? doc.accepted : [];
  } catch {
    return null;
  }
}

/**
 * An entry only suppresses a finding while it is unexpired. An accepted risk
 * that never comes back for review is just a hole with paperwork.
 */
export function partitionFindings(findings, allowlist, today = new Date()) {
  const entries = allowlist ?? [];
  const live = [];
  const accepted = [];
  const expired = [];

  for (const f of findings) {
    const entry = entries.find((e) => e.id === f.id);
    if (!entry) {
      live.push(f);
      continue;
    }
    const expires = entry.expires ? new Date(`${entry.expires}T00:00:00Z`) : null;
    if (expires && today.getTime() >= expires.getTime()) {
      expired.push({ ...f, acceptedReason: entry.reason, expiredOn: entry.expires });
      live.push(f);
    } else {
      accepted.push({ ...f, acceptedReason: entry.reason });
    }
  }
  return { live, accepted, expired };
}
