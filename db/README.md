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

The generated SQL is idempotent: it clears the current patch's rows before inserting,
so re-running a patch is safe. All values are escaped at generation time.

## Schema

See [`migrations/0001_init.sql`](migrations/0001_init.sql). Tables: `patches`,
`champions`, `role_stats`, `matchups`, `duos`, `builds`. `CHECK` constraints mirror the
Zod enums in `packages/shared` as a storage-boundary safety net; slice columns are
indexed for the tier-list, matchup, and counter-pick queries.
