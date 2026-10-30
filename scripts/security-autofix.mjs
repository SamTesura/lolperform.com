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
 *   plan  re-resolve the flagged packages and report what that fixed. Runs in a
 *         job with a read-only token, and pnpm runs with --ignore-scripts, so no
 *         dependency code runs and nothing here could write to the repository.
 *   ship  open a PR with that lockfile, run the checks on it, merge it once they
 *         pass. Runs in the job that holds the write token, and never runs pnpm.
 *
 * .github/workflows/security-autofix.yml runs both. Nothing here edits a
 * package.json, adds overrides or writes the security allowlist, so an advisory
 * with no patched release, or with a fix outside a parent's range, stays red for
 * a person to decide.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAllowlist, partitionFindings, scanDependencies } from '../.quality-gates/security.mjs';

export const BRANCH = 'security-autofix';
export const LOCKFILE = 'pnpm-lock.yaml';

/**
 * Days a release must have been public before the bot merges it on its own. A
 * hijacked maintainer account can publish a "fix" with an install-time payload,
 * and CI runs install scripts before any check can notice. Such releases are
 * usually caught and pulled within days. A version already in the lockfile has
 * been installed here before, so a pure dedupe merges at once.
 */
export const MIN_RELEASE_AGE_DAYS = 3;

/**
 * Pushes made with the workflow's GITHUB_TOKEN start no workflows, so the bot
 * dispatches each check on its branch itself and waits for these job names.
 * GitHub doesn't count checks from a dispatched run toward a PR's required
 * checks ("Checks from some workflow jobs are not evaluated" in its docs), so
 * the bot records each result as a commit status of the same name on the same
 * commit, which the ruleset does count. `verify` and `secret-scan` are the
 * required ones.
 */
export const CHECK_WORKFLOWS = {
  'ci.yml': ['verify', 'secret-scan'],
  'quality-gates.yml': ['gates'],
  'quality-gates-security.yml': ['security'],
};
export const EXPECTED_CHECKS = Object.values(CHECK_WORKFLOWS).flat();

// Advisory and lockfile data come from outside. A name that isn't a plain npm
// name never reaches a command line, so "--registry=…" can't pass for a package.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const VERSION = /^[0-9A-Za-z.+-]+$/;
const PASSING = new Set(['success', 'neutral', 'skipped']);
const BOT = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
};
const MARKER = 'security-autofix-fix';
const WITHDRAWN = 'security-autofix-withdrawn';
const DAY_MS = 24 * 60 * 60 * 1000;
// The Cloudflare preview build, and how long after a push it gets to report.
const PREVIEW_APP = 'cloudflare-workers-and-pages';
const PREVIEW_WAIT_MS = 15 * 60_000;

/* ------------------------------------------------------------ pure helpers */

/**
 * A dependency path without versions: "apps/web > @astrojs/sitemap@3.7.4 >
 * zod@4.5.4" → "apps/web > @astrojs/sitemap > zod". Updating a parent changes
 * the versions along a path but not which copy it is, so copies are compared
 * by this, never by the raw text.
 */
export const pathShape = (path) =>
  String(path)
    .split(' > ')
    .map((segment) => segment.replace(/\(.*\)$/, '').replace(/(.)@[^@]*$/, '$1'))
    .join(' > ');

/**
 * `pnpm audit --json` → advisories, or null when the output is not an audit
 * report (pnpm prints an error instead when the lockfile is out of date).
 * `paths` lists where each vulnerable copy sits, as version-free path shapes.
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
    const paths = [
      ...new Set(findings.flatMap((f) => (Array.isArray(f?.paths) ? f.paths : []).map(pathShape))),
    ];
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
 * What a refresh did, counted per vulnerable copy (advisory and path shape)
 * rather than per advisory: an advisory reached through two packages can be
 * fixed on one path and not the other, and that is still progress. A copy that
 * moved to another still-vulnerable version is neither. `added` lists copies the
 * refresh exposed that weren't exposed before, of any advisory.
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

/** Every "name@version" in a pnpm v9 lockfile's `packages:` section. */
export function lockfilePackages(text) {
  const keys = new Set();
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) inPackages = line.startsWith('packages:');
    const m = inPackages && /^ {2}(?! )('?)(.+)\1:$/.exec(line);
    if (m) keys.add(m[2]);
  }
  return keys;
}

/** Every package one of our workspace packages depends on directly, from `importers:`. */
export function directDependencies(text) {
  const names = new Set();
  let inImporters = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) inImporters = line.startsWith('importers:');
    const m = inImporters && /^ {6}(?! )('?)(.+)\1:$/.exec(line);
    if (m) names.add(m[2]);
  }
  return names;
}

/** "name@version" → its parts; the name may itself start with "@". */
export function splitKey(key) {
  const at = key.lastIndexOf('@');
  return at > 0 ? { name: key.slice(0, at), version: key.slice(at + 1) } : null;
}

/** Package versions the refresh added to, and dropped from, the lockfile. */
export function lockfileDelta(beforeText, afterText) {
  const before = lockfilePackages(beforeText);
  const after = lockfilePackages(afterText);
  return {
    added: [...after].filter((key) => !before.has(key)).sort(),
    removed: [...before].filter((key) => !after.has(key)).sort(),
  };
}

/**
 * Identifies a fix by what it changes in the lockfile, not by the whole tree,
 * so a fix a person turned down stays turned down after main moves on.
 */
export function fixSignature(delta) {
  const text = JSON.stringify([delta.added, delta.removed]);
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * A PR body whose signature no longer reads as a person's veto. The bot closing
 * its own PR, because main needs it no more, doesn't turn the change down.
 */
export const withdraw = (body) =>
  String(body ?? '').replaceAll(`<!-- ${MARKER}: `, `<!-- ${WITHDRAWN}: `);

/**
 * When the newest added version is old enough to merge on its own. `at` is ''
 * when nothing new comes in, 'unknown' when a publish date couldn't be read
 * (a person decides), or an ISO time.
 */
export function mergeAfter(published, days = MIN_RELEASE_AGE_DAYS) {
  if (!published.length) return { at: '', youngest: '' };
  const unknown = published.find((p) => !p.time || Number.isNaN(Date.parse(p.time)));
  if (unknown) return { at: 'unknown', youngest: unknown.key };
  const youngest = published.reduce((a, b) => (Date.parse(b.time) > Date.parse(a.time) ? b : a));
  return {
    at: new Date(Date.parse(youngest.time) + days * DAY_MS).toISOString(),
    youngest: youngest.key,
  };
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

// Advisory text lands in a PR body: no @-mentions, no issue references or
// closing keywords, no links, no HTML, no broken tables.
export const plain = (text) =>
  text
    .replace(/@/g, '@\u200b')
    .replace(/#/g, '#\u200b')
    .replace(/:\/\//g, ':\u200b//')
    .replace(/www\./gi, (m) => `${m.slice(0, 3)}\u200b.`)
    .replace(/[<>|`[\]()!\r\n]/g, ' ')
    .slice(0, 120);
const code = (text) => `\`${text.replace(/[`\r\n|]/g, '').slice(0, 60)}\``;

/** The PR body. Advisory titles appear only here, sanitized; never in a commit. */
export function renderBody({ fixed, remaining, added, cooldown, signature }) {
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
      'Still reported after the refresh, but none of these would fail the security check:',
      '',
      ...header,
      ...rows(remaining),
      '',
    );
  }
  if (added.length) {
    const list = added.map(
      (p) => `${code(p.key)} (published ${p.time ? p.time.slice(0, 10) : 'unknown'})`,
    );
    const when =
      cooldown.at === 'unknown'
        ? 'A publish date could not be read, so this waits for a person to merge it.'
        : `It merges itself no earlier than ${cooldown.at.slice(0, 16).replace('T', ' ')} UTC, ${MIN_RELEASE_AGE_DAYS} days after the newest of them was published, so a freshly compromised release has time to be caught.`;
    lines.push(`New to the lockfile: ${list.join(', ')}. ${when}`, '');
  } else {
    lines.push(
      'Every version it uses was already in the lockfile, so it merges as soon as the checks pass.',
      '',
    );
  }
  lines.push(
    `The checks (${EXPECTED_CHECKS.join(', ')}) run as dispatched workflows, which GitHub doesn't count for a PR, so the bot records each result as a commit status of the same name, linking to its run. If one fails, re-run it from that link; the bot merges on a later pass once all of them are green. Any other check here, such as the Cloudflare preview, must pass too.`,
    '',
    'GitHub may also show workflows awaiting approval: the regular PR checks, held because a bot opened this PR. Approving them is optional, but once approved they must pass as well. Closing this PR tells the bot not to offer this exact change again.',
    '',
    `<!-- ${MARKER}: ${signature} -->`,
  );
  return `${lines.join('\n')}\n`;
}

/** The commit message: package names and advisory ids only, no advisory text. */
export function commitMessage(title, fixed) {
  const lines = fixed.map((a) => `- ${a.name}: ${plain(a.ghsa || a.id)} (${plain(a.severity)})`);
  return `${title}\n\nFixes:\n${lines.join('\n')}\n\nRe-resolved inside the version ranges our dependencies already declare;\nonly ${LOCKFILE} changes. Opened by .github/workflows/security-autofix.yml.\n`;
}

/** Where a status records a job's result. */
export function statusFor(job) {
  if (!job || job.status !== 'completed') return 'pending';
  return PASSING.has(job.conclusion) ? 'success' : 'failure';
}

/**
 * The bot's own dispatched jobs decide; every other check on the commit can
 * only hold the merge back, never pass it. `jobs` maps each expected job name
 * to its newest dispatched job, if any; `others` is what checksThatCount and
 * previewsBuilding found.
 */
export function dispatchedVerdict(jobs, others) {
  const failed = [
    ...EXPECTED_CHECKS.filter((name) => statusFor(jobs.get(name)) === 'failure'),
    ...others
      .filter((r) => r.status === 'completed' && !PASSING.has(r.conclusion))
      .map((r) => (r.conclusion === 'action_required' ? `${r.name} (awaiting approval)` : r.name)),
  ];
  if (failed.length) return { verdict: 'fail', detail: failed };
  const waiting = [
    ...EXPECTED_CHECKS.filter((name) => statusFor(jobs.get(name)) === 'pending'),
    ...others.filter((r) => r.status !== 'completed').map((r) => r.name),
  ];
  if (waiting.length) return { verdict: 'pending', detail: waiting };
  return { verdict: 'pass', detail: [] };
}

/** True for a commit the bot made itself; anything else on its branch is a person's. */
export function isBotCommit(commit) {
  const inner = commit?.commit;
  return inner?.author?.email === BOT.email && inner?.committer?.email === BOT.email;
}

/** The newest run of each checked workflow among dispatched runs on the bot branch. */
export function newestDispatchedRuns(runs) {
  const newest = new Map();
  for (const run of runs) {
    const file = String(run.path ?? '')
      .replace(/^\.github\/workflows\//, '')
      .replace(/@.*$/, '');
    if (!Object.hasOwn(CHECK_WORKFLOWS, file)) continue;
    if (run.event !== 'workflow_dispatch' || run.head_branch !== BRANCH) continue;
    if (!newest.has(file) || run.id > newest.get(file).id) newest.set(file, run);
  }
  return newest;
}

/**
 * Check runs that can hold the merge back: those of any app but GitHub
 * Actions (the Cloudflare preview), and those of the regular PR checks. GitHub
 * holds those for approval on a PR a workflow opened, and once a person
 * approves them they count: the ruleset needs a check and a status of the same
 * name to both pass. `prRuns` are the pull_request workflow runs on the commit.
 */
export function checksThatCount(checkRuns, prRuns) {
  const suites = new Set(
    prRuns.filter((run) => run.event === 'pull_request').map((run) => run.check_suite_id),
  );
  return checkRuns.filter((r) => r.app?.slug !== 'github-actions' || suites.has(r.check_suite?.id));
}

/**
 * The Cloudflare preview creates its one check run only once its build is
 * done, so until then just its check suite shows it. It gets PREVIEW_WAIT_MS
 * from the push to report: a preview that never does can't hold a fix back for
 * good.
 */
export function previewsBuilding(suites, now) {
  return suites
    .filter((s) => s.app?.slug === PREVIEW_APP && s.status !== 'completed')
    .filter((s) => !s.latest_check_runs_count && now - Date.parse(s.created_at) < PREVIEW_WAIT_MS)
    .map(() => ({ name: 'Workers Builds', status: 'in_progress', conclusion: null }));
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

const escapeCommand = (text) =>
  String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

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

/**
 * What the security check will say about this tree: the gate's own audit,
 * scope and allowlist. A PR it would fail can never merge, so it isn't offered.
 */
function gateBlockers() {
  const scan = scanDependencies(process.cwd(), 'pnpm');
  if (!scan.available || scan.error) return [`pnpm audit: ${scan.error ?? 'unavailable'}`];
  const allowlist = loadAllowlist(join('.quality-gates', 'security-allowlist.json')) ?? [];
  return partitionFindings(scan.findings, allowlist).live.map((f) => f.detail);
}

/** Publish time of "name@version" from the registry, or null. */
function publishedAt(key) {
  const parts = splitKey(key);
  if (!parts || !PACKAGE_NAME.test(parts.name) || !VERSION.test(parts.version)) return null;
  const res = sh('pnpm', ['view', parts.name, 'time', '--json'], { check: false });
  try {
    return JSON.parse(res.stdout)?.[parts.version] ?? null;
  } catch {
    return null;
  }
}

function refresh(names) {
  // Name a package that is also one of our direct dependencies and `pnpm
  // update --depth Infinity` skips every nested copy of every name, so those
  // are left to dedupe below (and to Dependabot, which updates direct ones).
  const direct = directDependencies(readFileSync(LOCKFILE, 'utf8'));
  const nested = names.filter((name) => !direct.has(name));
  if (nested.length) {
    console.info(`Re-resolving ${nested.join(', ')}`);
    const updated = sh(
      'pnpm',
      ['update', '--recursive', '--depth', 'Infinity', '--ignore-scripts', ...nested],
      { check: false, quiet: false },
    );
    if (updated.status !== 0) console.info('pnpm update failed; trying pnpm dedupe alone.');
    const after = updated.status === 0 ? audit() : null;
    if (after && !packagesToRefresh(after).length) return after;
  }
  // dedupe moves nested copies onto a fixed version the lockfile already holds
  // (zod under @astrojs/sitemap, whose fix our direct zod pin had brought in).
  console.info('Still flagged; running pnpm dedupe.');
  sh('pnpm', ['dedupe', '--ignore-scripts'], { quiet: false });
  return audit();
}

export function plan() {
  setOutputs({ base: sh('git', ['rev-parse', 'HEAD']).stdout.trim() });
  // pnpm audit lists no dependency paths until node_modules exists, and the
  // refresh below installs it, so install first: both audits then see the same
  // tree and their copies compare.
  sh('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { quiet: false });
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

  const lockBefore = readFileSync(LOCKFILE, 'utf8');
  const after = refresh(names);
  const stray = unexpectedChanges(sh('git', ['status', '--porcelain']).stdout);
  const fixed = after ? improved(before, after) : [];
  let why = refusal(after, stray, after ? compareAudits(before, after).added : [], fixed);
  if (!why) {
    const blockers = gateBlockers();
    if (blockers.length) {
      why = `The refresh helps, but the security check would still fail on: ${blockers.join('; ')}.`;
    }
  }
  if (why) {
    sh('git', ['checkout', '--', '.']);
    return settle('stuck', `${why} A person has to decide.`);
  }

  // The lockfile must install exactly as written, as CI will install it.
  sh('pnpm', ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts']);
  const lockAfter = readFileSync(LOCKFILE, 'utf8');
  const delta = lockfileDelta(lockBefore, lockAfter);
  const added = delta.added.map((key) => ({ key, time: publishedAt(key) }));
  const cooldown = mergeAfter(added);
  const signature = fixSignature(delta);
  const title = titleFor(fixed);

  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'security-autofix');
  mkdirSync(dir, { recursive: true });
  copyFileSync(LOCKFILE, join(dir, LOCKFILE));
  writeFileSync(
    join(dir, 'body.md'),
    renderBody({ fixed, remaining: after, added, cooldown, signature }),
  );
  writeFileSync(join(dir, 'commit.txt'), commitMessage(title, fixed));
  setOutputs({ state: 'fixed', title, merge_after: cooldown.at, signature });
  report(`Fixes ${fixed.map((a) => `${a.name} (${plain(a.ghsa || a.id)})`).join(', ')}.`);
  return 0;
}

const repo = () => process.env.GITHUB_REPOSITORY ?? '';
const owner = () => repo().split('/')[0];

// -R on every gh call: gh then never touches the local checkout.
const gh = (args, options) => sh('gh', [...args, '-R', repo()], options);
const api = (path, args = []) =>
  sh('gh', ['api', ...args, `repos/${repo()}/${path}`], { check: false });
const apiJson = (path, args = []) => {
  const res = api(path, args);
  return res.status === 0 ? JSON.parse(res.stdout) : null;
};

/**
 * The bot's PRs, open or closed, read through the REST filter head=owner:branch,
 * which leaves out every fork's branch of the same name, across all pages.
 */
function botPrs(state) {
  const query = `pulls?state=${state}&base=main&head=${owner()}:${BRANCH}&per_page=100`;
  // --slurp wraps every page in one array; a listing that can't be read stops the run.
  const res = sh('gh', ['api', '--paginate', '--slurp', `repos/${repo()}/${query}`]);
  return JSON.parse(res.stdout)
    .flat()
    .filter((pr) => pr.head?.repo?.full_name === repo());
}

/** A closed, unmerged bot PR carrying this exact change: a person turned it down. */
function rejected(signature) {
  const marker = `<!-- ${MARKER}: ${signature} -->`;
  const pr = botPrs('closed').find((p) => !p.merged_at && String(p.body ?? '').includes(marker));
  return pr ? pr.number : null;
}

/** The tip of the bot branch on GitHub: sha, tree, parent and who made it. */
function branchTip() {
  const res = api(`branches/${BRANCH}`);
  if (res.status !== 0) {
    // Only "no such branch" means there is none; any other error must not
    // pass for it, or the bot could force-push over someone's commits.
    if (/Branch not found|HTTP 404/i.test(`${res.stdout}\n${res.stderr}`)) return null;
    throw new Error(`Reading the ${BRANCH} branch failed: ${res.stderr.trim()}`);
  }
  const tip = JSON.parse(res.stdout).commit;
  return {
    sha: tip.sha,
    tree: tip.commit?.tree?.sha,
    parent: tip.parents?.[0]?.sha,
    parents: tip.parents?.length ?? 0,
    botMade: isBotCommit(tip),
  };
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
      ? ' Turn on Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".'
      : '';
    throw new Error(`gh pr create failed: ${created.stderr.trim()}${hint}`);
  }
  const pr = botPrs('open')[0];
  if (!pr) throw new Error('gh pr create succeeded but the PR is not listed.');
  return pr.number;
}

/** The newest dispatched run of each checked workflow on this commit. */
function dispatchedRuns(sha) {
  const doc = apiJson(`actions/runs?event=workflow_dispatch&head_sha=${sha}&per_page=100`);
  return doc ? newestDispatchedRuns(doc.workflow_runs ?? []) : null;
}

/** Each expected job name → its job in the newest dispatched run, if any. */
function dispatchedJobs(runs) {
  const jobs = new Map();
  for (const [file, run] of runs) {
    const doc = apiJson(`actions/runs/${run.id}/jobs?per_page=100`);
    for (const name of CHECK_WORKFLOWS[file]) {
      const job = doc?.jobs?.find((j) => j.name === name);
      if (job) {
        jobs.set(name, { status: job.status, conclusion: job.conclusion, url: job.html_url });
      } else if (doc && run.status === 'completed') {
        // The run finished without this job: the workflow no longer has it.
        jobs.set(name, { status: 'completed', conclusion: 'missing', url: run.html_url });
      } else {
        // Not listed yet, or the listing failed: wait and look again.
        jobs.set(name, { status: 'queued', conclusion: null, url: run.html_url });
      }
    }
  }
  return jobs;
}

/** Every check on the commit that can hold the merge back, or null if one can't be read. */
function otherChecks(sha) {
  const runs = apiJson(`commits/${sha}/check-runs?per_page=100`);
  const suites = apiJson(`commits/${sha}/check-suites?per_page=100`);
  const prRuns = apiJson(`actions/runs?event=pull_request&head_sha=${sha}&per_page=100`);
  if (!runs || !suites || !prRuns) return null;
  return [
    ...checksThatCount(runs.check_runs ?? [], prRuns.workflow_runs ?? []),
    ...previewsBuilding(suites.check_suites ?? [], Date.now()),
  ];
}

function startChecks(files) {
  for (const file of files) gh(['workflow', 'run', file, '--ref', BRANCH]);
}

async function waitForChecks(sha, { timeoutMs = 30 * 60_000, everyMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = { verdict: 'pending', detail: EXPECTED_CHECKS, jobs: new Map() };
  while (Date.now() < deadline) {
    const runs = dispatchedRuns(sha);
    const others = runs && otherChecks(sha);
    if (others) {
      const jobs = dispatchedJobs(runs);
      last = { ...dispatchedVerdict(jobs, others), jobs };
      if (last.verdict !== 'pending') return last;
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return { ...last, verdict: 'timed out' };
}

/**
 * Each check's real result as a commit status of the same name, linking to its
 * run: what the ruleset counts, and what the PR page shows, pass or fail.
 */
function recordStatuses(sha, jobs) {
  for (const name of EXPECTED_CHECKS) {
    const job = jobs.get(name);
    const state = statusFor(job);
    const fields = ['-f', `state=${state}`, '-f', `context=${name}`];
    fields.push('-f', `description=${state} in a run dispatched by security-autofix`);
    if (job?.url) fields.push('-f', `target_url=${job.url}`);
    const res = api(`statuses/${sha}`, ['-X', 'POST', ...fields]);
    if (res.status !== 0) throw new Error(`Recording ${name} failed: ${res.stderr.trim()}`);
  }
}

const mainSha = () => apiJson('branches/main')?.commit?.sha ?? null;

/** Fresh results on main: a GITHUB_TOKEN merge starts no workflows there either. */
function recheckMain() {
  for (const file of Object.keys(CHECK_WORKFLOWS)) {
    const res = gh(['workflow', 'run', file, '--ref', 'main'], { check: false });
    if (res.status !== 0) console.info(`::warning::Could not start ${file} on main.`);
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
  console.info(`::warning::${escapeCommand(message)}`);
  return 0;
}

/** main has nothing a refresh can fix: drop what an earlier run left behind. */
function tidyUp(existing, tip) {
  if (existing) {
    // Withdraw the signature first, or a later run would read this close as a
    // person turning the change down and never offer it again.
    const body = ['-X', 'PATCH', '-f', `body=${withdraw(existing.body)}`];
    const edited = api(`pulls/${existing.number}`, body);
    if (edited.status !== 0) {
      throw new Error(`Editing PR #${existing.number} failed: ${edited.stderr.trim()}`);
    }
    const comment = 'main has no fixable advisory any more, so this is no longer needed.';
    gh(['pr', 'close', String(existing.number), '--delete-branch', '--comment', comment]);
    report(`Closed PR #${existing.number}: nothing left to fix.`);
  } else if (tip && api(`git/refs/heads/${BRANCH}`, ['-X', 'DELETE']).status === 0) {
    report(`Deleted the leftover ${BRANCH} branch.`);
  }
  return 0;
}

/** The planned lockfile on the planned base, committed as the bot. */
function commitFix(dir, base) {
  if (sh('git', ['rev-parse', 'HEAD']).stdout.trim() !== base) {
    throw new Error('The checkout is not the commit the plan ran on.');
  }
  copyFileSync(join(dir, LOCKFILE), LOCKFILE);
  const stray = unexpectedChanges(sh('git', ['status', '--porcelain']).stdout);
  if (stray.length) throw new Error(`Only ${LOCKFILE} may change, not ${stray.join(', ')}.`);
  sh('gh', ['auth', 'setup-git']);
  sh('git', ['config', 'user.name', BOT.name]);
  sh('git', ['config', 'user.email', BOT.email]);
  sh('git', ['switch', '--force-create', BRANCH]);
  sh('git', ['add', LOCKFILE]);
  sh('git', ['commit', '--quiet', '--file', join(dir, 'commit.txt')]);
  return sh('git', ['rev-parse', 'HEAD^{tree}']).stdout.trim();
}

/** Squash-merge exactly `head` onto `base` through the API, then tidy up. */
function mergeFix(number, head, base, title, dir) {
  const fields = ['-f', 'merge_method=squash', '-f', `sha=${head}`];
  fields.push('-f', `commit_title=${title} (#${number})`);
  fields.push(
    '-f',
    `commit_message=${readFileSync(join(dir, 'commit.txt'), 'utf8').split('\n\n').slice(1).join('\n\n')}`,
  );
  const res = api(`pulls/${number}/merge`, ['-X', 'PUT', ...fields]);
  if (res.status !== 0) return { ok: false, why: res.stdout.trim() || res.stderr.trim() };
  api(`git/refs/heads/${BRANCH}`, ['-X', 'DELETE']);
  const merged = apiJson(`commits/${JSON.parse(res.stdout).sha}`);
  return { ok: true, onBase: merged?.parents?.[0]?.sha === base };
}

export async function ship() {
  const state = process.env.PLAN_STATE ?? '';
  if (state !== 'fixed' && state !== 'clean') {
    console.info(`Nothing to ship (plan state: ${state || 'missing'}).`);
    return 0;
  }
  const existing = botPrs('open')[0] ?? null;
  const tip = branchTip();
  if (tip && !tip.botMade) {
    // A person pushed to the bot's branch: their work, not the bot's to replace.
    report(
      `The ${BRANCH} branch has commits the bot didn't make; leaving it to whoever pushed them.`,
    );
    return 0;
  }
  if (state === 'clean') return tidyUp(existing, tip);

  const title = process.env.PLAN_TITLE ?? '';
  const base = process.env.PLAN_BASE ?? '';
  const dir = process.env.PLAN_DIR ?? '';
  const signature = process.env.PLAN_SIGNATURE ?? '';
  const cooldown = process.env.PLAN_MERGE_AFTER ?? '';
  const tree = commitFix(dir, base);

  if (!existing) {
    const turnedDown = rejected(signature);
    if (turnedDown) {
      report(
        `This exact change was closed without merging in PR #${turnedDown}; not offering it again.`,
      );
      return 0;
    }
  }
  const same = Boolean(
    existing && tip && tip.tree === tree && tip.parent === base && tip.parents === 1,
  );
  const head = same ? tip.sha : sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  let number = existing?.number;
  let loud = true;
  if (!same) {
    // Leased to the tip read above: a commit someone pushes meanwhile is theirs.
    const lease = `--force-with-lease=refs/heads/${BRANCH}:${tip?.sha ?? ''}`;
    const pushed = sh('git', ['push', lease, 'origin', `HEAD:refs/heads/${BRANCH}`], {
      check: false,
    });
    if (pushed.status !== 0) {
      if (!/stale info/.test(pushed.stderr)) {
        throw new Error(`git push exited with ${pushed.status}\n${pushed.stderr.slice(-2000)}`);
      }
      return problem(
        false,
        `The ${BRANCH} branch changed while this run worked; the next run looks again.`,
      );
    }
    number = openOrUpdatePr(existing, title, join(dir, 'body.md'));
    startChecks(Object.keys(CHECK_WORKFLOWS));
    report(`Opened or updated PR #${number} and started ${EXPECTED_CHECKS.join(', ')} on it.`);
  } else {
    // An earlier run may have stopped before starting every workflow.
    const runs = dispatchedRuns(head) ?? new Map();
    const missing = Object.keys(CHECK_WORKFLOWS).filter((file) => !runs.has(file));
    startChecks(missing);
    loud = missing.length > 0;
    report(
      `PR #${number} already carries this fix; ${missing.length ? `starting ${missing.join(', ')}` : 'checking it again'}.`,
    );
  }

  const result = await waitForChecks(head);
  recordStatuses(head, result.jobs);
  if (result.verdict !== 'pass') {
    const why = result.verdict === 'fail' ? 'not passing' : 'still running after 30 minutes';
    return problem(loud, `Not merging PR #${number}: ${why}: ${result.detail.join(', ')}.`);
  }
  if (cooldown === 'unknown') {
    return problem(
      false,
      `Not merging PR #${number}: a release date couldn't be read, so a person decides.`,
    );
  }
  if (cooldown && Date.now() < Date.parse(cooldown)) {
    report(
      `Checks pass on PR #${number}; it merges after ${cooldown}, once every new release is ${MIN_RELEASE_AGE_DAYS} days old.`,
    );
    return 0;
  }
  // The checks ran on main as it was when this fix was planned. If main has
  // moved since, the merge would combine trees nothing tested; the next run
  // plans again on the new main.
  if (mainSha() !== base) {
    return problem(
      false,
      `Not merging PR #${number}: main moved since this fix was planned; the next run plans again.`,
    );
  }
  const merged = mergeFix(number, head, base, title, dir);
  if (!merged.ok)
    return problem(loud, `Checks passed but merging PR #${number} failed: ${merged.why}`);
  recheckMain();
  if (!merged.onBase) {
    // main moved in the seconds between the check above and the merge.
    return problem(
      true,
      `Merged PR #${number}, but main had moved meanwhile; the checks just started on main cover the combination.`,
    );
  }
  report(`Merged PR #${number}.`);
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
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      console.info(`::error title=security autofix::${escapeCommand(message)}`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Failed:** ${message}\n\n`);
      }
      process.exitCode = 1;
    },
  );
}
