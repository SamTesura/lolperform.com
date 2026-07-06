# LoL Performance

<div align="center">

### 🎮 **[LIVE APPLICATION →](https://lolperform.com)** 🎮

**A readable, bot-lane-first League of Legends analytics platform powered by the Riot Games API**

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-lolperform.com-4ee0c8?style=for-the-badge)](https://lolperform.com)
[![CI](https://img.shields.io/github/actions/workflow/status/SamTesura/lolperform.com/ci.yml?style=for-the-badge&label=CI)](https://github.com/SamTesura/lolperform.com/actions/workflows/ci.yml)
[![Riot API](https://img.shields.io/badge/Powered_by-Riot_API-eb0029?style=for-the-badge&logo=riotgames)](https://developer.riotgames.com/)
[![Cloudflare](https://img.shields.io/badge/Edge-Cloudflare_Workers-f38020?style=for-the-badge&logo=cloudflare)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

**Developed by [Samuel Mendieta](https://samuelmendieta.com/)** · Sister project: **[ADC Threat](https://adcthreat.app)**

[Features](#-key-features) • [Live Demo](https://lolperform.com) • [Tech Stack](#-tech-stack) • [Architecture](#-architecture) • [Auto-Updates](#-auto-update-system) • [Security](#-security)

</div>

---

## 🚀 Overview

**LoL Performance** is a production stats platform that answers the question most League sites bury under a wall of numbers: *what should I actually pick, and how sure are we?* It crawls ranked ladders across **eight regions** through the **Riot Games API**, aggregates matches into tier lists, ADC matchups, ADC↔Support synergy, and counter picks — and attaches an **honest sample size and confidence treatment to every single stat**. Champions without enough games sit in an explicit *Unranked* section instead of masquerading as a grade.

**🔗 Live Application:** **[https://lolperform.com](https://lolperform.com)**

---

## ✨ Key Features

### 📊 A Tier List You Can Actually Read
- Fine-grained **S+ → D−** grades calibrated to the real ranked win-rate distribution
- Champions ranked by the **Wilson score lower bound** — a 60%-over-10-games champion never outranks a 53%-over-5,000-games one
- **50-game floor**: below it a champion is *Unranked*, never mislabeled D−
- Confidence dimming + sample-size chips on every tile; three levels of disclosure (grid → champion → matchup)

### 🎯 Bot-Lane Depth
- **ADC matchup lists** — best and toughest are disjoint by construction (only matchups you actually win / lose)
- **Head-to-head lane pages** — both perspectives from the same game pool, with verdict and sample size
- **ADC + Support duo synergy** ranked by confidence-corrected win rate
- **Counter-pick recommender** — curated, stable counter knowledge ("enemy locked X → pick Y") enriched with live win rates

### 🌍 Eight Regions, Pooled by Default
- NA · EUW · EUNE · KR · JP · BR · OCE · VN
- **All Regions** view pools every ladder into the largest, steadiest sample — adding regions enriches the default instead of thinning each slice
- Patch-over-patch **▲▼ trends** per champion

### 🤖 Compounding Data Pipeline
- **GitHub Actions** cron crawls every 6 hours; each run **accumulates** into an R2 match store (deduplicated by match ID) so the sample grows continuously
- **Per-endpoint rate limiters** sized to Riot's documented method limits, with 429/Retry-After backoff
- Dataset tagged by the **dominant patch actually present in the data** — immune to Data Dragon version drift
- Scales with one secret (`RIOT_RPS`) when a bigger API key lands — zero code changes

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Astro (SSG) + React islands + Tailwind v4 | 181 prerendered pages for SEO; islands only where interactivity is needed |
| **Edge** | Cloudflare Workers (Static Assets) | Serves the site + `/api/v1` from 300+ locations, no origin server |
| **Database** | Cloudflare D1 (SQLite) + KV + R2 | D1 = history of record · KV = hot API cache · R2 = accumulated match store |
| **Pipeline** | TypeScript + GitHub Actions | Crawl → accumulate → aggregate → load, fully automated |
| **Contracts** | Zod schemas (`packages/shared`) | One typed contract across pipeline ↔ API ↔ UI — nothing drifts |
| **Quality** | TS strict, ESLint, Vitest, gitleaks, Dependabot | Tests + secret scanning + dependency audit on every PR |

### Why a Sampled Dataset?
- **Honesty over false precision**: Riot's API has no aggregated stats endpoint — every site crawls. Instead of pretending at full-ladder scale, LoL Performance surfaces the sample behind every number
- **Statistics that respect the sample**: Wilson lower bound for ranking, explicit confidence tiers, an Unranked floor
- **Compounding, not static**: the accumulation store grows the sample every 6 hours between patches

---

## 🏗️ Architecture

### Project Structure

```
├── apps/web/                    # Astro site + React islands
│   └── src/pages/               # tier-list, bot-lane, champion/[slug], matchup, methodology
├── worker/                      # Cloudflare Worker: static assets + /api/v1 (Zod-validated)
├── pipeline/                    # Riot crawler, accumulator, aggregator, tier scorer
│   └── src/riot/                # rate-limited API client (per-endpoint token buckets)
├── packages/shared/             # Zod schemas, domain constants, tier bands, stats helpers
├── db/                          # D1 schema + migrations
└── .github/workflows/           # CI (verify + secret-scan) · Patch Watch (6h data cron)
```

### Data Flow

```
GitHub Actions (every 6h)
  restore store (R2) → crawl 8 regions (league-v4 → match-v5, Emerald+)
    → accumulate (dedup by match id, current patch only — resets each patch)
      → aggregate (WR/PR/BR, matchups, duos, builds, Wilson, tiers)
        → load D1 + KV  →  save store (R2)

push to main → Cloudflare Workers Builds → Astro build → live site
(the UI reads /api/v1 → KV → D1 at runtime; site deploys are independent of the data cron)
```

### Key Technical Decisions

1. **Static-first + API islands**: default views prerender for SEO and instant loads; filters hit the Worker API
2. **D1 keeps per-patch history**: enables ▲▼ trends and patch comparisons instead of overwriting each crawl
3. **Accumulation over replacement**: a rate-limited key can't pull millions per run — but it can compound ~2.5k deduped matches every 6 hours
4. **Trust the data, not the CDN**: the dataset is tagged by the patch the matches are actually on; Data Dragon's version label routinely drifts from the live game
5. **One shared schema package**: the pipeline, Worker, and UI import the same Zod contracts — a field rename breaks the build, not production

---

## 🔄 Auto-Update System

1. **Scheduled crawl**: GitHub Actions fires every 6 hours (plus manual dispatch)
2. **Store restore**: the accumulated match set is pulled from R2 — every prior run's matches carry forward
3. **Representative sampling**: apex ladders + weighted Emerald/Diamond entries across all 8 regions, so the sample resembles the real Emerald+ population
4. **Accumulate & reset**: new matches merge in (dedup by match ID); only the current patch is kept — balance changes make champion strength patch-specific, so stats never mix patches, and the sample resets when a patch ships
5. **Aggregate & load**: win/pick/ban rates, matchups, duos, builds, and tiers land in D1; KV caches go hot within 10 minutes
6. **Persist**: the grown store saves back to R2 for the next run — the sample only gets bigger

---

## 🔒 Security

- **Riot API key** lives only in gitignored `.dev.vars` and GitHub/Worker secrets — never committed; **gitleaks + GitHub push protection** enforce it in CI
- **Zod-validated enum params** at the API edge; **prepared D1 statements** only — no string-built SQL
- **Strict CSP** + full security-header set; Data Dragon CDN allowlisted for champion art only
- **No PII**: player identifiers are stripped at match normalization — no PUUIDs stored anywhere in the system
- **Protected `main`**: PRs with green checks required; no force-pushes; fork PRs run without secrets

---

<div align="center">

**Developed by [Samuel Mendieta](https://samuelmendieta.com/)**

lolperform.com isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

</div>
