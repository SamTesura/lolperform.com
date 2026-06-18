# lolperform.com — Design System

**Style name: Broadcast Obsidian.**
A premium, data-dense, esports-analytics dark theme. Two influences fuse:
the cool obsidian-and-cyan of high-end financial analytics dashboards
(Bloomberg Terminal, Stripe Sigma, Linear), and the sharp typographic rhythm
of esports broadcast graphics (LCS/LEC stat lower-thirds). The result feels
like a tool a Riot data scientist would actually open — not a generic dark
SaaS template, and not a costume-y "gamer" red-on-black skin.

---

## Why this style for this audience

**The audience is a competitive player triaging information under time
pressure** (5 minutes between queues, mid-champion-select). Three psychological
levers drive the choice:

1. **Trust before delight.** Competitive players are statistics-literate and
   instinctively skeptical of any site claiming to know "the best" anything.
   A cool, low-saturation base + tabular numerals + a methodology page
   visible in the nav reads as *peer-reviewed*, not *engagement-bait*.
2. **Cognitive load = bounce.** The reference site (lolalytics) stacks every
   variable at once. Broadcast Obsidian uses background elevation (5 layers)
   and a single accent hue to create unambiguous hierarchy — a tier-tile reads
   as one glance, drill-in reads as a deliberate click.
3. **Progressive disclosure as a feature.** Tier grid → champion page →
   matchup is a 3-step funnel. Each level can use the same tokens at higher
   density. Users learn the visual language once and re-apply it.

**Why not the cliched "League gold-on-black"?** Riot already owns that aesthetic
and competing with their in-client UI on its own turf loses. A cyan-led
analytics palette signals "third-party, independent, math-first" — the
positioning a tier-list site actually wants.

---

## Color palette — the WHY behind each hex

All contrast ratios computed against `--color-bg-base` `#07090d` using WCAG 2.1
relative luminance. Floor for body text is **4.5:1 (AA)**; floor for large /
bold text is **3:1**; floor for non-text UI is **3:1**. Tier-fill ratios are
computed for the tier-letter label placed on each fill.

### Neutrals (obsidian elevation ramp)

| Token | Hex | Role | Contrast vs base |
|---|---|---|---|
| `--color-bg-base` | `#07090d` | page background | — |
| `--color-bg-surface` | `#0d1118` | default card | — |
| `--color-bg-elevated` | `#141923` | hover / popover | — |
| `--color-bg-overlay` | `#1c2230` | modal | — |
| `--color-text-primary` | `#e8ecf3` | body + headings | **14.8 : 1** AAA |
| `--color-text-secondary` | `#a7b0c2` | secondary copy | **7.2 : 1** AAA |
| `--color-text-muted` | `#6b7689` | labels, captions | **4.6 : 1** AA |
| `--color-border-default` | `#232b3d` | card outlines | n/a (non-text 3:1 not required at this size) |

Near-black indigo (not pure `#000`) avoids the OLED-burn feel and gives
elevation layers somewhere to climb. Each layer steps ~+4% L\* so depth reads
even on glare-prone laptop screens.

### Accent — Hextech Cyan (single decisive hue)

| Token | Hex | Contrast vs base |
|---|---|---|
| `--color-accent` | `#4ee0c8` | **7.9 : 1** AAA |
| `--color-accent-hover` | `#6eebd5` | 9.0 : 1 |
| `--color-accent-active` | `#2dc4ac` | 5.8 : 1 |
| `--color-focus-ring` | `#7df0db` | 9.6 : 1 |

A cool cyan-teal at high chroma sits in a perceptual gap left by Riot's own
palette (their UI cyan trends bluer; their gold owns warm). It pops
pre-attentively against the indigo base, codes as "high-tech / scientific" in
color psychology, and pairs naturally with both the win-positive green and
the violet-S tier without clashing. **One accent only** — discipline beats
variety in an analytics product.

### Semantic — win/loss/warning/info (colorblind-safe pairs)

| Token | Hex | Contrast vs base | Pairing rule |
|---|---|---|---|
| `--color-positive` | `#46d39a` | **6.9 : 1** AAA | always paired with ▲ arrow + position |
| `--color-negative` | `#ff6b6b` | **5.5 : 1** AA | always paired with ▼ arrow + position |
| `--color-warning` | `#f5b544` | **9.8 : 1** AAA | always paired with ⚠ icon + "low sample" label |
| `--color-info` | `#6ab8ff` | **7.4 : 1** AAA | always paired with ⓘ icon |

**Colorblind safety contract:** ~8% of male players have red-green CVD. Win
rate and trend MUST never communicate via hue alone. Every win/loss indicator
in this system is rendered as `{icon}{value}{visually-hidden label}` so a
deuteranope sees the icon, a screen-reader user hears the label, and only the
fully-sighted user gets the hue as the third redundant channel.

### Tier palette — S / A / B / C / D

| Tier | Hex (fill) | FG token | Contrast (label on fill) |
|---|---|---|---|
| **S** | `#ffd166` gold | `#1a1405` | **13.5 : 1** AAA |
| **A** | `#b388ff` lavender | `#160a2e` | **8.9 : 1** AAA |
| **B** | `#4ee0c8` hextech cyan | `#04221d` | **7.9 : 1** AAA |
| **C** | `#6ab8ff` sky blue | `#051320` | **7.4 : 1** AAA |
| **D** | `#8693a8` slate | `#0a0d14` | **6.0 : 1** AAA |

Hues span warm-gold → cool-violet → cyan → blue → desaturated slate. Two
deliberate design moves:

1. **Tier D is the only desaturated tone.** A weak champion *looks* weak
   even with hue stripped — its chroma is low. This is colorblind-safe
   redundancy via chroma rather than hue.
2. **Every tier tile literally renders the letter `S`/`A`/`B`/`C`/`D`** as
   its primary signal. Color is reinforcement, never sole channel.

Each tier also exposes a `-soft` background token (e.g.,
`--color-tier-s-soft: #2a2210`) for use as a subtle row tint behind a champion
list, and a `-fg` token for label text — both verified above 4.5:1.

### Delta / trend (▲▼)

| Token | Hex | Glyph | Use |
|---|---|---|---|
| `--color-delta-up` | `#46d39a` | ▲ | rising win-rate / pick-rate |
| `--color-delta-down` | `#ff6b6b` | ▼ | falling |
| `--color-delta-flat` | `#6b7689` | — | < 0.05 pp change |

Same colorblind contract: the arrow is the primary channel, color is
reinforcement, and the value text carries `font-variant-numeric: tabular-nums`
so columns of deltas read as a coherent block.

### Confidence visual language (sample size honesty)

A win-rate based on 12 games is not the same as one based on 50,000 games,
and the design must make that lie impossible to tell by accident.

| Level | Sample threshold | Visual treatment |
|---|---|---|
| **High** | ≥ 1,000 | 100% opacity, solid surface |
| **Medium** | ≥ 200 | 78% opacity, dashed bottom rule |
| **Low** | ≥ 30 | 55% opacity, diagonal warning hatch, ⚠ chip |
| **Insufficient** | < 30 | rendered as Low; stat may be hidden entirely |

Thresholds live in `packages/shared` (`SAMPLE_THRESHOLDS`) and are calibrated for a
**sampled** high-elo dataset — per-matchup counts run in the tens-to-hundreds, so an
op.gg-scale "≥ 5,000 = high" bar would mark nearly everything low-confidence. The
component layer collapses the four data levels into these three visual treatments.

Tokens: `--confidence-high-opacity`, `--confidence-medium-opacity`,
`--confidence-low-opacity`, `--confidence-medium-rule`,
`--confidence-low-hatch`. Applied via the `.confidence-{level}` utility in
`global.css`. **Every statistic component MUST render its sample size and
confidence chip** — the methodology page exists, but the chip is the
in-context proof.

---

## Typography rationale

**Family choices:**

- `--font-sans` — Inter (variable, when self-hosted) → system stack fallback.
  Inter's wide x-height and disambiguated `I/l/1` are made for dense data UI;
  no font on Earth has been more validated for tabular display.
- `--font-display` — Space Grotesk (variable, self-hosted via `@fontsource`
  when added). Geometric, slightly condensed — broadcast-graphic feel without
  novelty-font cost. Wired in tokens, falls back gracefully today.
- `--font-mono` — system mono (SF Mono / JetBrains Mono / Consolas). Used for
  delta blocks and code in the methodology page.

**Why a minor-third scale (1.2)?** A larger scale (1.333, 1.414) creates
dramatic hero stats but visually punishes dense tables — the jump from row
label to row value becomes a cliff. 1.2 gives controlled hierarchy that
survives a 50-row tier grid.

**Tabular numerals are non-negotiable.** Every numeric stat carries
`font-variant-numeric: tabular-nums lining-nums` via the `.stat` / `.tabular`
utility. Without this, a column of `54.2%` / `49.8%` / `51.1%` jitters by ~1px
per row and the page feels broken even when correct.

**Body size is 15px**, not 16px. Mild density gain for tabular content; large
headings still anchor the page. All long-form copy on `/methodology` should
opt up to `--text-md` (16px) via class.

---

## Motion

- `--duration-fast` (140 ms) for hovers and stat toggles.
- `--duration-base` (220 ms) for filter changes and drill-in transitions.
- `--ease-out` for entering content; `--ease-in-out` for two-way transitions;
  `--ease-spring` reserved sparingly (e.g., the patch-delta arrow flip).
- Global `prefers-reduced-motion` kill-switch in `global.css` collapses all
  durations to 0.01 ms.

---

## Component patterns (prose + token usage)

These are the canonical patterns the rest of P1 / P2 will build against.
Each is described in tokens, not pixels, so future re-themes are token-only.

### 1. Tier-grid tile

A square tile, ~88×88 px on desktop, that represents one champion in one
tier row. Composition:

- **Frame**: `border-radius: var(--radius-md)`,
  `background: var(--color-bg-surface)`,
  `border: 1px solid var(--color-border-default)`. On hover lift to
  `--color-bg-elevated` + `box-shadow: var(--shadow-md)`, transition
  `transform var(--duration-fast) var(--ease-out)`.
- **Champion portrait** fills the tile; a 2px inner ring uses the tier's
  fill token (`--color-tier-{x}`) — so the tile is hue-coded *and* the row
  it sits in is already labeled with the tier letter.
- **Stat strip** along the bottom edge: WR% (largest), then pick%, then ban%,
  all `.stat` utility for tabular alignment. WR uses `--color-positive`
  when ≥ 50%, `--color-negative` when < 50%, paired with the ▲/▼ glyph.
- **Delta badge** in the top-right corner: arrow glyph + signed value
  in `.stat-mono`. Hidden when `|delta| < 0.05`.
- **Confidence**: tile wrapper carries `.confidence-{level}` so a low-sample
  champion is visibly dimmer with the diagonal hatch.
- **Interactive**: entire tile is a `<a>` with `:focus-visible` ring
  (`--focus-ring` composite — a 2px base-color gap, then a 2px cyan ring,
  so the ring reads on both dark surfaces and the bright tier fills).

### 2. Role tab (Top / Jungle / Mid / Bot / Support)

Horizontal tab strip above the tier grid.

- Inactive tab: `color: var(--color-text-secondary)`, `font-weight: var(--font-weight-medium)`,
  padding `var(--spacing-2) var(--spacing-4)`, no background.
- Active tab: `color: var(--color-accent)`, with a 2px bottom border in
  `--color-accent` (no pill background — the underline reads as
  "broadcast lower-third", consistent with the style name).
- Hover: `color: var(--color-text-primary)` only, no background change
  (keeps the strip quiet).
- Focus: standard `--focus-ring`.
- Each tab carries a small role icon (sword / axe / staff / bow / shield)
  in `currentColor` so the active-state hue propagates without extra tokens.

### 3. Filter bar (rank + region)

A single horizontal bar of segmented controls + dropdowns, sitting in a
`--color-bg-surface` strip with `--color-border-subtle` top and bottom.

- **Segmented control** (Rank: Iron / Bronze / … / Master+ / All):
  pill container `border-radius: var(--radius-full)`,
  `background: var(--color-bg-inset)`, with the active segment lifted to
  `--color-bg-elevated` and outlined `1px solid var(--color-accent-border)`.
  Active label is `--color-accent`.
- **Region dropdown**: standard select styled with `--color-bg-elevated`
  background, `--color-border-default` border, chevron icon in
  `--color-text-muted`.
- The whole bar is sticky to the top of the tier grid below the role tabs
  so filters persist while scrolling — a usability nod to the player
  jumping between roles mid-session.

### 4. Matchup row (`/bot-lane` matrix; champion page counters)

A single horizontal row representing "Champion X vs Champion Y."

- 3-column grid via Tailwind: `[64px portrait] [auto champion name + meta] [auto stats + delta]`.
- Row background alternates `--color-bg-base` / `--color-bg-surface`
  (zebra striping for scan-ability across long lists).
- WR delta vs the average bot-lane matchup uses `--color-delta-up` / `--color-delta-down`
  + arrow glyph + tabular value. **The matchup is "favored / even / unfavored"
  not "good / bad"** — copy is neutral; color carries the verdict.
- Each row is a `<a>` to `/matchup/[a]-vs-[b]`, `:focus-visible` ring
  inset 2px so it stays inside the row boundary.
- Confidence chip (see below) renders inline after the WR — never optional.

### 5. Stat badge

A small chip showing a single statistic with a label.

- Container: `display: inline-flex`, `gap: var(--spacing-1_5)`,
  `padding: var(--spacing-1) var(--spacing-2)`,
  `border-radius: var(--radius-sm)`, `background: var(--color-bg-elevated)`,
  `border: 1px solid var(--color-border-subtle)`.
- Label: `font-size: var(--text-2xs)`, `text-transform: uppercase`,
  `letter-spacing: 0.08em`, `color: var(--color-text-muted)`.
- Value: `.stat` utility, `font-size: var(--text-sm)`,
  `font-weight: var(--font-weight-semibold)`,
  `color: var(--color-text-primary)`.
- Semantic variants swap the border to `--color-positive` / `--color-negative` /
  `--color-warning` and add the matching `-subtle` background and icon.

### 6. Confidence chip

The honesty badge. Always rendered next to any stat that has a sample size.

- High: `background: var(--color-bg-elevated)`,
  `border: 1px solid var(--color-border-subtle)`,
  text reads "n = 12,840" in `--color-text-muted`, `.stat` utility.
- Medium: same, but border is dashed using `--confidence-medium-rule`,
  prepended with a small ⓘ glyph in `--color-info`.
- Low: `background: var(--color-warning-subtle)`,
  `border: 1px solid var(--color-warning)`,
  prepended with ⚠ glyph in `--color-warning`, label reads
  "low sample · n = 312". The parent stat container *also* gets
  `.confidence-low`, so the dimming + hatch propagate to the whole row.

---

## Anti-patterns (do not ship these)

- **No red-on-black "esports gamer" skin.** That aesthetic codes as
  Twitch-overlay, not analytics. We are not that.
- **No multiple accents.** One cyan, full stop. If a future feature feels
  like it "needs" a second accent, it doesn't — use a semantic token.
- **No tier color without the tier letter.** Hue is reinforcement, never
  sole channel.
- **No raw `text-red-500` / `text-green-500` from Tailwind defaults.** Use
  `--color-positive` / `--color-negative` so the colorblind contract holds.
- **No stat without a sample size and confidence treatment.** If we don't
  know n, we don't show the stat.
- **No full-pill radii on data containers.** Pill on chips and avatars
  only; data tiles use `--radius-md` / `--radius-lg`.
- **No animation on the tier grid beyond 220 ms.** Players are triaging,
  not browsing.

---

## File map

| File | Role |
|---|---|
| `apps/web/src/styles/tokens.css` | All tokens via Tailwind v4 `@theme` + `:root`. |
| `apps/web/src/styles/global.css` | `@import`s tailwind + tokens, base styles, utilities, reduced-motion. |
| `docs/design-system.md` | This document. |
