// @vitest-environment node
/**
 * The security autofix decides what to re-resolve, what that fixed, when its PR
 * may merge itself and what it may never touch. These pin those decisions. The
 * commands it runs (pnpm, git, gh) are exercised by the workflow on GitHub.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BRANCH,
  EXPECTED_CHECKS,
  MIN_RELEASE_AGE_DAYS,
  checksThatCount,
  commitMessage,
  compareAudits,
  directDependencies,
  dispatchedVerdict,
  fixSignature,
  improved,
  isBotCommit,
  isFixable,
  lockfileDelta,
  lockfilePackages,
  mergeAfter,
  newestDispatchedRuns,
  packagesToRefresh,
  parseAudit,
  pathShape,
  plain,
  previewsBuilding,
  renderBody,
  splitKey,
  statusFor,
  titleFor,
  unexpectedChanges,
  withdraw,
} from './security-autofix.mjs';

interface Advisory {
  id: string;
  name: string;
  severity: string;
  patched: string;
  ghsa: string;
  title: string;
  paths: string[];
  left?: number;
}

const SITEMAP = 'apps/web > @astrojs/sitemap > zod';
const ASTRO = 'apps/web > astro > zod';

const advisory = (over: Partial<Advisory> = {}): Advisory => ({
  id: '1243066',
  name: 'zod',
  severity: 'high',
  patched: '>=4.6.6',
  ghsa: 'GHSA-mrhx-c7xc-m3w5',
  title: 'Zod can exhaust memory while validating oversized constrained collections',
  paths: [SITEMAP],
  ...over,
});

const body = (over: Partial<Parameters<typeof renderBody>[0]> = {}) =>
  renderBody({
    fixed: [advisory({ left: 0 })],
    remaining: [],
    added: [],
    cooldown: { at: '', youngest: '' },
    signature: 'abc123',
    ...over,
  });

describe('parseAudit', () => {
  it('maps each advisory and every vulnerable copy pnpm found', () => {
    const report = {
      actions: [],
      advisories: {
        1243066: {
          id: 1243066,
          module_name: 'zod',
          severity: 'high',
          patched_versions: '>=4.6.6',
          github_advisory_id: 'GHSA-mrhx-c7xc-m3w5',
          title: 'Zod can exhaust memory while validating oversized constrained collections',
          findings: [
            { version: '4.5.4', paths: ['apps/web > @astrojs/sitemap@3.7.4 > zod@4.5.4'] },
            { version: '4.6.6', paths: ['apps/web > astro@7.4.0 > zod@4.6.6'] },
          ],
        },
      },
      metadata: {},
    };
    expect(parseAudit(JSON.stringify(report))).toEqual([advisory({ paths: [SITEMAP, ASTRO] })]);
  });

  it('counts an advisory reported without findings as one copy', () => {
    const report = { advisories: { 7: { id: 7, module_name: 'x', patched_versions: '>=2' } } };
    expect(parseAudit(JSON.stringify(report))?.[0].paths).toEqual(['*']);
  });

  it('reads a clean report as no advisories', () => {
    const clean = { actions: [], advisories: {}, muted: [], metadata: { vulnerabilities: {} } };
    expect(parseAudit(JSON.stringify(clean))).toEqual([]);
  });

  it('returns null for anything that is not an audit report', () => {
    expect(
      parseAudit('ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"'),
    ).toBeNull();
    expect(parseAudit('')).toBeNull();
    expect(parseAudit('null')).toBeNull();
    expect(
      parseAudit(JSON.stringify({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE' } })),
    ).toBeNull();
  });
});

describe('isFixable and packagesToRefresh', () => {
  it('needs a patched release', () => {
    expect(isFixable(advisory())).toBe(true);
    expect(isFixable(advisory({ patched: '<0.0.0' }))).toBe(false);
    expect(isFixable(advisory({ patched: '' }))).toBe(false);
  });

  it('lists each fixable package once, sorted', () => {
    const list = [
      advisory(),
      advisory({ id: '2', name: 'source-map-js' }),
      advisory({ id: '3' }),
      advisory({ id: '4', name: '@astrojs/sitemap' }),
      advisory({ id: '5', name: 'http-cache-semantics', patched: '<0.0.0' }),
    ];
    expect(packagesToRefresh(list)).toEqual(['@astrojs/sitemap', 'source-map-js', 'zod']);
  });

  it('never passes something that is not a package name to pnpm', () => {
    const hostile = [
      '--registry=http://evil.example',
      'zod; rm -rf ~',
      '../../etc',
      'Zod',
      '@scope/',
      '',
    ];
    const list = hostile.map((name, i) => advisory({ id: String(i), name }));
    expect(packagesToRefresh(list)).toEqual([]);
  });
});

describe('compareAudits and improved', () => {
  it('counts a fully fixed advisory', () => {
    const before = [advisory()];
    expect(compareAudits(before, [])).toEqual({ removed: [`1243066|${SITEMAP}`], added: [] });
    expect(improved(before, [])).toEqual([advisory({ left: 0 })]);
  });

  it('counts a copy fixed on one path while another remains as progress', () => {
    const before = [advisory({ paths: [SITEMAP, ASTRO] })];
    const after = [advisory({ paths: [ASTRO] })];
    expect(compareAudits(before, after).removed).toEqual([`1243066|${SITEMAP}`]);
    expect(improved(before, after)).toEqual([advisory({ paths: [SITEMAP, ASTRO], left: 1 })]);
  });

  it('reports copies a refresh would bring in, of any advisory', () => {
    const newcomer = advisory({
      id: '9',
      name: 'other',
      patched: '<0.0.0',
      paths: ['apps/web > x'],
    });
    expect(compareAudits([advisory()], [newcomer]).added).toEqual(['9|apps/web > x']);
  });

  it('sees the same copy after a parent update, neither fixed nor new', () => {
    const raw = (parent: string) =>
      JSON.stringify({
        advisories: {
          1: {
            id: 1,
            module_name: 'p',
            patched_versions: '>=2',
            findings: [{ version: '1.0.0', paths: [`apps/web > b@${parent} > p@1.0.0`] }],
          },
        },
      });
    const before = parseAudit(raw('1.0.0')) ?? [];
    const after = parseAudit(raw('1.1.0')) ?? [];
    expect(compareAudits(before, after)).toEqual({ removed: [], added: [] });
    expect(improved(before, after)).toEqual([]);
  });

  it('never credits an advisory with no patched release, or a refresh that changed nothing', () => {
    const gone = advisory({ name: 'http-cache-semantics', patched: '<0.0.0' });
    expect(improved([gone], [])).toEqual([]);
    expect(improved([advisory()], [advisory()])).toEqual([]);
  });
});

describe('pathShape', () => {
  it('drops versions and peer suffixes from every segment', () => {
    expect(pathShape('apps/web > @astrojs/sitemap@3.7.4 > zod@4.5.4')).toBe(
      'apps/web > @astrojs/sitemap > zod',
    );
    expect(pathShape('. > react-dom@19.3.0(react@19.3.0) > scheduler@0.27.0')).toBe(
      '. > react-dom > scheduler',
    );
    expect(pathShape('@astrojs/sitemap')).toBe('@astrojs/sitemap');
  });
});

describe('unexpectedChanges', () => {
  it('accepts a lockfile-only change and reports anything else', () => {
    expect(unexpectedChanges(' M pnpm-lock.yaml\n')).toEqual([]);
    expect(unexpectedChanges('')).toEqual([]);
    const porcelain = ' M pnpm-lock.yaml\n M worker/package.json\n?? stray.txt\n';
    expect(unexpectedChanges(porcelain)).toEqual(['worker/package.json', 'stray.txt']);
  });
});

describe('the lockfile', () => {
  const lock = (packages: string[]) =>
    [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '',
      '  .:',
      '    dependencies:',
      '      zod:',
      '        specifier: 4.6.7',
      '',
      'packages:',
      '',
      ...packages.flatMap((p) => [`  ${p}:`, '    resolution: {integrity: sha512-x}', '']),
      'snapshots:',
      '',
      '  zod@9.9.9: {}',
    ].join('\n');

  it('lists the packages section only, quoted or not', () => {
    const text = lock(["'@astrojs/sitemap@3.7.4'", 'zod@4.5.4', 'zod@4.6.7']);
    expect([...lockfilePackages(text)]).toEqual([
      '@astrojs/sitemap@3.7.4',
      'zod@4.5.4',
      'zod@4.6.7',
    ]);
  });

  it('lists our direct dependencies from importers, which pnpm update must not be given', () => {
    const text = [
      'importers:',
      '',
      '  .:',
      '    devDependencies:',
      "      '@eslint/js':",
      '        specifier: 10.0.1',
      '        version: 10.0.1',
      '  worker:',
      '    dependencies:',
      '      zod:',
      '        specifier: 4.6.7',
      '        version: 4.6.7',
      '',
      'packages:',
      '',
      '  source-map-js@1.2.2:',
    ].join('\n');
    expect([...directDependencies(text)]).toEqual(['@eslint/js', 'zod']);
  });

  it('splits names that start with @', () => {
    expect(splitKey('@astrojs/sitemap@3.7.4')).toEqual({
      name: '@astrojs/sitemap',
      version: '3.7.4',
    });
    expect(splitKey('zod@4.6.7')).toEqual({ name: 'zod', version: '4.6.7' });
    expect(splitKey('@scope')).toBeNull();
  });

  it('tells a pure dedupe from a refresh that brings in new releases', () => {
    const before = lock(['zod@4.5.4', 'zod@4.6.7']);
    expect(lockfileDelta(before, lock(['zod@4.6.7']))).toEqual({
      added: [],
      removed: ['zod@4.5.4'],
    });
    expect(lockfileDelta(before, lock(['zod@4.6.7', 'zod@4.6.8']))).toEqual({
      added: ['zod@4.6.8'],
      removed: ['zod@4.5.4'],
    });
  });

  it('signs a fix by what it changes, so the same change on a newer main matches', () => {
    const delta = { added: ['zod@4.6.8'], removed: ['zod@4.5.4'] };
    expect(fixSignature(delta)).toBe(fixSignature({ ...delta }));
    expect(fixSignature(delta)).toMatch(/^[0-9a-f]{16}$/);
    expect(fixSignature(delta)).not.toBe(fixSignature({ added: [], removed: ['zod@4.5.4'] }));
  });
});

describe('mergeAfter', () => {
  it('needs no wait when nothing new comes in', () => {
    expect(mergeAfter([])).toEqual({ at: '', youngest: '' });
  });

  it(`waits ${MIN_RELEASE_AGE_DAYS} days after the newest release`, () => {
    const published = [
      { key: 'a@1.0.0', time: '2026-10-01T00:00:00.000Z' },
      { key: 'b@2.0.0', time: '2026-10-10T12:00:00.000Z' },
    ];
    expect(mergeAfter(published, 3)).toEqual({
      at: '2026-10-13T12:00:00.000Z',
      youngest: 'b@2.0.0',
    });
  });

  it('leaves the merge to a person when a publish date is unknown', () => {
    const published = [
      { key: 'a@1.0.0', time: '2026-10-01T00:00:00.000Z' },
      { key: 'b@2.0.0', time: null },
    ];
    expect(mergeAfter(published)).toEqual({ at: 'unknown', youngest: 'b@2.0.0' });
  });
});

describe('titleFor and commitMessage', () => {
  it('names the packages', () => {
    expect(titleFor([advisory(), advisory({ id: '2' })])).toBe(
      'chore(deps): refresh zod to a patched release',
    );
    const list = ['a', 'b', 'c', 'd'].map((name, i) => advisory({ id: String(i), name }));
    expect(titleFor(list)).toBe('chore(deps): refresh a, b, c and 1 more to patched releases');
  });

  it('keeps advisory text out of the commit', () => {
    const message = commitMessage('chore(deps): refresh zod to a patched release', [
      advisory({ title: 'Fixes #12, see https://evil.example' }),
    ]);
    expect(message).toContain('- zod: GHSA-mrhx-c7xc-m3w5 (high)');
    expect(message).not.toContain('evil.example');
    expect(message).not.toContain('#12');
  });
});

describe('plain', () => {
  it('defuses mentions, issue references, links and markup', () => {
    const text = plain(
      'Fixes #12 @someone https://evil.example www.evil.example [x](y) ![i](j) <b>|',
    );
    expect(text).not.toMatch(/#\d|@\w|:\/\/|www\.|\]\(|<b>|\|/);
  });

  it('caps the length', () => {
    expect(plain('x'.repeat(500)).length).toBe(120);
  });
});

describe('renderBody', () => {
  it('tables what was fixed and carries the fix signature', () => {
    const text = body();
    expect(text).toContain('| `zod` | high | GHSA-mrhx-c7xc-m3w5 | `>=4.6.6` | fixed |');
    expect(text).toContain('<!-- security-autofix-fix: abc123 -->');
    expect(text).toContain('merges as soon as the checks pass');
    expect(text).not.toContain('Still reported');
  });

  it('says when copies are left, and lists what remains', () => {
    const left = advisory({ id: '2', name: 'esbuild', severity: 'moderate', patched: '>=1' });
    const text = body({ fixed: [advisory({ left: 2 })], remaining: [left] });
    expect(text).toContain('| partly: 2 left |');
    expect(text).toContain('Still reported');
    expect(text).toContain('| `esbuild` |');
  });

  it('names new releases and when the bot will merge', () => {
    const added = [{ key: 'zod@4.6.8', time: '2026-10-28T09:00:00.000Z' }];
    const text = body({
      added,
      cooldown: { at: '2026-10-31T09:00:00.000Z', youngest: 'zod@4.6.8' },
    });
    expect(text).toContain('`zod@4.6.8` (published 2026-10-28)');
    expect(text).toContain('no earlier than 2026-10-31 09:00 UTC');
  });

  it('leaves the merge to a person when a release date is unknown', () => {
    const added = [{ key: 'zod@4.6.8', time: null }];
    const text = body({ added, cooldown: { at: 'unknown', youngest: 'zod@4.6.8' } });
    expect(text).toContain('waits for a person');
  });

  it('keeps advisory text from mentioning people or injecting markup', () => {
    const title = 'ping @someone <img src=x> | col [click](https://evil.example) Fixes #9';
    const text = body({ fixed: [advisory({ title, left: 0 })] });
    expect(text).not.toContain('<img');
    expect(text).not.toContain('| col');
    expect(text).not.toContain('https://evil');
    expect(text).not.toContain('#9');
  });

  it('caps a runaway version range', () => {
    const text = body({ fixed: [advisory({ patched: `>=${'9'.repeat(400)}`, left: 0 })] });
    expect(text.split('\n').every((line) => line.length < 600)).toBe(true);
  });

  it('withdraws its signature when the bot closes the PR itself, so that is no veto', () => {
    const text = withdraw(body());
    expect(text).not.toContain('<!-- security-autofix-fix: abc123 -->');
    expect(text).toContain('<!-- security-autofix-withdrawn: abc123 -->');
    expect(withdraw(text)).toBe(text);
    expect(withdraw(null)).toBe('');
  });
});

describe('dispatchedVerdict', () => {
  const job = (conclusion: string | null, status = 'completed') => ({
    status,
    conclusion,
    url: 'u',
  });
  const all = (conclusion: string) =>
    new Map(EXPECTED_CHECKS.map((name) => [name, job(conclusion)]));

  it('passes once every dispatched job succeeded', () => {
    expect(dispatchedVerdict(all('success'), [])).toEqual({ verdict: 'pass', detail: [] });
  });

  it('waits for a job that has not started or finished', () => {
    const jobs = all('success');
    jobs.delete(EXPECTED_CHECKS[0]);
    jobs.set(EXPECTED_CHECKS[1], job(null, 'in_progress'));
    expect(dispatchedVerdict(jobs, [])).toEqual({
      verdict: 'pending',
      detail: [EXPECTED_CHECKS[0], EXPECTED_CHECKS[1]],
    });
  });

  it('fails on a failed, cancelled or missing job', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'missing']) {
      const jobs = all('success');
      jobs.set('gates', job(conclusion));
      expect(dispatchedVerdict(jobs, [])).toEqual({ verdict: 'fail', detail: ['gates'] });
    }
  });

  it('lets other checks hold a merge back but never pass one', () => {
    const preview = {
      name: 'Workers Builds: lolperform',
      status: 'completed',
      conclusion: 'failure',
    };
    expect(dispatchedVerdict(all('success'), [preview]).verdict).toBe('fail');
    const running = { ...preview, status: 'in_progress', conclusion: null };
    expect(dispatchedVerdict(all('success'), [running]).verdict).toBe('pending');
    const passingImpostor = { name: 'verify', status: 'completed', conclusion: 'success' };
    expect(dispatchedVerdict(new Map(), [passingImpostor]).verdict).toBe('pending');
  });

  it('says so when a check waits for a person to approve it', () => {
    const held = { name: 'verify', status: 'completed', conclusion: 'action_required' };
    expect(dispatchedVerdict(all('success'), [held])).toEqual({
      verdict: 'fail',
      detail: ['verify (awaiting approval)'],
    });
  });

  it('maps each job to the status it records', () => {
    expect(statusFor(job('success'))).toBe('success');
    expect(statusFor(job('skipped'))).toBe('success');
    expect(statusFor(job('failure'))).toBe('failure');
    expect(statusFor(job(null, 'queued'))).toBe('pending');
    expect(statusFor(undefined)).toBe('pending');
  });
});

describe('newestDispatchedRuns', () => {
  const run = (id: number, path: string, over: Record<string, unknown> = {}) => ({
    id,
    path,
    event: 'workflow_dispatch',
    head_branch: BRANCH,
    ...over,
  });

  it('keeps the newest dispatched run of each checked workflow on the bot branch', () => {
    const newest = newestDispatchedRuns([
      run(1, '.github/workflows/ci.yml'),
      run(5, '.github/workflows/ci.yml'),
      run(3, '.github/workflows/quality-gates.yml'),
      run(9, '.github/workflows/patch-watch.yml'),
      run(10, '.github/workflows/quality-gates-security.yml', { event: 'pull_request' }),
      run(11, '.github/workflows/quality-gates-security.yml', { head_branch: 'someone-else' }),
    ]);
    expect([...newest.entries()].map(([file, r]) => [file, r.id])).toEqual([
      ['ci.yml', 5],
      ['quality-gates.yml', 3],
    ]);
  });
});

describe('checksThatCount', () => {
  const check = (name: string, slug: string, suite: number) => ({
    name,
    status: 'completed',
    conclusion: 'failure',
    app: { slug },
    check_suite: { id: suite },
  });
  const runs = [
    check('Workers Builds: lolperform', 'cloudflare-workers-and-pages', 1),
    check('verify', 'github-actions', 2),
    check('verify', 'github-actions', 3),
    check('gates', 'github-actions', 4),
  ];

  it('counts other apps and the PR checks a person approved, not the bot’s own runs', () => {
    const prRuns = [
      { event: 'pull_request', check_suite_id: 3 },
      { event: 'workflow_dispatch', check_suite_id: 2 },
      { event: 'push', check_suite_id: 4 },
    ];
    expect(checksThatCount(runs, prRuns).map((r) => r.check_suite.id)).toEqual([1, 3]);
  });

  it('counts only other apps while the PR checks await approval', () => {
    expect(checksThatCount(runs, []).map((r) => r.name)).toEqual(['Workers Builds: lolperform']);
  });
});

describe('previewsBuilding', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const suite = (over: Record<string, unknown> = {}) => ({
    app: { slug: 'cloudflare-workers-and-pages' },
    status: 'queued',
    latest_check_runs_count: 0,
    created_at: '2026-10-30T11:59:00Z',
    ...over,
  });

  it('waits for a preview that has not reported yet', () => {
    expect(previewsBuilding([suite(), suite({ status: 'in_progress' })], now)).toHaveLength(2);
  });

  it('stops waiting once it reported, finished, or never reported in 15 minutes', () => {
    const done = [
      suite({ latest_check_runs_count: 1 }),
      suite({ status: 'completed' }),
      suite({ created_at: '2026-10-30T11:44:00Z' }),
    ];
    expect(previewsBuilding(done, now)).toEqual([]);
  });

  it('ignores apps that never report', () => {
    const silent = [suite({ app: { slug: 'claude' } }), suite({ app: { slug: 'graphify-labs' } })];
    expect(previewsBuilding(silent, now)).toEqual([]);
  });
});

describe('isBotCommit', () => {
  const email = '41898282+github-actions[bot]@users.noreply.github.com';
  const commit = (author: string, committer: string) => ({
    commit: { author: { email: author }, committer: { email: committer } },
  });

  it('knows its own commits from a person’s', () => {
    expect(isBotCommit(commit(email, email))).toBe(true);
    expect(isBotCommit(commit('sam@example.com', email))).toBe(false);
    expect(isBotCommit(commit(email, 'noreply@github.com'))).toBe(false);
    expect(isBotCommit(null)).toBe(false);
  });
});

describe('command line', () => {
  const script = fileURLToPath(new URL('./security-autofix.mjs', import.meta.url));
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });

  it('rejects an unknown command with usage and exit 2', () => {
    for (const args of [[], ['nope'], ['constructor'], ['__proto__']]) {
      const r = cli(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('usage: node scripts/security-autofix.mjs plan|ship');
    }
  });

  it('ships nothing when the plan found nothing to change', () => {
    for (const state of ['stuck', 'error', '']) {
      const r = cli(['ship'], { PLAN_STATE: state });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Nothing to ship');
    }
  });
});
