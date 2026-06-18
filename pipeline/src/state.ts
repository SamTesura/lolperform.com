import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Persistent pipeline state, committed so the patch-watch cron can diff it. */
export interface PipelineState {
  /** Last fully-processed patch label, e.g. "14.12". */
  lastPatch: string | null;
  /** Last Data Dragon version we built against, e.g. "14.12.1". */
  lastVersion: string | null;
  /** ISO timestamp of the last successful run. */
  lastRunAt: string | null;
}

const STATE_PATH = fileURLToPath(new URL('../state.json', import.meta.url));

const EMPTY: PipelineState = { lastPatch: null, lastVersion: null, lastRunAt: null };

export async function readState(): Promise<PipelineState> {
  try {
    const raw = await readFile(STATE_PATH, 'utf8');
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<PipelineState>) };
  } catch {
    return { ...EMPTY };
  }
}

export async function writeState(state: PipelineState): Promise<void> {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
