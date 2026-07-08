import { useQuery } from '@tanstack/react-query';
import { fetchMeta } from '../../lib/api';
import { QueryProvider } from './QueryProvider';

/**
 * Live "matches analyzed" line for the hero. Reads /api/v1/meta, which the data
 * pipeline updates on every load — the number grows with each 6-hour crawl, no
 * rebuild involved. Falls back to the plain honesty line until data arrives.
 */
function Counter() {
  const meta = useQuery({ queryKey: ['meta'], queryFn: fetchMeta });
  const n = meta.data?.totalMatches;
  const patch = meta.data?.patch;

  return (
    <p className="text-xs text-text-muted">
      {typeof n === 'number' && n > 0 ? (
        <>
          <span className="stat font-semibold text-accent">{n.toLocaleString('en-US')}</span>
          <span> ranked matches analyzed</span>
          {patch ? (
            <span>
              {' '}
              on patch <span className="stat text-text-secondary">{patch}</span>
            </span>
          ) : null}
          <span> — the sample grows every few hours. Sampled, not full-ladder — and honest about it. </span>
        </>
      ) : (
        <span>Sampled, not full-ladder — and honest about it. </span>
      )}
      <a href="/methodology">How the data works →</a>
    </p>
  );
}

export default function SampleCounter() {
  return (
    <QueryProvider>
      <Counter />
    </QueryProvider>
  );
}
