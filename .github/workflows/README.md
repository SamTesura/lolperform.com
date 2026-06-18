# GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | PRs + push to `main` | Typecheck, lint, test, and gitleaks secret scan. |
| `patch-watch.yml` | every 6h + manual | Detect a new patch, crawl Riot, aggregate, and load the dataset into D1. |

Deployment itself is handled by **Cloudflare Workers Builds** (connected to this
repo): every push to `main` builds the site and deploys the Worker. No deploy
workflow is needed here.

## Required repository secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Used by | What it is |
| --- | --- | --- |
| `RIOT_API_KEY` | patch-watch | Your Riot **Personal** key (`RGAPI-…`). Never commit it. |
| `CLOUDFLARE_API_TOKEN` | patch-watch | Token with **Account → D1 → Edit** permission, used by `wrangler d1 execute --remote`. |
| `CLOUDFLARE_ACCOUNT_ID` | patch-watch | Your Cloudflare account ID. |

`GITHUB_TOKEN` is provided automatically (used by gitleaks).

## How the refresh works

`patch-watch` compares Data Dragon's latest patch to the newest patch already in
the D1 `patches` table. If they differ (or you run it manually with **force**),
it crawls a sampled set of ranked matches, aggregates them, and loads the result
into D1. The live API reflects the new data within the 10-minute KV cache TTL —
no redeploy required.

Run it manually the first time from the **Actions** tab → *Patch Watch* → *Run
workflow* once `RIOT_API_KEY` is set, to populate D1 immediately.
