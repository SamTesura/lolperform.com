// @vitest-environment node
/**
 * Runs the real gate script against a throwaway repo whose `vitest` is a stub
 * that exits with a chosen code and never writes a coverage report.
 *
 * Vitest skips the coverage report whenever a test fails, so a missing report
 * after a failed run is not a tooling problem. On 2026-10-17 the gate said it
 * was, and one failing test read as two separate problems.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const GATES = fileURLToPath(new URL('../.quality-gates/', import.meta.url));
let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gates-fixture-'));
  const gates = join(repo, '.quality-gates');
  mkdirSync(gates);
  for (const f of ['run-gates.mjs', 'crap.mjs', 'security.mjs'])
    copyFileSync(join(GATES, f), join(gates, f));
  writeFileSync(
    join(gates, 'gates.config.json'),
    JSON.stringify({
      blockAfter: '2000-01-01',
      gates: { lint: false, typecheck: false, test: true, coverage: true, security: false },
    }),
  );
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'gates-fixture', scripts: { test: 'vitest run' } }),
  );
  mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', '.bin', 'vitest'), '');
  mkdirSync(join(repo, 'node_modules', '@vitest', 'coverage-v8'), { recursive: true });
  mkdirSync(join(repo, 'node_modules', 'vitest'));
  writeFileSync(
    join(repo, 'node_modules', 'vitest', 'vitest.mjs'),
    'process.exit(Number(process.env.FAKE_VITEST_EXIT));\n',
  );
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function runGates(vitestExit: number) {
  const r = spawnSync(process.execPath, [join(repo, '.quality-gates', 'run-gates.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, CI: '', FAKE_VITEST_EXIT: String(vitestExit) },
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('coverage report missing', () => {
  it(
    'after a failed test run, blames the tests, not the tooling, and still fails',
    { timeout: 60_000 },
    () => {
      const { status, output } = runGates(1);
      expect(output).toContain('[tests]');
      expect(output).toContain('coverage: not measured — the test run failed');
      expect(output).not.toContain('[coverage]');
      expect(output).not.toContain('tooling problem');
      expect(output).toContain('1 gate(s) failed');
      expect(status).toBe(1);
    },
  );

  it('after a passing test run, is still a tooling failure', { timeout: 60_000 }, () => {
    const { status, output } = runGates(0);
    expect(output).not.toContain('[tests]');
    expect(output).toContain('[coverage]');
    expect(output).toContain('tooling problem');
    expect(status).toBe(1);
  });
});
