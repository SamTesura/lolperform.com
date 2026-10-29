// @vitest-environment node
/**
 * The security autofix decides what to re-resolve, what that fixed and when its
 * PR may merge itself. These pin those decisions. The commands it runs (pnpm,
 * git, gh) are exercised by the workflow on GitHub.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_CHECKS,
  checkVerdict,
  fixedBetween,
  isFixable,
  packagesToRefresh,
  parseAudit,
  renderBody,
  titleFor,
  unexpectedChanges,
} from './security-autofix.mjs';

interface Advisory {
  id: string;
  name: string;
  severity: string;
  patched: string;
  ghsa: string;
  title: string;
}

const advisory = (over: Partial<Advisory> = {}): Advisory => ({
  id: '1243066',
  name: 'zod',
  severity: 'high',
  patched: '>=4.6.6',
  ghsa: 'GHSA-mrhx-c7xc-m3w5',
  title: 'Zod can exhaust memory while validating oversized constrained collections',
  ...over,
});

describe('parseAudit', () => {
  it('maps the advisories in a pnpm audit report', () => {
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
        },
      },
      metadata: {},
    };
    expect(parseAudit(JSON.stringify(report))).toEqual([advisory()]);
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

describe('isFixable', () => {
  it('needs a patched release', () => {
    expect(isFixable(advisory())).toBe(true);
    expect(isFixable(advisory({ patched: '<0.0.0' }))).toBe(false);
    expect(isFixable(advisory({ patched: '' }))).toBe(false);
  });
});

describe('packagesToRefresh', () => {
  it('lists each fixable package once, sorted', () => {
    const list = [
      advisory(),
      advisory({ id: '2', name: 'source-map-js' }),
      advisory({ id: '3' }),
      advisory({ id: '4', name: '@astrojs/sitemap' }),
    ];
    expect(packagesToRefresh(list)).toEqual(['@astrojs/sitemap', 'source-map-js', 'zod']);
  });

  it('skips packages with no patched release', () => {
    expect(
      packagesToRefresh([advisory({ name: 'http-cache-semantics', patched: '<0.0.0' })]),
    ).toEqual([]);
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

describe('fixedBetween', () => {
  it('reports the fixable advisories the refresh removed', () => {
    const before = [
      advisory({ id: '1' }),
      advisory({ id: '2', name: 'http-cache-semantics', patched: '<0.0.0' }),
      advisory({ id: '3', name: 'source-map-js' }),
    ];
    const after = [before[1], before[2]];
    expect(fixedBetween(before, after).map((a) => a.id)).toEqual(['1']);
  });

  it('does not count an advisory with no patched release as fixed', () => {
    const gone = advisory({ name: 'http-cache-semantics', patched: '<0.0.0' });
    expect(fixedBetween([gone], [])).toEqual([]);
  });
});

describe('unexpectedChanges', () => {
  it('accepts a lockfile-only change', () => {
    expect(unexpectedChanges(' M pnpm-lock.yaml\n')).toEqual([]);
    expect(unexpectedChanges('')).toEqual([]);
  });

  it('reports anything else pnpm touched', () => {
    const porcelain = ' M pnpm-lock.yaml\n M worker/package.json\n?? stray.txt\n';
    expect(unexpectedChanges(porcelain)).toEqual(['worker/package.json', 'stray.txt']);
  });
});

describe('titleFor', () => {
  it('names the packages', () => {
    expect(titleFor([advisory()])).toBe('chore(deps): refresh zod to a patched release');
    expect(titleFor([advisory(), advisory({ id: '2' })])).toBe(
      'chore(deps): refresh zod to a patched release',
    );
  });

  it('shortens a long list', () => {
    const list = ['a', 'b', 'c', 'd'].map((name, i) => advisory({ id: String(i), name }));
    expect(titleFor(list)).toBe('chore(deps): refresh a, b, c and 1 more to patched releases');
  });
});

describe('renderBody', () => {
  it('tables what was fixed and says when the PR merges', () => {
    const body = renderBody([advisory()], []);
    expect(body).toContain('| `zod` | high | GHSA-mrhx-c7xc-m3w5 | `>=4.6.6` |');
    expect(body).toContain(EXPECTED_CHECKS.join(', '));
    expect(body).not.toContain('Still reported');
  });

  it('lists what is left for a person', () => {
    const left = advisory({
      id: '2',
      name: 'http-cache-semantics',
      patched: '<0.0.0',
      ghsa: 'GHSA-ch52-4w7c-c8xp',
    });
    const body = renderBody([advisory()], [left]);
    expect(body).toContain('Still reported');
    expect(body).toContain('| `http-cache-semantics` |');
  });

  it('keeps advisory text from mentioning people or injecting markup', () => {
    const body = renderBody([advisory({ title: 'ping @someone <img src=x> | col' })], []);
    expect(body).toContain('ping @​someone');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('| col');
  });
});

describe('checkVerdict', () => {
  const run = (id: number, name: string, status: string, conclusion: string | null = null) => ({
    id,
    name,
    status,
    conclusion,
  });
  const allPassed = EXPECTED_CHECKS.map((name, i) => run(i + 1, name, 'completed', 'success'));

  it('passes once every expected check succeeded', () => {
    expect(checkVerdict(allPassed).verdict).toBe('pass');
  });

  it('waits for an expected check that has not reported yet', () => {
    const result = checkVerdict(allPassed.slice(1));
    expect(result).toEqual({ verdict: 'pending', detail: [EXPECTED_CHECKS[0]] });
  });

  it('waits for any check still running, expected or not', () => {
    const preview = run(99, 'Workers Builds: lolperform', 'in_progress');
    expect(checkVerdict([...allPassed, preview]).verdict).toBe('pending');
  });

  it('fails on any failed check, expected or not', () => {
    const preview = run(99, 'Workers Builds: lolperform', 'completed', 'failure');
    expect(checkVerdict([...allPassed, preview])).toEqual({
      verdict: 'fail',
      detail: ['Workers Builds: lolperform: failure'],
    });
  });

  it('treats cancelled and timed-out runs as failures', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'action_required']) {
      const last = run(50, EXPECTED_CHECKS[0], 'completed', conclusion);
      expect(checkVerdict([...allPassed, last]).verdict).toBe('fail');
    }
  });

  it('accepts neutral and skipped', () => {
    const others = [
      run(60, 'lint-bot', 'completed', 'neutral'),
      run(61, 'docs', 'completed', 'skipped'),
    ];
    expect(checkVerdict([...allPassed, ...others]).verdict).toBe('pass');
  });

  it('judges each check by its newest run', () => {
    const retried = [run(0, EXPECTED_CHECKS[0], 'completed', 'failure'), ...allPassed];
    expect(checkVerdict(retried).verdict).toBe('pass');
    const regressed = [...allPassed, run(70, EXPECTED_CHECKS[0], 'completed', 'failure')];
    expect(checkVerdict(regressed).verdict).toBe('fail');
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

  it('ships nothing when the plan found nothing to fix', () => {
    for (const state of ['stuck', 'error', '']) {
      const r = cli(['ship'], { PLAN_STATE: state });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Nothing to ship');
    }
  });
});
