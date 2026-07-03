# lolperform.com

**Readable, bot-lane-first League of Legends stats — ADC matchups, ADC↔Support synergy, and counter picks, plus a clean tier list with an honest sample size on every number. Eight regions, refreshed every six hours.**

Most stats sites stack everything on one screen and hide their methodology. LolPerform inverts that: a tier grid you can scan in seconds, real bottom-lane depth (ADC matchups, duo synergy, a counter-pick recommender, head-to-head matchup pages), and a [published methodology](https://lolperform.com/methodology). It's a **sampled** dataset, not a full-ladder aggregator like the giants — and it's transparent about exactly that: every stat surfaces its sample size and confidence, and champions below the games floor sit in an explicit **Unranked** section instead of masquerading as a grade.

Live: **https://lolperform.com** · Sister site: **[adcthreat.app](https://adcthreat.app)** — champ-select threat analysis from the same author.

## Why it's different

- **Readable, not overwhelming.** Three levels of disclosure: tier grid → champion → matchup. No wall of stacked numbers.
- **Honest data.** Every figure carries a sample size and a confidence treatment. Win rates are ranked by the **Wilson lower bound**, so a 60%-over-10-games champion never outranks a 53%-over-5,000-games one — and under 50 games a champion is *Unranked*, not mislabeled D−.
- **Bot-lane depth.** ADC matchup lists (disjoint best/toughest), ADC+Support duo synergy, head-to-head lane matchup pages, and a counter-pick recommender built on curated, stable counter knowledge enriched with live win rates.
- **Eight regions, pooled by default.** NA, EUW, EUNE, KR, JP, BR, OCE, VN — with an **All Regions** view that pools them into the largest, steadiest sample. Patch-over-patch ▲▼ trends per champion.

## How it works

Riot's API has **no aggregated tier-list endpoint** — sites build their own by crawling ranked ladders. LolPerform does the same, at a sampled scale that compounds:

```
GitHub Actions (cron, every 6h)
  └─ detect patch     (ddragon versions.json — advisory; the data decides)
  └─ restore store    (R2: accumulated matches from every prior run)
       └─ crawl       (league-v4 apex+entries → PUUIDs → match-v5, Emerald+,
                       8 regions, per-endpoint rate limiters, 429 backoff)
            └─ accumulate  (dedup by match id, keep the two newest patches,
                            tag by the dominant patch actually present)
                 └─ aggregate  (win/pick/ban, matchups, duos, builds,
                                Wilson confidence, tiers)
                      └─ load   (D1 = history of record, KV = hot cache)
                      └─ save store back to R2

push to main ──▶ Cloudflare Workers Builds ──▶ Astro build ──▶ live site
                 (site deploys are independent of the data cron;
                  the UI reads /api/v1 → KV → D1 at runtime)
```

The accumulation store is the volume lever: each run adds ~2.5k deduped matches, so the sample grows every six hours regardless of key tier — and scales up with a single `RIOT_RPS` secret when a bigger key lands.

## Tech

| Layer    | Choice                                                                                |
| -------- | ------------------------------------------------------------------------------------- |
| Frontend | Astro (SSG) + React islands + Tailwind v4 (CSS-first tokens)                           |
| Edge     | Cloudflare Workers (Static Assets) + D1 (SQLite) + KV + R2 (match store)               |
| Pipeline | TypeScript in GitHub Actions; native `fetch`, per-endpoint token-bucket rate limiters  |
| Shared   | Zod schemas as the single contract across pipeline ↔ API ↔ UI                          |
| Quality  | TypeScript strict, ESLint, Prettier, Vitest, gitleaks, Dependabot, branch ruleset      |

## Monorepo layout

```
apps/web/        Astro site + React islands
worker/          Cloudflare Worker (serves site + /api/v1)
pipeline/        Riot crawler + accumulator + aggregator + tier scorer
packages/shared/ Zod schemas, domain constants, tier bands, stats helpers
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

Merges to `main` deploy automatically via Cloudflare Workers Builds. Manual fallback: `pnpm exec wrangler deploy`.

## Security

- Riot key lives only in `.dev.vars` (gitignored) and GitHub Actions / Worker secrets — never committed; gitleaks + GitHub push protection enforce it.
- API params validated as Zod enums at the edge; D1 access via prepared statements only.
- Strict CSP + full security-header set; assets self-hosted, Data Dragon CDN allowlisted for images.
- Read-only public site: no auth, no PII — the pipeline strips player identifiers at normalization, so no PUUIDs are stored anywhere.
- `main` is protected: PRs only, required green checks, no force-pushes.

---

Built by [Samuel Mendieta Brito](https://github.com/SamTesura). lolperform.com isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
