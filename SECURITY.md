# Security

lolperform.com is a **read-only, public** statistics site. It has no user accounts,
no logins, and stores no personal data — which keeps the attack surface small by
design. This document records the threat model, the controls in place, and the
go-live hardening steps.

## Threat model & controls

| Risk | Control |
| --- | --- |
| Secret leakage (Riot key) | Key lives only in GitHub Actions secrets + a gitignored `.dev.vars`; never in code or commits. **gitleaks** runs on every push/PR. A custom rule matches `RGAPI-` keys. |
| SQL injection | All D1 access uses **prepared, bound statements** — no string concatenation of input. Column/`CHECK` constraints mirror the app's enums at the storage boundary. |
| Malicious API input | Every `/api/v1` query parameter is validated against **Zod enums** at the edge; bad input returns `400` and never reaches D1. The champion `:id` path is regex-restricted to `[A-Za-z0-9]`. |
| XSS / content injection | Strict **CSP**: `script-src 'self'` (no inline scripts), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`. Images limited to self + the Data Dragon CDN. No `dangerouslySetInnerHTML` of user/remote data. |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. |
| MITM / downgrade | `Strict-Transport-Security` (2y, includeSubDomains, preload); Cloudflare TLS. |
| MIME sniffing | `X-Content-Type-Options: nosniff`. |
| Cross-origin data theft | `Cross-Origin-Opener-Policy` + `Cross-Origin-Resource-Policy: same-origin`; the API sets no permissive CORS headers (same-origin only). |
| D1 / quota abuse | A **KV cache** (10-min TTL) absorbs repeat traffic so most requests never touch D1; the Workers free-tier request cap bounds total load. See go-live for a per-IP rate-limit rule. |
| Info leak on error | The Worker returns generic `500`/`503` JSON — no stack traces or internals. |
| Supply chain | Lockfile committed; **Dependabot** (grouped) auto-PRs updates; CI runs `pnpm audit --prod --audit-level high`; an `esbuild` override pins the patched build toolchain. |

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `RIOT_API_KEY` | GitHub Actions secret + local `.dev.vars` | `RGAPI-…`. Never committed. `riot.txt` is the **public** Riot verification token — unrelated. |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Scope: Account → D1 → Edit (least privilege for the loader). |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Not secret per se, but kept out of the repo. |

## Data & compliance

Only **aggregate** statistics are computed and served (win/pick/ban rates, matchups,
duos, builds). Individual players' match histories are never exposed or stored, in
line with the Riot API terms. The site is not endorsed by or affiliated with Riot Games.

## Go-live hardening (Cloudflare dashboard)

These complement the in-code controls and are configured on the Cloudflare side:

1. **Rate limiting rule** on `/api/*` (e.g. 60 req/min per IP) — protects the free-tier quota from scraping/abuse.
2. **Always Use HTTPS** + **HSTS** enabled at the zone (the Worker also sends the header).
3. **Bot Fight Mode** / managed WAF rules on (free tier).
4. Confirm the custom domain `lolperform.com` is the only route to the Worker.

## Reporting

Found something? Open a private security advisory on the GitHub repository, or email
the maintainer. Please don't file public issues for vulnerabilities.
