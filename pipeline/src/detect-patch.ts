import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { getLatestVersion, patchLabel } from './ddragon.js';
import { readState } from './state.js';

export interface PatchStatus {
  latestVersion: string;
  latestPatch: string;
  lastPatch: string | null;
  isNew: boolean;
}

/** Compare the live Data Dragon patch against our last-built patch. */
export async function detectPatch(): Promise<PatchStatus> {
  const latestVersion = await getLatestVersion();
  const latestPatch = patchLabel(latestVersion);
  const { lastPatch } = await readState();
  return { latestVersion, latestPatch, lastPatch, isNew: latestPatch !== lastPatch };
}

/** CLI: print status as JSON and, in GitHub Actions, expose it as step outputs. */
async function main(): Promise<void> {
  const status = await detectPatch();
  console.info(JSON.stringify(status));

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    await appendFile(
      out,
      `is_new=${status.isNew}\nlatest_patch=${status.latestPatch}\nlatest_version=${status.latestVersion}\n`,
    );
  }
}

const isMain = !!argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
