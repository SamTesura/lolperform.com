# lolperform.com

**A bot-lane-first League of Legends tier list and matchup wiki — readable, transparent, and refreshed every patch.**

Most stats sites stack everything on one screen and hide their methodology. LolPerform inverts
that: a clean tier grid you can scan in seconds, progressive drill-down into champions and
matchups, and a published methodology so you can trust the numbers. It goes deep where it matters
most for bottom lane — ADC matchups and ADC↔Support synergy.

> Status: in active development. See [`progress`](#roadmap) below.

## Why it's different

- **Readable, not overwhelming.** Three levels of disclosure: tier grid → champion → matchup. No wall of stacked numbers.
- **Honest data.** Every figure carries a sample size and a confidence level. Win rates are ranked by the **Wilson lower bound**, so a 60%-over-10-games champion never outranks a 53%-over-5000-games one.
- **Bot-lane depth.** ADC-vs-ADC matchup matrix, ADC+Support duo synergy, and a counter-pick recommender ("enemy locked X → pick Y").
- **Patch-over-patch trends.** ▲▼ win-rate movement so you see who's rising and falling at a glance.

## How it works

Riot's API has **no aggregated tier-list endpoint** — sites build their own by crawling ranked
ladders. LolPerform does the same, at a sampled scale honest about its limits:

```
GitHub Actions (cron)
  └─ detect patch        (ddragon versions.json)
       └─ crawl          (league-v4 → PUUIDs → match-v5, rate-limited)
            └─ aggregate (win/pick/ban, matchups, duos, builds, Wilson confidence, tiers)
                 └─ load (D1 = history of record, KV = hot cache, static JSON = default slice)
                      └─ deploy (Astro build + wrangler) → Cloudflare Workers
```

## Tech

| Layer    | Choice                                                                               |
| -------- | ------------------------------------------------------------------------------------ |
| Frontend | Astro 6 (SSG + content collections) + React 19 islands + Tailwind v4                 |
| Edge     | Cloudflare Workers (Static Assets) + D1 (SQLite) + KV                                |
| Pipeline | TypeScript, runs in GitHub Actions; native `fetch`, custom token-bucket rate limiter |
| Shared   | Zod schemas as the single contract across pipeline ↔ API ↔ UI                        |
| Quality  | TypeScript strict, ESLint, Prettier, Vitest, gitleaks, Dependabot                    |

## Monorepo layout

```
apps/web/        Astro site + React islands
worker/          Cloudflare Worker (serves site + /api/v1)
pipeline/        Riot crawler + aggregator + tier scorer
packages/shared/ Zod schemas, domain constants, stats helpers
db/              D1 schema + migrations
```

## Develop

```bash
corepack enable                 # provides pnpm
pnpm install
pnpm test                       # unit tests (no API key needed)
pnpm dev                        # Astro dev server
pnpm typecheck && pnpm lint
```

## Security

- Riot key lives only in `.dev.vars` (gitignored) and GitHub Actions / Worker secrets — never committed; gitleaks enforces this in CI.
- API params validated as enums with Zod at the edge; D1 access via prepared statements only.
- Strict CSP + full security-header set; assets self-hosted, Data Dragon CDN allowlisted for images.
- Read-only public site: no auth, no PII, minimal attack surface.

## Roadmap

- [x] P0 — Monorepo scaffold + tooling
- [ ] P1 — Design system
- [ ] P2 — Data pipeline (crawl + aggregate + tier)
- [ ] P3 — Storage (D1 + KV)
- [ ] P4 — Worker API + security
- [ ] P5 — Frontend (tier list, bot lane, champion/matchup pages, methodology)
- [ ] P6 — Auto-update CI
- [ ] P7 — Security review + go-live

---

Built by [Samuel Mendieta Brito](https://github.com/SamTesura). Not affiliated with or endorsed by Riot Games.
