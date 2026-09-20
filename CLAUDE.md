# lolperform.com — project map

League of Legends analytics: crawls ranked ladders across eight regions via the Riot API, aggregates into tier
lists, ADC matchups, duo synergy and counters, and attaches an honest sample size to every stat. Keep this file a
map; details live in the files it points to.

## Layout (pnpm workspace)
- `apps/web` — Astro site (`@lolperform/web`).
- `worker/` — Cloudflare Worker: serves the prebuilt site (ASSETS) plus the `/api/v1` surface.
- `pipeline/` — Riot crawl + aggregation into D1 slices.
- `packages/shared` — shared types/util. `db/migrations` — D1 migrations.

## Toolchain
- **pnpm 9.15.9** (`packageManager`), Node >= 22.12. pnpm is installed user-global on this PC
  (`npm i -g pnpm@9.15.9`); `corepack enable` fails here without admin rights.

## Sensors — verified 2026-09-20 on this machine
| Command | What it does | Last result |
|---|---|---|
| `pnpm test` | vitest across the workspace | 107 tests in 12 files, all passing (~7 s) |
| `pnpm run gates` | lint + typecheck + tests + coverage + CRAP + secrets | **all gates passed** |
| `pnpm run lint` / `pnpm run typecheck` | eslint / `tsc -r` | run by gates |
| `pnpm run mutation` | stryker | slow; run deliberately |

Current floors: coverage **62.58%** (floor 62.58) · worst CRAP 240 (ceiling 240) · max complexity 81 · 275 functions.
Gates block since 2026-09-18 and the ratchet auto-tightens: fix the cause, never loosen a threshold.
Worst offenders are uncovered pipeline helpers (`ddragon.getCompletedItems`, `riot/client.request`,
`config.loadConfig`) — good first targets if you want the ratchet to move.

## Run and deploy
- `pnpm dev` (Astro) · `pnpm run cf:dev` (wrangler dev).
- `pnpm run deploy` builds the site then `wrangler deploy`.
- D1 `lolperform` (binding `DB`, migrations in `db/migrations`). `RIOT_API_KEY` is set with
  `wrangler secret put` and never committed.

## Guardrails (each from something that went wrong)
- **Stay on the Cloudflare Workers Free plan.** D1 allows 100k rows written/day — hence the JSON-slice tables
  (one row per champion-role, `WITHOUT ROWID`, no secondary indexes). Estimate rows written before any backfill.
- `run_worker_first = ["/*", "!/_astro/*"]` is deliberate. Without it the asset layer answers directly, the Worker
  never runs, and pages ship with **no CSP** and can be served stale. Content-hashed `/_astro/*` bundles stay on
  the fast path on purpose.
- GitHub scheduled workflows start **hours late**. Gate jobs on "time since last successful run", never on a
  start-hour window (Patch Watch was fixed this way).
- Every stat needs its sample size and confidence treatment. Champions below the threshold belong in the explicit
  *Unranked* section, never graded.

## Specs
Feature work is spec-driven: `specs/NNN-slug/{spec,plan,tasks,notes,verification}.md`.
See `specs/README.md` and the machine-wide rules in `~/.claude/rules/sdd-global.md`.
