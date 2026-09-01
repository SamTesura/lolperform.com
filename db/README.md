# Database (Cloudflare D1)

D1 is the **source of truth** — every patch's aggregated stats are stored here so the
API can serve filtered queries and compute patch-over-patch deltas. The Astro build
also reads the latest slice from `pipeline/data/latest/*.json` for prerendered pages;
D1 powers everything dynamic.

## One-time provisioning

```bash
# 1. Create the D1 database — copy the returned database_id into wrangler.toml
wrangler d1 create lolperform

# 2. Create the KV cache namespace — copy the id into wrangler.toml
wrangler kv namespace create CACHE

# 3. Apply the schema
wrangler d1 migrations apply lolperform --remote
```

## Loading a patch (done by the pipeline / CI)

```bash
# After the pipeline writes pipeline/data/latest/*.json:
pnpm --filter @lolperform/pipeline load          # -> db/.generated/load.sql
wrangler d1 execute lolperform --remote --file db/.generated/load.sql
```

The generated SQL is idempotent: rows are upserted by primary key and stamped with the
run's `generated_at`, then rows of that patch carrying an older stamp are pruned. It
deliberately does **not** clear the patch first — see the write budget below. All values
are escaped at generation time.

## The write budget

D1 bills per **row written**, not per byte, and the Workers Free plan allows 100,000 of
them a day — enforced with hard errors since 2026-09-01. Two things follow, and both are
load-bearing:

- **Shape.** One row per champion-role carrying a JSON payload, not one row per matchup.
  The old fan-out cost ~510k rows a load (matchups alone was ~108k rows × the implicit
  rowid PK index × two secondary indexes), and the delete-then-insert pass doubled it to
  ~1M. A load is now ~19.4k rows. The slice tables are `WITHOUT ROWID` and carry no
  secondary indexes because either would double every write.
- **Cadence.** The crawl still runs every 6h (it is free, and the R2 match store only
  compounds), but the D1 load runs at 00:00 and 12:00 UTC plus patch flips — about 40% of
  a day's budget, with room for a manual re-run. See `.github/workflows/patch-watch.yml`.

`pnpm --filter @lolperform/pipeline load` prints the projected row count and what share of
the daily ceiling it is.

## Schema

See [`migrations/0001_init.sql`](migrations/0001_init.sql) for the original tables and
[`migrations/0011_slice_tables.sql`](migrations/0011_slice_tables.sql) for the ones the
Worker reads today:

| Table            | Rows per patch | Holds                                                              |
| ---------------- | -------------- | ------------------------------------------------------------------ |
| `patches`        | 1              | patch label, Data Dragon version, sample size                      |
| `champions`      | ~170           | static Data Dragon metadata                                        |
| `champion_slice` | ~19k           | one champion in one role: matchups, builds, keystones, runes, duos |
| `role_slice`     | 135            | one role slice's ungraded role stats (the tier list)               |
| `duo_slice`      | 27             | the slice-wide duo board, capped at the 500 rows served            |

`CHECK` constraints mirror the Zod enums in `packages/shared` as a storage-boundary safety
net. Every access path is a primary-key prefix or a bounded scan of one
`(patch, region, rank)` range; the counter-pick query projects matchups out of the
payloads with `json_each` so only the rows it keeps cross the wire.

The pre-0011 fan-out tables (`role_stats`, `matchups`, `duos`, `builds`, `keystone_stats`,
`rune_pages`) are still present but no longer read or written. Drop them once the slice
tables have been serving for a few patches — `DROP TABLE` frees the storage they hold.

## Cutover / backfill

`pnpm --filter @lolperform/pipeline backfill` rebuilds the slice rows from whatever the
legacy tables already hold, one `(patch, region, rank)` at a time, so the new Worker can
be deployed without waiting for a crawl. `--patches=1` does only the current patch,
`--dry-run` prints the plan.
