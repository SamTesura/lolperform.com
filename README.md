# lolperform.com

A League of Legends analytics platform that publishes the sample size and confidence behind every
statistic it shows. It crawls ranked ladders across eight regions through the Riot Games API,
aggregates the matches into tier lists, ADC matchups, bot-lane duo synergy and counter picks, and
refuses to grade a champion that has not been played enough this patch.

**Live site:** [lolperform.com](https://lolperform.com) · **Author:**
[Samuel Mendieta](https://samuelmendieta.com/) · **Licence:** [MIT](LICENSE)

[![CI](https://img.shields.io/github/actions/workflow/status/SamTesura/lolperform.com/ci.yml?label=CI)](https://github.com/SamTesura/lolperform.com/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

---

## Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Repository layout](#3-repository-layout)
4. [Data pipeline](#4-data-pipeline)
5. [Statistical methodology](#5-statistical-methodology)
6. [HTTP API reference](#6-http-api-reference)
7. [Local development](#7-local-development)
8. [Configuration reference](#8-configuration-reference)
9. [Testing and quality gates](#9-testing-and-quality-gates)
10. [Deployment](#10-deployment)
11. [Security](#11-security)
12. [Glossary](#12-glossary)
13. [Licence and attribution](#13-licence-and-attribution)

---

## 1. Overview

Riot Games does not publish an aggregated-statistics endpoint. Every League statistics site
therefore builds its numbers by crawling individual matches, and every one of them is working from
a sample rather than the whole ladder. Most present the result as though it were the whole ladder.

This project takes the opposite position: the sample is surfaced, not hidden. A champion's grade,
its win rate and the number of games behind that win rate are shown together, and a champion that
has not cleared the grading floor is left ungraded rather than assigned a misleading one.

### Scope

| Dimension     | Values                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Queue         | Ranked Solo/Duo only (Riot queue id `420`)                                            |
| Regions       | NA, EUW, KR, EUNE, BR, JP, OCE, VN — plus a pooled **All Regions** view (the default) |
| Rank brackets | Emerald+, Diamond+, Master+ (upward-inclusive)                                        |
| Roles         | Top, Jungle, Mid, Bot, Support                                                        |
| Grades        | 15 fine grades, `S+` down to `D-`                                                     |

### Feature summary

- **Tier lists per role**, graded by rank percentile within the role rather than by fixed win-rate
  cutoffs, so `S+` always means "top of this patch's meta".
- **ADC matchup tables**, where the best and toughest lists are disjoint by construction.
- **Head-to-head lane pages** showing both sides of a matchup from one shared game pool.
- **ADC + Support duo synergy**, ranked by confidence-corrected win rate.
- **Counter-pick recommender**, combining curated counter knowledge with live win rates.
- **Patch-over-patch trend arrows** per champion.

---

## 2. Architecture

The system has three independent halves. They share type definitions but deploy on separate
schedules, so a data problem cannot break the site and a site deploy cannot disturb the data.

```
┌──────────────────────────── GitHub Actions (scheduled) ────────────────────────────┐
│                                                                                     │
│   R2 match store  ──restore──▶  crawl 8 regions  ──▶  accumulate  ──▶  aggregate    │
│         ▲                       (league-v4 → match-v5)   (dedupe)      (stats)      │
│         └──────────save──────────────────────────────────────────────────┐          │
│                                                                          ▼          │
└──────────────────────────────────────────────────────────── generate SQL ──────────┘
                                                                           │
                                                                           ▼
                                                              ┌────────── D1 ──────────┐
                                                              │  source of truth       │
                                                              └────────────┬───────────┘
                                                                           │
   browser ──▶ Cloudflare Worker ──▶ KV cache (600 s) ──▶ D1 ──────────────┘
                     │
                     └──▶ ASSETS (prebuilt Astro site)
```

| Layer       | Technology                                              | Responsibility                                                                                   |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Frontend    | Astro (static output) + React islands + Tailwind CSS v4 | Prerendered pages for search engines and instant loads; JavaScript only where a control needs it |
| Edge        | Cloudflare Workers                                      | Serves the prebuilt site and the `/api/v1` surface from one origin                               |
| Database    | Cloudflare D1 (SQLite at the edge)                      | Source of truth, holding per-patch history                                                       |
| Cache       | Cloudflare KV                                           | Hot cache for computed API responses, 600-second TTL                                             |
| Match store | Cloudflare R2                                           | Accumulated, deduplicated match corpus that compounds between runs                               |
| Pipeline    | TypeScript, run by GitHub Actions                       | Crawl, accumulate, aggregate, load                                                               |
| Contracts   | Zod schemas in `packages/shared`                        | One typed contract shared by pipeline, API and UI                                                |

### Why the Worker sits in front of everything

`wrangler.toml` sets:

```toml
run_worker_first = ["/*", "!/_astro/*"]
```

Without it, Cloudflare's asset layer answers matching requests directly and the Worker never runs —
which means HTML ships with **no Content-Security-Policy at all** and can be served stale from the
edge. The exclusion keeps content-hashed `/_astro/*` bundles on the fast asset path, where response
headers do not matter because the filenames are immutable.

This is load-bearing configuration. Removing it silently disables every security header on the site.

---

## 3. Repository layout

A pnpm workspace with four packages.

```
apps/web/              Astro site and React islands
  src/pages/           Route files — index, tier-list/[role], champion/[slug], matchup,
                       bot-lane, methodology, styleguide, 404
  src/components/
    islands/           React components that hydrate in the browser
    primitives/        Presentational building blocks (badges, tiles, portraits)
    site/              Astro header and footer
  src/lib/             API client, Data Dragon helpers, formatting, role helpers
  src/styles/          Design tokens and global CSS

worker/                Cloudflare Worker
  src/index.ts         Router and entry point
  src/api.ts           /api/v1 handlers
  src/db.ts            Prepared D1 queries
  src/cache.ts         KV read-through cache
  src/security.ts      Security headers and CSP

pipeline/              Data pipeline (TypeScript, run under tsx)
  src/riot/            Rate-limited Riot API client and response types
  src/crawl.ts         Ladder crawl across regions
  src/accumulate.ts    Deduplicating match store
  src/aggregate.ts     Statistics and slice construction
  src/tier.ts          Grade assignment
  src/load.ts          D1 SQL generation
  src/backfill.ts      Rebuilds the slice tables from the legacy tables (SQL only,
                       issues no Riot requests)

packages/shared/       Zod schemas, domain constants, statistics helpers, tier policy
db/migrations/         D1 schema migrations, 0001 through 0011
.quality-gates/        Deterministic quality and security gate runner
.github/workflows/     CI, quality gates, security, mutation testing, Patch Watch
specs/                 Spec-driven development documents
```

---

## 4. Data pipeline

### Schedule

Defined in `.github/workflows/patch-watch.yml`:

- **Every 6 hours** (`0 */6 * * *`) — the standard crawl.
- **Wednesdays at 15:00 UTC** (`0 15 * * 3`) — a patch-day sweep. Riot ships patches biweekly on
  Wednesdays with NA deploying roughly 03:00–06:00 PT; 15:00 UTC lands just after that maintenance
  window, so the site rolls onto a new patch hours earlier than the next 6-hour slot would manage.
  Cron cannot express "biweekly", so this fires every Wednesday and off-week runs are ordinary
  crawls.
- **Manual dispatch**, with an optional `force_load` input.

### Stages

1. **Restore.** The accumulated match store is pulled from R2 (`lolperform-matches/matches.ndjson.gz`).
   A missing object is not fatal — it simply means a fresh start. The store travels gzipped because
   the plain NDJSON crossed Wrangler's 300 MiB single-upload limit at roughly 121,000 matches, at
   which point every save failed silently and froze the site's sample for a day.

2. **Crawl.** Each region's ranked ladder is sampled through `league-v4`, then recent matches for
   the sampled players are pulled through `match-v5`. The crawl is bounded by both a per-region
   match ceiling and a wall-clock budget, so a throttled key still finishes and yields partial data.

3. **Accumulate.** New matches merge into the store, deduplicated by match id, with fresh data
   winning any conflict. Balance changes make champion strength patch-specific, so statistics are
   never mixed across patches: only the **dominant** patch is aggregated.

   The store retains exactly two patches — the dominant one and the incoming target — so a patch
   transition is not a cliff. The dataset flips to the new patch once either **20%** of a fresh
   crawl is already on it, or **3,000** of its matches have banked
   (`TARGET_PATCH_FLIP_SHARE`, `MIN_TARGET_PATCH_MATCHES` in `pipeline/src/accumulate.ts`).

4. **Aggregate.** Win, pick and ban rates, matchups, duo synergies, build options and tier grades
   are computed and written into per-champion-role slices.

5. **Save.** The grown store is written back to R2 **before** the database load, so hours of
   crawling can never be lost to a load failure. This step runs even if the crawl step failed,
   because the crawl flushes progress per region and a partial store is still worth keeping.

6. **Load.** SQL is generated and applied to D1, with three retry attempts to ride out transient
   import resets. The upsert is idempotent, so a lost load costs freshness but never consistency.

### Why the load runs on a slower clock than the crawl

Crawling is free; loading is metered. Each load writes roughly 19,400 rows to D1. The workflow
therefore loads only when one of three conditions holds:

- the detected patch differs from the patch currently in D1,
- `force_load` was passed on a manual dispatch, or
- the last load is at least `MAX_LOAD_AGE_HOURS` (currently **5**) old.

The gate is written against the **age of the last load**, never against a wall-clock hour. Scheduled
GitHub Actions runs start late under load — a run scheduled for 12:00 has started at 16:14 — and an
hour-window check skipped loads indefinitely once that drift set in.

> **Plan note.** The account moved to Workers Paid on 2026-09-02. Before that, D1's free-plan ceiling
> of 100,000 rows written per day forced `MAX_LOAD_AGE_HOURS` to 11, about two loads a day. On the
> paid plan four loads a day is roughly 2.3M rows a month against an allowance of 50M, so the value
> was lowered to 5 and the site now refreshes on essentially every crawl.

---

## 5. Statistical methodology

Published for readers at [/methodology](https://lolperform.com/methodology). The implementation
lives in `packages/shared/src/`.

### Ranking signal

Champions are ranked on two combined signals:

- **Strength** — the **Wilson score lower bound** of the win rate. This is a confidence-interval
  method that asks "given this many games, what is the lowest win rate consistent with the
  evidence?" A champion at 60% over 10 games therefore never outranks one at 53% over 5,000 games,
  because the small sample carries a much wider interval.
- **Meta presence** — pick rate plus ban rate, weighted at one third of strength. How contested a
  champion is measures attention, not quality, so it contributes but does not dominate.

### Grading

Grades are cut at fixed **percentiles of the combined ranking**, not at fixed win-rate values
(`packages/shared/src/tier.ts`):

| Grade | Top percentile (cumulative) |     | Grade | Top percentile (cumulative) |
| ----- | --------------------------- | --- | ----- | --------------------------- |
| `S+`  | 4%                          |     | `B-`  | 64%                         |
| `S`   | 9%                          |     | `C+`  | 73%                         |
| `S-`  | 14%                         |     | `C`   | 81%                         |
| `A+`  | 21%                         |     | `C-`  | 88%                         |
| `A`   | 28%                         |     | `D+`  | 93%                         |
| `A-`  | 36%                         |     | `D`   | 97%                         |
| `B+`  | 45%                         |     | `D-`  | 100%                        |
| `B`   | 55%                         |     |       |                             |

### The two sample floors

These are distinct and frequently confused:

| Constant              | Value    | Meaning                                                                                                                                                                                             |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_TIER_GAMES`      | **50**   | Display floor. Below 50 games a win rate is shown as a dash rather than a number.                                                                                                                   |
| `TIER_LIST_MIN_GAMES` | **1000** | Grading floor. A champion enters a role's ranking pool only past 1,000 games **this patch**. Below it there is no grade at all: the champion is omitted from the tier list and its page shows `NR`. |

Confidence labelling uses a separate scale (`SAMPLE_THRESHOLDS`): low at 30 games, medium at 200,
high at 1,000.

### Player-pool correction

A raw win rate measures the champion _and_ whoever picked it. Within a single rank, popular blind
picks are played by weaker players than niche specialist picks are, which systematically flatters
the specialists.

Each match contributes one observation of how strong the picking player is, derived from their
career ranked record, and the aggregate is shrunk toward neutral with a shrinkage constant of
`PLAYER_POOL_SHRINKAGE = 250` (`packages/shared/src/playerSkill.ts`). The correction is deliberately
an under-correction, carries no player identity, and is published next to the win rate rather than
folded invisibly into a score.

### Post-stratification

The crawl deliberately oversamples apex ladders so the Master+ bracket stays usable, and samples
each region on an equal budget. Neither matches reality, so aggregation reweights both:

- **By rank** — `TIER_POPULATION_SHARE` reweights toward the real ladder distribution
  (Emerald 12%, Diamond 4%, Master 0.84%, Grandmaster 0.062%, Challenger 0.025%).
- **By region** — `REGION_POPULATION_SHARE` reweights the pooled _All Regions_ view toward real
  ranked population by server, so small servers do not carry outsized influence.

Champions whose win rate moves with elo or region are exactly the ones a raw, unweighted mix
misgrades.

### Patch tagging

The dataset is tagged by the **dominant patch actually present in the matches**, not by whatever
version Data Dragon reports. Data Dragon's version label routinely drifts from the live game.

---

## 6. HTTP API reference

Read-only. All routes are `GET`, return JSON, and are served from the same origin as the site.
Responses are cached in KV for **600 seconds** and carry an `X-Cache: HIT|MISS` header.

| Route                  | Parameters                              | Returns                                                              |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `/api/health`          | none                                    | `{ status: "ok", service: "lolperform-worker" }`                     |
| `/api/v1/meta`         | none                                    | `patch`, `version`, `generatedAt`, `totalMatches`, `champions[]`     |
| `/api/v1/tierlist`     | `region`, `rank`, `role`                | `{ patch, region, rank, role, champions[] }`                         |
| `/api/v1/champion/:id` | `region`, `rank`                        | `{ meta, stats, matchups, synergies, builds, keystones, runePages }` |
| `/api/v1/counters`     | `region`, `rank`, `role`, `opponentKey` | `{ opponentKey, role, counters[] }`                                  |
| `/api/v1/duos`         | `region`, `rank`                        | `{ patch, region, rank, duos[] }`                                    |

Any other `/api/*` path returns `404 {"error":"not found"}`.

### Query parameters

Every parameter is validated as a Zod enum before it can reach a prepared statement:

- `region` — `all` (default), `na1`, `euw1`, `kr`, `eun1`, `br1`, `jp1`, `oc1`, `vn2`
- `rank` — `emerald_plus` (default), `diamond_plus`, `master_plus`
- `role` — `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY`

The patch is an implicit dimension: routes resolve the latest loaded patch themselves rather than
accepting one.

### Status codes

| Code  | Meaning                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| `200` | Success.                                                                                                          |
| `400` | A parameter failed validation. `/api/v1/champion/:id` also rejects any id that is not strictly alphanumeric.      |
| `404` | Unknown champion, or an unrecognised `/api/*` path.                                                               |
| `503` | `dataset not loaded yet` — D1 holds no patch. Expected on a fresh database, before the first pipeline load lands. |

### Caching

Cache keys are built **only** from the route path and the _validated_ parameters, never from the raw
query string. Zod strips unknown keys, so `?x=<random>` cannot be used to flood the cache with
distinct entries. Responses carry `X-Cache: HIT` or `MISS`.

### Example

```bash
curl -s 'https://lolperform.com/api/v1/tierlist?region=kr&rank=master_plus&role=BOTTOM' \
  | jq '.champions[0]'
```

---

## 7. Local development

### Prerequisites

| Requirement | Version                              |
| ----------- | ------------------------------------ |
| Node.js     | ≥ 22.12                              |
| pnpm        | 9.15.9 (pinned via `packageManager`) |

A Riot API key is needed only to run the data pipeline. The site and API can be developed without
one.

### Install

```bash
git clone https://github.com/SamTesura/lolperform.com.git
cd lolperform.com
pnpm install
```

### Run the site

```bash
pnpm dev
```

Astro serves on `http://localhost:4321` and proxies `/api` to `http://localhost:8787`, where a local
Worker would be listening.

### Run the Worker

```bash
pnpm cf:dev
```

### Develop against real data

A local D1 database is empty, so the data-driven islands render empty states. To borrow the
production API instead:

```bash
API_PROXY=https://lolperform.com pnpm --filter @lolperform/web dev
```

This is the only way to exercise the data-driven parts of the UI locally without seeding a local
database. `changeOrigin` makes the upstream see its own host, satisfying the Worker's origin-locked
CORS.

### Build

```bash
pnpm build
```

> **Note.** The build fetches `ddragon.leagueoflegends.com` during `getStaticPaths` to enumerate
> champions. It therefore requires outbound network access to that host. Without it the build fails
> with `Unexpected token 'H', "Host not i"... is not valid JSON`, which is a blocked request being
> parsed as JSON — not a code error.

### Command reference

| Command                             | Effect                                            |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm dev`                          | Astro dev server                                  |
| `pnpm build`                        | Production build of the site                      |
| `pnpm preview`                      | Serve the built site                              |
| `pnpm cf:dev`                       | Local Cloudflare Worker (`wrangler dev`)          |
| `pnpm test`                         | Vitest, single run                                |
| `pnpm test:watch`                   | Vitest in watch mode                              |
| `pnpm coverage`                     | Vitest with coverage                              |
| `pnpm lint`                         | ESLint                                            |
| `pnpm typecheck`                    | TypeScript across every package                   |
| `pnpm format` / `pnpm format:check` | Prettier write / check                            |
| `pnpm gates`                        | Full quality-gate report (never fails the shell)  |
| `pnpm security`                     | Security scanners only                            |
| `pnpm mutation`                     | Stryker mutation testing (slow; run deliberately) |
| `pnpm deploy`                       | Build the site, then `wrangler deploy`            |

Pipeline commands run from `pipeline/`:

| Command                                           | Effect                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm --filter @lolperform/pipeline crawl`        | Crawl, accumulate and aggregate                                                      |
| `pnpm --filter @lolperform/pipeline load`         | Generate the D1 load SQL                                                             |
| `pnpm --filter @lolperform/pipeline detect-patch` | Report the latest Data Dragon patch and whether it is new                            |
| `pnpm --filter @lolperform/pipeline backfill`     | Rebuild the slice tables from the legacy tables (runs SQL against D1; no Riot calls) |

---

## 8. Configuration reference

### Pipeline tunables

Read in `pipeline/src/config.ts`. Every value is environment-overridable, so the cron can be tuned
without a deploy.

| Variable                 | Default | Meaning                                                                                   |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `RIOT_API_KEY`           | —       | **Required.** Must match `RGAPI-` followed by a 36-character id.                          |
| `PLAYERS_PER_DIVISION`   | `400`   | Ranked entries sampled per league tier and division page.                                 |
| `MATCHES_PER_PLAYER`     | `8`     | Recent ranked matches pulled per sampled player.                                          |
| `MAX_MATCHES_PER_REGION` | `25000` | Hard ceiling on unique matches per region per run.                                        |
| `RIOT_RPS`               | `20`    | Requests-per-second budget. Raise this on a production key — no code change needed.       |
| `MAX_RUNTIME_MINUTES`    | `330`   | Wall-clock budget, split evenly across regions. Sized to fit GitHub's 360-minute job cap. |

### Repository secrets

| Secret                  | Used by                                |
| ----------------------- | -------------------------------------- |
| `RIOT_API_KEY`          | Patch Watch crawl                      |
| `CLOUDFLARE_API_TOKEN`  | Wrangler, for R2 and D1 access from CI |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler                               |

Locally, the Riot key goes in a gitignored `.dev.vars`. It is never committed, and the secret
scanners enforce that.

### Cloudflare bindings

Declared in `wrangler.toml`:

| Binding  | Resource                             |
| -------- | ------------------------------------ |
| `DB`     | D1 database `lolperform`             |
| `CACHE`  | KV namespace                         |
| `ASSETS` | The prebuilt site in `apps/web/dist` |

The D1 `database_id` is committed deliberately; it is an identifier, not a credential.

---

## 9. Testing and quality gates

### Workflows

| Workflow                     | Trigger                                | Purpose                                                                           |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `ci.yml`                     | Push to `main`, every PR               | Typecheck, lint, format check, test, build, rendered-whitespace scan, secret scan |
| `quality-gates.yml`          | Push to `main`, every PR               | Lint, typecheck, tests, coverage ratchet, CRAP and complexity ceilings            |
| `quality-gates-security.yml` | Push, PR, daily at 07:20 UTC           | gitleaks over full history, dependency audit, optional SAST                       |
| `mutation.yml`               | Scheduled                              | Stryker mutation testing                                                          |
| `patch-watch.yml`            | Every 6h, Wednesdays 15:00 UTC, manual | The data pipeline                                                                 |

The two gate workflows split deliberately. `quality-gates.yml` measures correctness and runs
`run-gates.mjs --no-security`; `quality-gates-security.yml` installs gitleaks and Semgrep, checks out
full history, and runs `run-gates.mjs --security-only`. The correctness job does not install the
scanners, so it states that it skipped them rather than reporting a pass it did not measure.

### The ratchet

`.quality-gates/gates.config.json` holds a baseline that only tightens. Coverage may not fall,
and the CRAP and complexity ceilings only move downward. Gates have been blocking since the
`blockAfter` date of 2026-09-18.

**Fix the cause; never loosen a threshold.** Current floors are recorded in `CLAUDE.md`.

**CRAP** (Change Risk Anti-Patterns) is a score combining a function's cyclomatic complexity with
its test coverage. A complex, well-tested function scores low; a complex, untested one scores very
high. It is a prioritised to-do list for testing, not a style metric.

### Local enforcement

A `pre-push` hook runs the same gates before a push leaves the machine. It can be bypassed with
`git push --no-verify`, but CI runs the same checks, so a bypass does not get anything merged.

### Rendered-whitespace scan

`scripts/check-inline-whitespace.mjs` scans every built page for words silently joined together.
Astro can drop line breaks adjacent to inline tags, which corrupts rendered prose without failing
any build or test. The scan exists because that shipped once.

A related pairing must hold: `astroCompressHTML` in `.prettierrc.json` has to mirror `compressHTML`
in `apps/web/astro.config.mjs`. The first tells the formatter which whitespace the compiler
collapses; if the two disagree, the formatter moves spaces the compiler treats differently, which
joins words on the rendered page. Both are pinned to the Astro default today.

### Formatting

`pnpm format:check` runs in CI, so a Prettier or plugin upgrade that changes output fails the pull
request that introduces it, rather than surfacing later as unexplained churn in an unrelated one.
`.gitattributes` forces LF line endings in the working tree; without it, a Windows checkout writes
CRLF and the format check fails on every file.

---

## 10. Deployment

The site deploys through **Cloudflare Workers Builds** on every push to `main`. The build command in
`wrangler.toml` produces the static site, and the Worker is deployed with it. No manual step is
required.

Manual deploy, if needed:

```bash
pnpm deploy
```

Data deploys are entirely separate: Patch Watch writes to D1 on its own schedule, and the live API
picks up new data within the 600-second KV TTL. A site deploy never touches the data, and a data
load never touches the site.

### Database migrations

```bash
pnpm exec wrangler d1 migrations apply lolperform --remote
```

Migrations live in `db/migrations/`, numbered `0001` through `0011`.

---

## 11. Security

- **Secrets.** The Riot key lives only in a gitignored `.dev.vars` locally and in GitHub and Worker
  secrets in production. gitleaks scans full history on every push and pull request, and GitHub push
  protection is enabled.
- **Input validation.** Every API query parameter is validated as a Zod enum before it can reach the
  database, and all D1 access uses prepared statements. No SQL is built by string concatenation.
- **Response headers.** A strict Content-Security-Policy and the full security-header set are applied
  to every response, including static HTML — which is the reason for the `run_worker_first` rule in
  [§2](#2-architecture). The Data Dragon CDN is allowlisted for champion art only.
- **No personal data.** Player identifiers are stripped during match normalisation. No PUUIDs are
  stored anywhere in the system. The one player-derived signal used, the picking player's career win
  rate, is aggregated immediately and carries no identity.
- **Supply chain.** Dependabot runs weekly, grouping production and development updates separately,
  and every update runs the full gate suite before it can merge.

Three major-version updates are deliberately pinned in `.github/dependabot.yml`. Each records why,
because each was a real failure:

| Pinned                      | Reason                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript` major          | TypeScript 7's native compiler breaks `astro check` (`Cannot read properties of undefined (reading 'fileExists')`). Revisit when `@astrojs/check` supports it.                                                                                                  |
| `vitest` major              | Vitest 5 silently breaks mutation testing: the Stryker runner declares `vitest: ">=2.0.0"` but cannot drive v5's filtering, so it runs **0 tests per mutant** and every mutant "survives". The nightly score fell to 7.41% while the suite itself stayed green. |
| `@vitest/coverage-v8` major | Held with `vitest` to keep the pair in step.                                                                                                                                                                                                                    |

That second entry is the failure mode worth internalising: the tests passed, the coverage number
held, and the quality signal was nonetheless worthless. A green check is only as good as the thing
it actually measured.

Vulnerability reports: see [SECURITY.md](SECURITY.md).

---

## 12. Glossary

For readers coming to this without a web-development background.

| Term                              | Meaning                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edge / edge computing**         | Running code in data centres physically near the user rather than in one central location, so pages load quickly worldwide.                                               |
| **Cloudflare Worker**             | A small program that runs at the edge and answers web requests. There is no traditional server to maintain.                                                               |
| **D1**                            | Cloudflare's SQLite database, replicated at the edge. Here it is the source of truth.                                                                                     |
| **KV**                            | A key-value store: a very fast lookup table. Used to hold ready-made API answers for 10 minutes so the database is not queried repeatedly for the same thing.             |
| **R2**                            | Cloudflare's file storage. Holds the growing archive of collected matches.                                                                                                |
| **Static site generation (SSG)**  | Building every page into finished HTML ahead of time, so a visitor receives a complete page instantly instead of waiting for one to be assembled.                         |
| **Astro islands**                 | A page is static HTML except for small "islands" of interactivity that load JavaScript. Less code is sent, so pages are faster.                                           |
| **Hydration**                     | The moment an interactive component wakes up in the browser and starts responding to clicks.                                                                              |
| **Zod schema**                    | A written description of the exact shape data must have. If reality does not match, it is rejected — which stops malformed or hostile input early.                        |
| **Wilson score lower bound**      | A way of ranking that accounts for sample size: it reports the lowest win rate consistent with the evidence, so a small lucky streak cannot outrank a long proven record. |
| **Post-stratification**           | Reweighting a sample so its makeup matches the real population, correcting for deliberate or accidental oversampling.                                                     |
| **Shrinkage**                     | Pulling an estimate from a small sample toward a neutral default, in proportion to how little evidence supports it.                                                       |
| **Rate limiting**                 | Riot caps how many requests may be sent per second. The crawler tracks its own budget and waits rather than being refused.                                                |
| **Cron**                          | A schedule expression telling a machine when to run something. `0 */6 * * *` means "every six hours".                                                                     |
| **CI (continuous integration)**   | Automated checks that run on every change and must pass before it can be merged.                                                                                          |
| **Cyclomatic complexity**         | A count of the independent paths through a function. Higher means more branches and more ways to be wrong.                                                                |
| **Mutation testing**              | Deliberately introducing small bugs to check the test suite notices. Tests that pass regardless are not really testing anything.                                          |
| **Content-Security-Policy (CSP)** | A header telling the browser which sources of code and images to trust, limiting the damage of an injection attack.                                                       |
| **Idempotent**                    | An operation safe to repeat: running it twice leaves the same result as running it once.                                                                                  |
| **Deduplication**                 | Removing repeats. Matches are deduplicated by match id, so the same game is never counted twice.                                                                          |

---

## 13. Licence and attribution

Released under the [MIT Licence](LICENSE).

Developed by [Samuel Mendieta](https://samuelmendieta.com/). Sister project:
[ADC Threat](https://adcthreat.app).

lolperform.com isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games
or anyone officially involved in producing or managing Riot Games properties. Riot Games and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
