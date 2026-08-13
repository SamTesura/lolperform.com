import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  baseTier,
  DEFAULT_RANK_BRACKET,
  DEFAULT_REGION,
  ROLE_LABELS,
  type Matchup,
  type RankBracket,
  type Region,
} from '@lolperform/shared';
import { fetchChampion, fetchMeta } from '../../lib/api';
import { championIndex } from '../../lib/champions';
import { itemIcon } from '../../lib/ddragon';
import { MatchupRow } from '../primitives/MatchupRow';
import { StatBadge } from '../primitives/StatBadge';
import { TierBadge } from '../primitives/TierBadge';
import { RegionRankControls } from './Controls';
import { QueryProvider } from './QueryProvider';
import { AWAITING_DATA, EmptyState, Loading } from './States';
import type { KeystoneStats, RunePage, RunePageStats } from '@lolperform/shared';
import { formatPercent } from '../../lib/format';

interface ItemInfo {
  name: string;
  plaintext?: string;
  description?: string;
  gold?: { base: number; total: number };
  /** Item ids this one is built from, straight out of Data Dragon. Unlike
   *  everything else on this page it is not a sampled statistic — it is the
   *  shop's own recipe, so it is exact and needs no confidence treatment. */
  from?: string[];
}

interface Piece {
  id: string;
  info: ItemInfo;
}

/** Immediate components of an item, in Data Dragon's own order. */
function componentsOf(id: number, catalog?: Record<string, ItemInfo>): Piece[] {
  const from = catalog?.[String(id)]?.from ?? [];
  const out: Piece[] = [];
  for (const c of from) {
    const info = catalog?.[c];
    if (info) out.push({ id: c, info });
  }
  return out;
}

/**
 * How each finished item is actually bought: the pieces, their prices, and the
 * total. Aimed at players who know what to build but not what to buy on a back
 * — the shop recipe answers that exactly, with no sample size to caveat.
 */
function BuildPath({
  items,
  catalog,
  version,
}: {
  items: number[];
  catalog?: Record<string, ItemInfo>;
  /** Undefined until the meta query resolves; item icons need it, so hold the
   *  section back rather than rendering broken images. */
  version?: string;
}) {
  if (!version) return null;
  const rows = items
    .map((id) => ({ id, info: catalog?.[String(id)], pieces: componentsOf(id, catalog) }))
    .filter((r) => r.info);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5 border-t border-border-subtle pt-3">
      <p className="text-xs text-text-muted">
        What to buy to finish each item — prices are the pieces, not the total.
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <img
              src={itemIcon(r.id, version)}
              alt=""
              width={24}
              height={24}
              loading="lazy"
              className="rounded-sm bg-bg-inset"
            />
            <span className="font-semibold text-text-primary">{r.info!.name}</span>
            {r.info!.gold?.total ? (
              <span className="stat text-tier-s">
                {r.info!.gold.total.toLocaleString('en-US')}g
              </span>
            ) : null}
            {r.pieces.length > 0 ? (
              <>
                <span className="text-text-muted" aria-hidden="true">
                  =
                </span>
                {r.pieces.map((p, i) => (
                  <span key={`${r.id}-${p.id}-${i}`} className="flex items-center gap-1">
                    {i > 0 ? (
                      <span className="text-text-muted" aria-hidden="true">
                        +
                      </span>
                    ) : null}
                    <img
                      src={itemIcon(Number(p.id), version)}
                      alt=""
                      width={18}
                      height={18}
                      loading="lazy"
                      className="rounded-sm bg-bg-inset"
                    />
                    <span className="text-text-secondary">{p.info.name}</span>
                    {p.info.gold?.total ? (
                      <span className="stat text-text-muted">
                        {p.info.gold.total.toLocaleString('en-US')}
                      </span>
                    ) : null}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-text-muted">— buy it straight from the shop</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface KeystoneInfo {
  name: string;
  icon: string;
}

interface RuneStyle {
  id: number;
  name: string;
  icon: string;
  slots: { runes: { id: number; name: string; icon: string }[] }[];
}

interface RuneCatalog {
  keystones: Record<string, KeystoneInfo>;
  byStyle: Record<string, RuneStyle>;
}

/** The nine stat shards. Data Dragon's runesReforged file does not list them,
 *  but their icons live on the same CDN under StatMods. */
const SHARD_INFO: Record<number, { name: string; icon: string }> = {
  5001: { name: 'Health Scaling', icon: 'perk-images/StatMods/StatModsHealthScalingIcon.png' },
  5005: { name: 'Attack Speed', icon: 'perk-images/StatMods/StatModsAttackSpeedIcon.png' },
  5007: { name: 'Ability Haste', icon: 'perk-images/StatMods/StatModsCDRScalingIcon.png' },
  5008: { name: 'Adaptive Force', icon: 'perk-images/StatMods/StatModsAdaptiveForceIcon.png' },
  5010: { name: 'Movement Speed', icon: 'perk-images/StatMods/StatModsMovementSpeedIcon.png' },
  5011: { name: 'Health', icon: 'perk-images/StatMods/StatModsHealthPlusIcon.png' },
  5013: { name: 'Tenacity and Slow Resist', icon: 'perk-images/StatMods/StatModsTenacityIcon.png' },
};

const ddIcon = (path: string): string => `https://ddragon.leagueoflegends.com/cdn/img/${path}`;

function RuneDot({
  icon,
  name,
  chosen,
  size,
}: {
  icon: string;
  name: string;
  chosen: boolean;
  size: number;
}) {
  return (
    <img
      src={ddIcon(icon)}
      alt={chosen ? `${name} (chosen)` : name}
      title={name}
      width={size}
      height={size}
      loading="lazy"
      className={chosen ? 'rounded-full ring-2 ring-accent' : 'rounded-full opacity-30 grayscale'}
    />
  );
}

/**
 * The most common rune page, drawn as the in-client tree: every rune of the
 * primary and secondary styles shown, with the chosen ones lit and the rest
 * dimmed. Layout data comes from Data Dragon, the chosen page from the
 * champion's most common rune signature this patch. Presentation only — the
 * honest per-keystone win rates live in the Keystones list next to it.
 */
function RunePagePanel({ runes, catalog }: { runes: RunePage; catalog?: RuneCatalog }) {
  const primary = catalog?.byStyle?.[String(runes.primaryStyle)];
  const sub = catalog?.byStyle?.[String(runes.subStyle)];
  if (!primary || !sub) return null;
  const chosen = new Set<number>([runes.keystone, ...runes.primary, ...runes.secondary]);
  const chosenShards = [...runes.shards];

  const styleHeader = (style: RuneStyle) => (
    <div className="flex items-center gap-2 rounded-md bg-bg-inset px-2.5 py-1.5">
      <img src={ddIcon(style.icon)} alt="" width={18} height={18} loading="lazy" />
      <span className="text-xs font-semibold text-text-primary">{style.name}</span>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-3">
      <div className="space-y-2.5 rounded-lg bg-bg-inset/60 p-3">
        {styleHeader(primary)}
        <div className="flex justify-center border-b border-border-subtle pb-2">
          {primary.slots[0]?.runes.map((r) => (
            <span key={r.id} className="px-1.5">
              <RuneDot icon={r.icon} name={r.name} chosen={chosen.has(r.id)} size={38} />
            </span>
          ))}
        </div>
        {primary.slots.slice(1).map((slot, si) => (
          <div key={si} className="flex justify-center gap-3">
            {slot.runes.map((r) => (
              <RuneDot key={r.id} icon={r.icon} name={r.name} chosen={chosen.has(r.id)} size={26} />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-2.5 rounded-lg bg-bg-inset/60 p-3">
        {styleHeader(sub)}
        {sub.slots.slice(1).map((slot, si) => (
          <div key={si} className="flex justify-center gap-3">
            {slot.runes.map((r) => (
              <RuneDot key={r.id} icon={r.icon} name={r.name} chosen={chosen.has(r.id)} size={26} />
            ))}
          </div>
        ))}
        <div className="flex justify-center gap-3 border-t border-border-subtle pt-2">
          {chosenShards.map((id, i) =>
            SHARD_INFO[id] ? (
              <RuneDot
                key={`${id}-${i}`}
                icon={SHARD_INFO[id].icon}
                name={SHARD_INFO[id].name}
                chosen
                size={20}
              />
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The champion's rune pages: up to two, switchable, each headed by its own
 * win rate and sample — a per-page pre-lock statistic, so unlike item numbers
 * it means what it says. Falls back to the build row's page when per-page
 * rows haven't been aggregated yet. Options, not one prescription.
 */
function RunePages({
  pages,
  fallback,
  catalog,
}: {
  pages: RunePageStats[];
  fallback?: RunePage;
  catalog?: RuneCatalog;
}) {
  const [active, setActive] = useState(0);
  const usable = pages.filter((p) => p.runes.keystone > 0);
  const current = usable[active] ?? usable[0];

  if (usable.length === 0) {
    if (!fallback) return null;
    return (
      <section className="space-y-2">
        <h3>Most common runes</h3>
        <RunePagePanel runes={fallback} catalog={catalog} />
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3>Rune pages</h3>
      <div className="flex flex-wrap items-center gap-2">
        {usable.map((p, i) => (
          <button
            key={p.slot}
            type="button"
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors duration-150 ${
              i === active
                ? 'border-accent bg-bg-elevated text-text-primary'
                : 'border-border-subtle text-text-muted hover:text-text-primary'
            }`}
          >
            {i === 0 ? 'Most played' : 'Alternative'}
            <span className="stat ml-2 text-text-secondary">{formatPercent(p.winRate)}</span>
            <span className="stat ml-1.5 text-2xs text-text-muted">
              {p.games.toLocaleString('en-US')}g
            </span>
          </button>
        ))}
      </div>
      {current ? <RunePagePanel runes={current.runes} catalog={catalog} /> : null}
    </section>
  );
}

/**
 * Keystone win rates, shown against the champion's own win rate in the role.
 *
 * The delta is the point. A raw keystone win rate still carries the champion's
 * own strength inside it, so comparing keystones to the champion's baseline is
 * what isolates the choice. And unlike an item statistic this is a fair thing
 * to publish at all: a rune page is locked in champion select, before the game
 * exists, so it cannot be an effect of already winning — whereas a completed
 * item's win rate largely measures having survived long enough to finish it.
 */
function Keystones({
  rows,
  baseline,
  catalog,
}: {
  rows: KeystoneStats[];
  /** The champion's win rate in this role — the thing each keystone is judged against. */
  baseline: number | undefined;
  catalog?: Record<string, KeystoneInfo>;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.games - a.games);

  return (
    <section className="space-y-2">
      <h3>Keystones</h3>
      <p className="text-xs text-text-muted">
        Compared with this champion's own win rate in the role. Runes are locked in champion select,
        so unlike item statistics this is a choice made before the game — not a side effect of
        already winning it.
      </p>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-surface">
        {sorted.map((k) => {
          const info = catalog?.[String(k.keystone)];
          const delta = baseline === undefined ? null : k.winRate - baseline;
          return (
            <li key={k.keystone} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
              {info ? (
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/img/${info.icon}`}
                  alt=""
                  width={28}
                  height={28}
                  loading="lazy"
                  className="rounded-sm bg-bg-inset"
                />
              ) : (
                <span className="h-7 w-7 rounded-sm bg-bg-inset" aria-hidden="true" />
              )}
              <span className="min-w-32 flex-1 text-sm text-text-primary">
                {info?.name ?? `Keystone ${k.keystone}`}
              </span>
              <span className="stat text-sm text-text-secondary">{formatPercent(k.winRate)}</span>
              {delta === null ? null : (
                <span
                  className={`stat text-xs ${delta >= 0 ? 'text-tier-s' : 'text-text-muted'}`}
                  title="Difference from this champion's win rate in the role"
                >
                  {delta >= 0 ? '+' : '−'}
                  {formatPercent(Math.abs(delta))}
                </span>
              )}
              <span className="stat text-xs text-text-muted">
                {k.games.toLocaleString('en-US')} games
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SlotOption = { item: number; share: number; games: number };

/**
 * The build laid out the way players read it on the big sites: core items in
 * order, then alternatives per later slot, plus boots as their own decision.
 * Every option shows how often the ladder takes it and on how many games —
 * options, not one prescription. Deliberately no per-slot win rates: an item's
 * "win rate" mostly measures having been winning long enough to buy it, so we
 * publish popularity, which is at least exactly what it claims to be.
 */
function SlotBreakdown({
  slots,
  boots,
  catalog,
  version,
}: {
  slots: SlotOption[][] | null | undefined;
  boots: SlotOption[] | null | undefined;
  catalog?: Record<string, ItemInfo>;
  version?: string;
}) {
  if (!version || !slots || slots.length === 0) return null;
  const named = (o: SlotOption) => catalog?.[String(o.item)]?.name ?? `Item ${o.item}`;

  const OptionRow = ({ o }: { o: SlotOption }) => (
    <li className="flex items-center gap-2">
      <img
        src={itemIcon(o.item, version)}
        alt={named(o)}
        title={named(o)}
        width={28}
        height={28}
        loading="lazy"
        className="rounded-sm bg-bg-inset"
      />
      <span className="stat text-xs text-text-secondary">{formatPercent(o.share)}</span>
      <span className="stat text-2xs text-text-muted">{o.games.toLocaleString('en-US')}g</span>
    </li>
  );

  // An item may top several positional buckets (Navori as both 2nd and 4th),
  // which reads as a broken duplicate. Dedupe cumulatively left to right: the
  // core trio never repeats itself, and each later column only shows items not
  // already on display. Columns can thin out; an empty one hides entirely.
  const used = new Set<number>();
  const core: SlotOption[] = [];
  for (const options of slots.slice(0, 3)) {
    const pick = options.find((o) => !used.has(o.item));
    if (pick) {
      core.push(pick);
      used.add(pick.item);
    }
  }
  const later = slots.slice(3).map((options) => {
    const kept = options.filter((o) => !used.has(o.item)).slice(0, 3);
    for (const o of kept) used.add(o.item);
    return kept;
  });
  const ordinal = (i: number) => `${i + 4}th item`;

  return (
    <div className="space-y-3 border-t border-border-subtle pt-3">
      <div className="flex flex-wrap gap-4">
        {core.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-text-primary">Core items</p>
            <div className="flex items-center gap-1.5">
              {core.map((o, i) => (
                <span key={`${o.item}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 ? (
                    <span className="text-text-muted" aria-hidden="true">
                      →
                    </span>
                  ) : null}
                  <img
                    src={itemIcon(o.item, version)}
                    alt={named(o)}
                    title={`${named(o)} — ${formatPercent(o.share)} of games with this slot filled`}
                    width={34}
                    height={34}
                    loading="lazy"
                    className="rounded-sm bg-bg-inset"
                  />
                </span>
              ))}
            </div>
            <p className="text-2xs text-text-muted">most common first three, in order</p>
          </div>
        ) : null}
        {boots && boots.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-text-primary">Boots</p>
            <ul className="space-y-1">
              {boots.map((o) => (
                <OptionRow key={o.item} o={o} />
              ))}
            </ul>
          </div>
        ) : null}
        {later.map((options, i) =>
          options.length > 0 ? (
            <div key={i} className="space-y-1.5">
              <p className="text-xs font-semibold text-text-primary">{ordinal(i)}</p>
              <ul className="space-y-1">
                {options.map((o) => (
                  <OptionRow key={o.item} o={o} />
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
      <p className="text-2xs text-text-muted">
        Percentages are how often the ladder takes each option, of the games that filled that slot —
        popularity, not win rate, because finishing a late item mostly means you were already
        winning.
      </p>
    </div>
  );
}

type SpellOption = {
  spells: [number, number];
  share: number;
  games: number;
  wins: number;
  winRate: number;
};

interface SpellInfo {
  name: string;
  image: string;
}

/**
 * Summoner spell pairs, each with win rate, pick share and games. The win
 * rate is shown here — and not on items — because spells are locked in
 * champion select: a pre-lock choice cannot be an effect of already winning.
 */
function SpellPairs({
  options,
  catalog,
  version,
}: {
  options: SpellOption[] | null | undefined;
  catalog?: Record<string, SpellInfo>;
  version?: string;
}) {
  if (!version || !options || options.length === 0) return null;
  const info = (id: number) => catalog?.[String(id)];
  return (
    <section className="space-y-2">
      <h3>Summoner spells</h3>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-surface">
        {options.map((o) => (
          <li
            key={o.spells.join('-')}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5"
          >
            <span className="flex items-center gap-1">
              {o.spells.map((id) => {
                const sp = info(id);
                return (
                  <img
                    key={id}
                    src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${sp?.image ?? ''}`}
                    alt={sp?.name ?? `Spell ${id}`}
                    title={sp?.name ?? `Spell ${id}`}
                    width={28}
                    height={28}
                    loading="lazy"
                    className="rounded-sm bg-bg-inset"
                  />
                );
              })}
            </span>
            <span className="min-w-28 flex-1 text-sm text-text-primary">
              {o.spells.map((id) => info(id)?.name ?? id).join(' + ')}
            </span>
            <span className="stat text-sm text-text-secondary">{formatPercent(o.winRate)} win</span>
            <span className="stat text-xs text-text-muted">{formatPercent(o.share)} of games</span>
            <span className="stat text-xs text-text-muted">
              {o.games.toLocaleString('en-US')} games
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Data Dragon item descriptions use light markup (<stats>, <attention>,
 * <passive>, <br>, damage-type tags…). Parse it into plain-text structure and
 * render with React — never as raw HTML.
 */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseItemDescription(desc: string): {
  stats: string[];
  sections: { label?: string; text: string }[];
} {
  const statsMatch = /<stats>([\s\S]*?)<\/stats>/i.exec(desc);
  const stats = statsMatch
    ? statsMatch[1]!
        .split(/<br\s*\/?>/i)
        .map(stripTags)
        .filter(Boolean)
    : [];
  const rest = desc.replace(/<stats>[\s\S]*?<\/stats>/i, '');

  const sections: { label?: string; text: string }[] = [];
  let current: { label?: string; text: string } | null = null;
  for (const rawLine of rest.split(/<br\s*\/?>/i)) {
    const labelMatch = /<(?:passive|active)>([\s\S]*?)<\/(?:passive|active)>/i.exec(rawLine);
    const text = stripTags(
      rawLine.replace(/<(?:passive|active)>[\s\S]*?<\/(?:passive|active)>/i, ''),
    );
    if (labelMatch) {
      if (current && (current.label || current.text)) sections.push(current);
      current = { label: stripTags(labelMatch[1]!), text };
    } else if (text) {
      if (current) current.text = current.text ? `${current.text} ${text}` : text;
      else current = { text };
    }
  }
  if (current && (current.label || current.text)) sections.push(current);
  return { stats, sections };
}

/**
 * "Best" holds only matchups the champion actually wins (>50%), "toughest" only
 * ones it loses (<50%), so the two lists are disjoint by construction — with a
 * thin matchup set, a plain sort-and-take-6 from both ends put the same
 * opponents (even favored ones) on both sides. Exactly-even matchups appear in
 * neither.
 */
function topMatchups(matchups: Matchup[], favored: boolean, n = 6): Matchup[] {
  return matchups
    .filter((m) => (favored ? m.winRate > 0.5 : m.winRate < 0.5))
    .sort((a, b) => (favored ? b.winRate - a.winRate : a.winRate - b.winRate))
    .slice(0, n);
}

function Detail({ championId }: { championId: string }) {
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [rank, setRank] = useState<RankBracket>(DEFAULT_RANK_BRACKET);

  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const champ = useQuery({
    queryKey: ['champion', championId, region, rank],
    queryFn: () => fetchChampion(championId, region, rank),
    retry: false,
  });

  const index = meta.data ? championIndex(meta.data.champions) : new Map();
  const version = meta.data?.version;

  // Item names + one-line descriptions for build tooltips, straight from the
  // same Data Dragon version the icons use. Cached for the session; the build
  // renders fine without it (icons only) if the fetch fails.
  // Rune names, icons and full tree layout live in a separate Data Dragon file.
  const runeCatalog = useQuery({
    queryKey: ['runes', version],
    enabled: Boolean(version),
    staleTime: Infinity,
    queryFn: async (): Promise<RuneCatalog> => {
      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`,
      );
      if (!res.ok) throw new Error(`runesReforged ${res.status}`);
      const styles = (await res.json()) as RuneStyle[];
      const keystones: Record<string, KeystoneInfo> = {};
      const byStyle: Record<string, RuneStyle> = {};
      for (const style of styles) {
        byStyle[String(style.id)] = style;
        for (const r of style.slots[0]?.runes ?? []) {
          keystones[String(r.id)] = { name: r.name, icon: r.icon };
        }
      }
      return { keystones, byStyle };
    },
  });

  const spellCatalog = useQuery({
    queryKey: ['spells', version],
    enabled: Boolean(version),
    staleTime: Infinity,
    queryFn: async (): Promise<Record<string, SpellInfo>> => {
      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`,
      );
      if (!res.ok) throw new Error(`summoner.json ${res.status}`);
      const json = (await res.json()) as {
        data: Record<string, { key: string; name: string; image: { full: string } }>;
      };
      const out: Record<string, SpellInfo> = {};
      for (const sp of Object.values(json.data)) {
        out[sp.key] = { name: sp.name, image: sp.image.full };
      }
      return out;
    },
  });

  const itemCatalog = useQuery({
    queryKey: ['item-catalog', version],
    enabled: Boolean(version),
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<Record<string, ItemInfo>> => {
      const res = await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`,
      );
      if (!res.ok) throw new Error(`item.json ${res.status}`);
      const json = (await res.json()) as { data: Record<string, ItemInfo> };
      return json.data;
    },
  });

  if (champ.isLoading) return <Loading label="Loading champion data…" />;
  if (champ.isError || !champ.data) return <EmptyState {...AWAITING_DATA} />;

  const { meta: self, stats, matchups, synergies, builds } = champ.data;
  // primary role = most games
  const primary = stats.slice().sort((a, b) => b.games - a.games)[0];
  const roleMatchups = primary ? matchups.filter((m) => m.role === primary.role) : matchups;
  const bestMatchups = topMatchups(roleMatchups, true);
  const toughMatchups = topMatchups(roleMatchups, false);
  const champBuild = builds.find((b) => b.opponentKey === null) ?? builds[0];

  return (
    <div className="space-y-6">
      <RegionRankControls region={region} rank={rank} onRegion={setRegion} onRank={setRank} />

      {stats.length === 0 ? (
        <EmptyState {...AWAITING_DATA} />
      ) : (
        <section className="space-y-3">
          <h2>Performance</h2>
          <div className="flex flex-wrap gap-3">
            {stats.map((s) => (
              <div
                key={s.role}
                className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 sm:w-auto sm:gap-3"
              >
                {/* Tiers only for graded rows (score > 0) — the same test the
                    tier list uses — otherwise a lane could read "S+" here
                    while the champion is absent from that lane's tier list.
                    Win rate always shows. */}
                {s.score > 0 ? (
                  <TierBadge
                    tier={baseTier(s.tier)}
                    grade={s.tier}
                    size="md"
                    provisional={s.provisional}
                  />
                ) : (
                  <span
                    className="inline-flex items-center rounded-md border border-border-default px-2 py-1 text-xs font-semibold text-text-muted"
                    title="Not enough games this patch, and no prior-patch data to blend — not tiered yet"
                  >
                    NR
                  </span>
                )}
                <span className="text-sm font-medium text-text-secondary">
                  {ROLE_LABELS[s.role]}
                </span>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3">
                  <StatBadge
                    label="Win"
                    value={formatPercent(s.winRate)}
                    tone={s.winRate >= 0.5 ? 'positive' : 'negative'}
                  />
                  <StatBadge label="Pick" value={formatPercent(s.pickRate)} />
                  <StatBadge label="Ban" value={formatPercent(s.banRate)} />
                  <StatBadge label="Games" value={s.games.toLocaleString('en-US')} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {bestMatchups.length > 0 || toughMatchups.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {bestMatchups.length > 0 ? (
            <section className="space-y-2">
              <h3>Best matchups</h3>
              <div className="overflow-hidden rounded-lg border border-border-default">
                {bestMatchups.map((m, i) => {
                  const opp = index.get(m.opponentKey);
                  if (!opp) return null;
                  return (
                    <MatchupRow
                      key={m.opponentKey}
                      matchup={m}
                      self={self}
                      opponent={opp}
                      version={version}
                      striped={i % 2 === 1}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}
          {toughMatchups.length > 0 ? (
            <section className="space-y-2">
              <h3>Toughest matchups</h3>
              <div className="overflow-hidden rounded-lg border border-border-default">
                {toughMatchups.map((m, i) => {
                  const opp = index.get(m.opponentKey);
                  if (!opp) return null;
                  return (
                    <MatchupRow
                      key={m.opponentKey}
                      matchup={m}
                      self={self}
                      opponent={opp}
                      version={version}
                      striped={i % 2 === 1}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {synergies.length > 0 ? (
        <section className="space-y-2">
          <h3>Bot-lane synergy</h3>
          <div className="flex flex-wrap gap-2">
            {synergies
              .slice()
              .sort((a, b) => b.wilsonLower - a.wilsonLower)
              .slice(0, 8)
              .map((d) => {
                const partnerKey = d.adcKey === self.key ? d.supportKey : d.adcKey;
                const partner = index.get(partnerKey);
                if (!partner) return null;
                return (
                  <span
                    key={partnerKey}
                    className="rounded-sm border border-border-subtle bg-bg-surface px-2 py-1 text-sm"
                  >
                    <span className="text-text-secondary">{partner.name}</span>{' '}
                    <span className="stat font-semibold text-positive">
                      {formatPercent(d.winRate)}
                    </span>
                  </span>
                );
              })}
          </div>
        </section>
      ) : null}

      <Keystones
        rows={champ.data?.keystones?.filter((k) => !primary || k.role === primary.role) ?? []}
        baseline={primary?.winRate}
        catalog={runeCatalog.data?.keystones}
      />
      <RunePages
        pages={(champ.data?.runePages ?? []).filter((p) => !primary || p.role === primary.role)}
        fallback={champBuild?.runes}
        catalog={runeCatalog.data}
      />

      <SpellPairs
        options={champBuild?.spellOptions}
        catalog={spellCatalog.data}
        version={version}
      />

      <section className="space-y-2">
        <h3>Most-bought items</h3>
        {champBuild ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-surface p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {Array.from({
                  // Six item slots, seven for bot lane — the support quest item
                  // occupies one down there.
                  length: champBuild.role === 'BOTTOM' || champBuild.role === 'UTILITY' ? 7 : 6,
                }).map((_, i) => {
                  const id = champBuild.items[i];
                  const info = id ? itemCatalog.data?.[String(id)] : undefined;
                  return id ? (
                    <span key={`${id}-${i}`} className="group relative inline-block">
                      <img
                        src={itemIcon(id, version)}
                        alt={info?.name ?? `Item slot ${i + 1}`}
                        width={40}
                        height={40}
                        loading="lazy"
                        className="rounded-sm bg-bg-inset"
                      />
                      {info ? (
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-60 -translate-x-1/2 rounded-md border border-border-default bg-bg-overlay p-2.5 text-left shadow-lg group-hover:block"
                        >
                          <span className="block text-xs font-semibold text-tier-s">
                            {info.name}
                          </span>
                          {(() => {
                            const parsed = info.description
                              ? parseItemDescription(info.description)
                              : { stats: [], sections: [] };
                            return (
                              <>
                                {/* Items with no passive/active prose (e.g. Infinity
                                  Edge) carry their one-liner in plaintext — show
                                  it under the name like the big sites do. */}
                                {parsed.sections.length === 0 && info.plaintext ? (
                                  <span className="mt-0.5 block text-2xs leading-snug text-text-muted">
                                    {info.plaintext}
                                  </span>
                                ) : null}
                                {parsed.stats.length > 0 ? (
                                  <span className="mt-1 block">
                                    {parsed.stats.map((line) => {
                                      const m = /^([\d.]+%?)\s*(.*)$/.exec(line);
                                      return (
                                        <span
                                          key={line}
                                          className="block text-2xs leading-snug text-text-secondary"
                                        >
                                          {m ? (
                                            <>
                                              <span className="stat font-semibold text-text-primary">
                                                {m[1]}
                                              </span>{' '}
                                              {m[2]}
                                            </>
                                          ) : (
                                            line
                                          )}
                                        </span>
                                      );
                                    })}
                                  </span>
                                ) : null}
                                {parsed.sections.map((s, si) => (
                                  <span key={si} className="mt-1.5 block">
                                    {s.label ? (
                                      <span className="block text-2xs font-semibold text-text-primary">
                                        {s.label}
                                      </span>
                                    ) : null}
                                    {s.text ? (
                                      <span className="block text-2xs leading-snug text-text-muted">
                                        {s.text}
                                      </span>
                                    ) : null}
                                  </span>
                                ))}
                                {info.gold?.total ? (
                                  <span className="mt-1.5 block text-2xs text-text-muted">
                                    Cost:{' '}
                                    <span className="stat font-semibold text-tier-s">
                                      {info.gold.total.toLocaleString('en-US')}
                                    </span>
                                    {typeof info.gold.base === 'number'
                                      ? ` (${info.gold.base})`
                                      : ''}
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <div
                      key={`empty-${i}`}
                      title="No consistent pick for this slot yet"
                      className="h-10 w-10 rounded-sm border border-dashed border-border-subtle bg-bg-inset/50"
                      aria-label={`Item slot ${i + 1}: no consistent pick yet`}
                    />
                  );
                })}
              </div>
              {/* The win rate belongs to the CHAMPION in this role, not to this
                item set: each slot is independently the most-purchased item, a
                composite no single game need have built. Exact-build win rates
                need sample depth a sampled crawl rarely has per champion, so we
                attribute the number honestly instead of implying build causality. */}
              <span
                className="stat text-sm text-text-muted"
                title="Slots show the champion's most-purchased items this patch, ranked by how often each is bought — not one exact build. The win rate is the champion's own in this role."
              >
                champion wins {formatPercent(champBuild.winRate)} ·{' '}
                {champBuild.games.toLocaleString('en-US')} games
              </span>
            </div>
            <BuildPath items={champBuild.items} catalog={itemCatalog.data} version={version} />
            <SlotBreakdown
              slots={champBuild.slotOptions}
              boots={champBuild.bootOptions}
              catalog={itemCatalog.data}
              version={version}
            />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border-subtle bg-bg-surface/60 p-3 text-sm text-text-muted">
            Build data lands as the sample grows — the crawler refreshes it every few hours.
          </p>
        )}
      </section>
    </div>
  );
}

export default function ChampionStats({ championId }: { championId: string }) {
  return (
    <QueryProvider>
      <Detail championId={championId} />
    </QueryProvider>
  );
}
