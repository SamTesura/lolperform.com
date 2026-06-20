import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { championSquare } from '../../lib/ddragon';

export interface SearchChampion {
  key: string;
  id: string;
  name: string;
}

interface Props {
  champions: SearchChampion[];
  version?: string;
}

interface FeatureResult {
  kind: 'feature';
  label: string;
  href: string;
}
interface ChampResult {
  kind: 'champ';
  meta: SearchChampion;
  href: string;
}
type Result = FeatureResult | ChampResult;

const FEATURES: { label: string; href: string; keywords: string }[] = [
  { label: 'Tier List', href: '/tier-list', keywords: 'tier list ranking rankings best' },
  { label: 'Bot Lane', href: '/bot-lane', keywords: 'bot lane adc support synergy counter duo' },
  { label: 'Champions', href: '/champions', keywords: 'champions list all' },
  { label: 'Methodology', href: '/methodology', keywords: 'methodology data sample how' },
];

const MAX_RESULTS = 8;

export default function ChampionSearch({ champions, version }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const features: Result[] = FEATURES.filter(
      (f) => f.label.toLowerCase().includes(q) || f.keywords.includes(q),
    ).map((f) => ({ kind: 'feature', label: f.label, href: f.href }));
    const champs: Result[] = champions
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
      .map((c) => ({ kind: 'champ', meta: c, href: `/champion/${c.id}` }));
    return [...features, ...champs].slice(0, MAX_RESULTS);
  }, [query, champions]);

  function go(r: Result | undefined) {
    if (r) window.location.href = r.href;
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      go(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showList = open && results.length > 0;

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 rounded-md border border-border-default bg-bg-elevated px-2.5 py-1.5">
        <Search size={15} className="shrink-0 text-text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search champions…"
          aria-label="Search champions and pages"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      {showList ? (
        <ul
          className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border-default bg-bg-overlay shadow-lg"
          role="listbox"
        >
          {results.map((r, i) => (
            <li key={r.kind === 'champ' ? r.meta.key : r.href}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  go(r);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm ${
                  i === active ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary'
                }`}
              >
                {r.kind === 'champ' ? (
                  <>
                    <img
                      src={championSquare(r.meta.id, version)}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                      className="rounded-sm bg-bg-inset"
                    />
                    <span className="truncate">{r.meta.name}</span>
                  </>
                ) : (
                  <>
                    <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-sm bg-bg-inset text-2xs text-accent">
                      ↗
                    </span>
                    <span className="truncate">{r.label}</span>
                    <span className="ml-auto text-2xs text-text-muted uppercase">Page</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
