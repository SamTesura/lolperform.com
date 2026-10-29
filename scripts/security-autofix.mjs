/**
 * Security autofix: keep the lockfile clear of advisories that already have a
 * fix inside the version ranges our dependencies declare.
 *
 * Dependabot opens no security PR for a package we only reach through another
 * package. Each new advisory against one (source-map-js on 2026-10-06, zod under
 * @astrojs/sitemap on 2026-10-24) left the daily scan, and every PR opened in the
 * meantime, red until someone noticed, although re-resolving the lockfile was
 * the whole fix every time.
 *
 *   plan  re-resolve the flagged packages and report what that fixed
 *   ship  open a PR, run the checks on it, merge it once every check passes
 *
 * .github/workflows/security-autofix.yml runs both. Nothing here edits a
 * package.json, adds overrides or writes the security allowlist, so an advisory
 * with no patched release, or with a fix outside a parent's range, stays red for
 * a person to decide. pnpm always runs with --ignore-scripts, so no dependency
 * code executes in the job that holds a write token.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BRANCH = 'security-autofix';
export const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Pushes made with the workflow's GITHUB_TOKEN start no workflows, so the bot
 * dispatches each check on its branch itself and waits for these job names.
 * GitHub doesn't count checks from a dispatched run toward a PR's required
 * checks ("Checks from some workflow jobs are not evaluated" in its docs), so
 * once they pass, the bot records each result as a commit status of the same
 * name on the same commit, which the ruleset does count. `verify` and
 * `secret-scan` are the required ones.
 */
export const CHECK_WORKFLOWS = {
  'ci.yml': ['verify', 'secret-scan'],
  'quality-gates.yml': ['gates'],
  'quality-gates-security.yml': ['security'],
};
export const EXPECTED_CHECKS = Object.values(CHECK_WORKFLOWS).flat();

// Advisory data comes from outside. A name that isn't a plain npm name never
// reaches a command line, so "--registry=…" can't pass for a package.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PASSING = new Set(['success', 'neutral', 'skipped']);
const BOT = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};

/**
 * `pnpm audit --json` → advisories, or null when the output is not an audit
 * report (pnpm prints an error instead when the lockfile is out of date).
 * `paths` lists every vulnerable copy as "version|dependency path".
 */
export function parseAudit(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== 'object') return null;
  if (doc.advisories === null || typeof doc.advisories !== 'object') return null;
  return Object.values(doc.advisories).map((a) => {
    const findings = Array.isArray(a.findings) ? a.findings : [];
    const paths = findings.flatMap((f) =>
      (Array.isArray(f?.paths) ? f.paths : []).map((p) => `${f.version}|${p}`),
    );
    return {
      id: String(a.id),
      name: String(a.module_name ?? ''),
      severity: String(a.severity ?? ''),
      patched: String(a.patched_versions ?? ''),
      ghsa: String(a.github_advisory_id ?? ''),
      title: String(a.title ?? ''),
      // An advisory reported without findings still counts as one copy.
      paths: paths.length ? paths : ['*'],
    };
  });
}

/** pnpm reports "<0.0.0" as the patched range when no fixed release exists. */
export function isFixable(advisory) {
  return advisory.patched !== '' && advisory.patched !== '<0.0.0';
}

/** Valid package names with a patched release, each once, sorted. */
export function packagesToRefresh(advisories) {
  const names = advisories.filter(isFixable).map((a) => a.name);
  return [...new Set(names)].filter((name) => PACKAGE_NAME.test(name)).sort();
}

const copies = (advisories) =>
  new Set(advisories.flatMap((a) => a.paths.map((p) => `${a.id}|${p}`)));

/**
 * What a refresh did, counted per vulnerable copy rather than per advisory: an
 * advisory reached through two packages can be fixed on one path and not the
 * other, and that is still progress. `added` lists copies the refresh brought
 * in, of any advisory.
 */
export function compareAudits(before, after) {
  const was = copies(before);
  const now = copies(after);
  const fixable = copies(before.filter(isFixable));
  return {
    removed: [...fixable].filter((key) => !now.has(key)),
    added: [...now].filter((key) => !was.has(key)),
  };
}

/** Advisories the refresh helped, each with how many vulnerable copies are left. */
export function improved(before, after) {
  const now = copies(after);
  return before
    .filter((a) => isFixable(a) && PACKAGE_NAME.test(a.name))
    .map((a) => ({ ...a, left: a.paths.filter((p) => now.has(`${a.id}|${p}`)).length }))
    .filter((a) => a.left < a.paths.length);
}

/** Paths in `git status --porcelain` output other than the lockfile. */
export function unexpectedChanges(porcelain) {
  return porcelain
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== '' && path !== LOCKFILE);
}

export function titleFor(fixed) {
  const names = [...new Set(fixed.map((a) => a.name))];
  const shown =
    names.length > 3
      ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
      : names.join(', ');
  const target = names.length === 1 ? 'a patched release' : 'patched releases';
  return `chore(deps): refresh ${shown} to ${target}`;
}

// Advisory text lands in a PR body and a commit message: no @-mentions, no
// HTML, no Markdown links or images, no broken tables.
const plain = (text) =>
  text
    .replace(/@/g, '@​')
    .replace(/[<>|`[\]()!\r\n]/g, ' ')
    .slice(0, 120);
const code = (text) => `\`${text.replace(/[`\r\n|]/g, '').slice(0, 60)}\``;

export function renderBody(fixed, remaining) {
  const status = (a) =>
    a.left === undefined ? '' : a.left === 0 ? 'fixed' : `partly: ${a.left} left`;
  const header = [
    '| Package | Severity | Advisory | Fixed in | Status | Title |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const rows = (list) =>
    list.map(
      (a) =>
        `| ${code(a.name)} | ${plain(a.severity)} | ${plain(a.ghsa || a.id)} | ${code(a.patched)} | ${status(a)} | ${plain(a.title)} |`,
    );
  const lines = [
    'Opened by `.github/workflows/security-autofix.yml`.',
    '',
    `Re-resolved inside the version ranges our dependencies already declare. Only \`${LOCKFILE}\` changes.`,
    '',
    ...header,
    ...rows(fixed),
    '',
  ];
  if (remaining.length) {
    lines.push(
      "Still reported after the refresh, so left for a person (no patched release yet, or the fix is outside a parent package's range):",
      '',
      ...header,
      ...rows(remaining),
      '',
    );
  }
  lines.push(
    `This PR merges itself once ${EXPECTED_CHECKS.join(', ')} pass on it. They run as dispatched workflows, which GitHub doesn't count for a PR, so the bot records each passing result as a commit status of the same name first. If any check fails, the PR stays open for review.`,
  );
  return `${lines.join('\n')}\n`;
}

/** The newest check run of each name. */
export function newestRuns(runs) {
  const newest = new Map();
  for (const run of runs) {
    const seen = newest.get(run.name);
    if (!seen || run.id > seen.id) newest.set(run.name, run);
  }
  return newest;
}

/**
 * The newest check run of each name on the PR head decides. Every expected
 * check must pass. Any other check (the Cloudflare preview build) must not
 * fail, and one still running is waited for.
 */
export function checkVerdict(runs, expected = EXPECTED_CHECKS) {
  const newest = newestRuns(runs);
  const latest = [...newest.values()];
  const failed = latest.filter((r) => r.status === 'completed' && !PASSING.has(r.conclusion));
  if (failed.length) {
    return { verdict: 'fail', detail: failed.map((r) => `${r.name}: ${r.conclusion}`) };
  }
  const waiting = new Set(expected.filter((name) => newest.get(name)?.status !== 'completed'));
  for (const r of latest) if (r.status !== 'completed') waiting.add(r.name);
  if (waiting.size) return { verdict: 'pending', detail: [...waiting] };
  return { verdict: 'pass', detail: [] };
}

/* ------------------------------------------------------------ side effects */

function sh(cmd, args, { check = true, quiet = true } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const result = { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  if (check && r.status !== 0) {
    throw new Error(`${cmd} ${args[0]} exited with ${r.status}\n${result.stderr.slice(-2000)}`);
  }
  return result;
}

/** `pnpm audit` exits 1 whenever it finds anything, so its status says nothing here. */
const audit = () => parseAudit(sh('pnpm', ['audit', '--json'], { check: false }).stdout);

function setOutputs(values) {
  // One line per value: a newline in a value would forge another output.
  const lines = Object.entries(values).map(
    ([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`,
  );
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  for (const line of lines) console.info(line);
}

function report(message) {
  console.info(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
  }
}

function settle(state, message) {
  setOutputs({ state });
  report(message);
  return 0;
}

/** Why a refresh can't be offered, or null when it can. */
function refusal(after, stray, added, fixed) {
  if (!after) return 'pnpm audit produced no report after the refresh.';
  if (stray.length) return `pnpm also changed ${stray.join(', ')}.`;
  if (added.length) return 'The refresh would bring in other vulnerable versions.';
  if (!fixed.length) return 'Re-resolving inside the declared ranges fixed nothing.';
  return null;
}

export function plan() {
  const before = audit();
  if (!before) {
    return settle(
      'error',
      'pnpm audit produced no report; the security workflow flags scanner problems itself.',
    );
  }
  const names = packagesToRefresh(before);
  if (!names.length) {
    // Nothing a refresh can change. An advisory with no patched release is a
    // person's call, and may already be accepted in the security allowlist.
    const note = before.length
      ? ` ${before.length} advisory(ies) have no patched release; that is a person's call.`
      : '';
    return settle('clean', `Nothing for a lockfile refresh to fix.${note}`);
  }

  console.info(`Re-resolving ${names.join(', ')}`);
  const updated = sh(
    'pnpm',
    ['update', '--recursive', '--depth', 'Infinity', '--ignore-scripts', ...names],
    { check: false, quiet: false },
  );
  if (updated.status !== 0) console.info('pnpm update failed; trying pnpm dedupe alone.');
  let after = updated.status === 0 ? audit() : null;
  if (!after || packagesToRefresh(after).length) {
    // A package that is also one of our direct dependencies keeps its nested
    // copies through `pnpm update` (zod under @astrojs/sitemap did). dedupe
    // moves those onto the fixed version the lockfile already holds.
    console.info('Still flagged; running pnpm dedupe.');
    sh('pnpm', ['dedupe', '--ignore-scripts'], { quiet: false });
    after = audit();
  }

  const stray = unexpectedChanges(sh('git', ['status', '--porcelain']).stdout);
  const added = after ? compareAudits(before, after).added : [];
  const fixed = after ? improved(before, after) : [];
  const why = refusal(after, stray, added, fixed);
  if (why) {
    sh('git', ['checkout', '--', '.']);
    return settle('stuck', `${why} A person has to decide.`);
  }

  // The lockfile must install exactly as written, as CI will install it.
  sh('pnpm', ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts']);
  const body = join(process.env.RUNNER_TEMP ?? tmpdir(), 'security-autofix-body.md');
  writeFileSync(body, renderBody(fixed, after));
  setOutputs({ state: 'fixed', title: titleFor(fixed), body });
  report(`Fixes ${fixed.map((a) => `${a.name} (${plain(a.ghsa || a.id)})`).join(', ')}.`);
  return 0;
}

const repo = () => process.env.GITHUB_REPOSITORY ?? '';

// -R on every gh call: gh then never touches the local checkout, so a merge
// can't report failure over a local branch it couldn't switch away from.
const gh = (args, options) => sh('gh', [...args, '-R', repo()], options);
const api = (path, args = []) =>
  sh('gh', ['api', ...args, `repos/${repo()}/${path}`], { check: false });

/** The bot's own open PR. A fork's branch of the same name is never it. */
function findOpenPr() {
  const args = ['pr', 'list', '--head', BRANCH, '--base', 'main', '--state', 'open'];
  const out = gh([...args, '--json', 'number,isCrossRepository']).stdout;
  return JSON.parse(out).find((pr) => pr.isCrossRepository === false) ?? null;
}

/**
 * Tip of our branch on GitHub when it is exactly the commit just built: the
 * same tree on the same main. Anything else there means a fresh push.
 */
function pushedTipOfSameFix() {
  const res = api(`branches/${BRANCH}`);
  if (res.status !== 0) return null;
  const tip = JSON.parse(res.stdout).commit;
  const tree = sh('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim();
  const base = sh('git', ['rev-parse', 'HEAD~1']).stdout.trim();
  const same = tip?.commit?.tree?.sha === tree && tip?.parents?.[0]?.sha === base;
  return same ? tip.sha : null;
}

function openOrUpdatePr(existing, title, bodyFile) {
  if (existing) {
    gh(['pr', 'edit', String(existing.number), '--title', title, '--body-file', bodyFile]);
    return existing.number;
  }
  const args = ['pr', 'create', '--base', 'main', '--head', BRANCH];
  const created = gh([...args, '--title', title, '--body-file', bodyFile], { check: false });
  if (created.status !== 0) {
    const hint = /not permitted to create or approve pull requests/i.test(created.stderr)
      ? '\nTurn on Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".'
      : '';
    throw new Error(`gh pr create failed: ${created.stderr.trim()}${hint}`);
  }
  const pr = findOpenPr();
  if (!pr) throw new Error('gh pr create succeeded but the PR is not listed.');
  return pr.number;
}

function checkRuns(sha) {
  const res = api(`commits/${sha}/check-runs?per_page=100`);
  if (res.status !== 0) return null;
  return JSON.parse(res.stdout).check_runs.map(({ id, name, status, conclusion, html_url }) => ({
    id,
    name,
    status,
    conclusion,
    url: html_url,
  }));
}

/**
 * A closed, unmerged autofix PR whose head had exactly this tree: a person
 * looked at this fix and turned it down, so it is not offered again until main
 * moves on and the fix comes out different.
 */
function rejectedWithSameTree(tree) {
  const args = ['pr', 'list', '--head', BRANCH, '--base', 'main', '--state', 'closed'];
  const fields = ['--limit', '10', '--json', 'number,isCrossRepository,mergedAt,headRefOid'];
  for (const pr of JSON.parse(gh([...args, ...fields]).stdout)) {
    if (pr.isCrossRepository !== false || pr.mergedAt) continue;
    const commit = api(`git/commits/${pr.headRefOid}`);
    if (commit.status === 0 && JSON.parse(commit.stdout).tree?.sha === tree) return pr.number;
  }
  return null;
}

const startChecks = (ref) => {
  for (const workflow of Object.keys(CHECK_WORKFLOWS)) {
    gh(['workflow', 'run', workflow, '--ref', ref]);
  }
};

async function waitForChecks(sha, { timeoutMs = 30 * 60_000, everyMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let result = { verdict: 'pending', detail: EXPECTED_CHECKS, runs: [] };
  while (Date.now() < deadline) {
    const runs = checkRuns(sha);
    if (runs) {
      result = { ...checkVerdict(runs), runs };
      if (result.verdict !== 'pending') return result;
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return { ...result, verdict: 'timed out' };
}

/** Each passed check, recorded as a commit status the ruleset counts. */
function recordStatuses(sha, runs) {
  const newest = newestRuns(runs);
  for (const name of EXPECTED_CHECKS) {
    const run = newest.get(name);
    const fields = [
      '-f',
      'state=success',
      '-f',
      `context=${name}`,
      '-f',
      'description=Passed in a dispatched run; recorded by security-autofix',
      '-f',
      `target_url=${run.url}`,
    ];
    const res = api(`statuses/${sha}`, ['-X', 'POST', ...fields]);
    if (res.status !== 0) throw new Error(`Recording ${name} failed: ${res.stderr.trim()}`);
  }
}

/** Fresh results on main: GITHUB_TOKEN merges start no workflows there either. */
function recheckMain() {
  for (const workflow of Object.keys(CHECK_WORKFLOWS)) {
    const res = gh(['workflow', 'run', workflow, '--ref', 'main'], { check: false });
    if (res.status !== 0) console.info(`::warning::Could not start ${workflow} on main.`);
  }
}

/**
 * A run that pushed a fix or started its checks fails loudly when it can't merge
 * it. Later runs only re-check the same PR, and repeating that failure every six
 * hours would add noise and no information: the open PR and the red scan
 * already say it.
 */
function problem(loud, message) {
  report(message);
  if (loud) return 1;
  console.info(
    `::warning::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`,
  );
  return 0;
}

/** main has nothing a refresh can fix: drop what an earlier run left behind. */
function tidyUp(existing) {
  if (existing) {
    const comment = 'main has no fixable advisory any more, so this is no longer needed.';
    gh(['pr', 'close', String(existing.number), '--delete-branch', '--comment', comment]);
    report(`Closed PR #${existing.number}: nothing left to fix.`);
  } else if (api(`git/refs/heads/${BRANCH}`, ['-X', 'DELETE']).status === 0) {
    report(`Deleted the leftover ${BRANCH} branch.`);
  }
  return 0;
}

function commitFix(title, bodyFile) {
  sh('gh', ['auth', 'setup-git']);
  sh('git', ['config', 'user.name', BOT.name]);
  sh('git', ['config', 'user.email', BOT.email]);
  sh('git', ['switch', '--force-create', BRANCH]);
  sh('git', ['add', LOCKFILE]);
  const message = join(process.env.RUNNER_TEMP ?? tmpdir(), 'security-autofix-commit.txt');
  writeFileSync(message, `${title}\n\n${readFileSync(bodyFile, 'utf8')}`);
  sh('git', ['commit', '--quiet', '--file', message]);
}

export async function ship() {
  const state = process.env.PLAN_STATE ?? '';
  if (state !== 'fixed' && state !== 'clean') {
    console.info(`Nothing to ship (plan state: ${state || 'missing'}).`);
    return 0;
  }
  const existing = findOpenPr();
  if (state === 'clean') return tidyUp(existing);

  const title = process.env.PLAN_TITLE ?? '';
  const bodyFile = process.env.PLAN_BODY ?? '';
  commitFix(title, bodyFile);
  const base = sh('git', ['rev-parse', 'HEAD~1']).stdout.trim();

  if (!existing) {
    const rejected = rejectedWithSameTree(sh('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim());
    if (rejected) {
      report(`This exact fix was closed without merging in PR #${rejected}; not opening it again.`);
      return 0;
    }
  }
  const pushed = existing ? pushedTipOfSameFix() : null;
  let head = pushed;
  let number = existing?.number;
  let loud = true;
  if (pushed === null) {
    sh('git', ['push', '--force', 'origin', `HEAD:refs/heads/${BRANCH}`]);
    head = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
    number = openOrUpdatePr(existing, title, bodyFile);
    startChecks(BRANCH);
    report(`Opened or updated PR #${number} and started ${EXPECTED_CHECKS.join(', ')} on it.`);
  } else {
    // An earlier run may have stopped between pushing and starting the checks.
    const started = (checkRuns(head) ?? []).some((r) => EXPECTED_CHECKS.includes(r.name));
    if (!started) startChecks(BRANCH);
    loud = !started;
    report(
      `PR #${number} already carries this fix; ${started ? 'checking it again' : 'starting its checks'}.`,
    );
  }

  const result = await waitForChecks(head);
  if (result.verdict !== 'pass') {
    return problem(
      loud,
      `Not merging PR #${number}: checks ${result.verdict} (${result.detail.join(', ')}).`,
    );
  }
  // The checks ran on main as it was when this fix was planned. If main has
  // moved since, the merge would combine trees nothing tested; the next run
  // plans again on the new main.
  const mainNow = api('branches/main');
  const mainSha = mainNow.status === 0 ? JSON.parse(mainNow.stdout).commit?.sha : null;
  if (mainSha !== base) {
    const why = mainSha ? 'main moved since this fix was planned' : 'main could not be read';
    return problem(false, `Not merging PR #${number}: ${why}; the next run plans again.`);
  }
  recordStatuses(head, result.runs);
  // --match-head-commit: merge exactly the commit the checks ran on.
  const merged = gh(
    ['pr', 'merge', String(number), '--squash', '--delete-branch', '--match-head-commit', head],
    { check: false },
  );
  if (merged.status !== 0) {
    return problem(loud, `Checks passed but merging PR #${number} failed: ${merged.stderr.trim()}`);
  }
  report(`Merged PR #${number}.`);
  recheckMain();
  return 0;
}

const COMMANDS = { plan, ship };

async function main(name) {
  if (!Object.hasOwn(COMMANDS, name)) {
    console.error('usage: node scripts/security-autofix.mjs plan|ship');
    return 2;
  }
  return COMMANDS[name]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
