import { Loader2 } from 'lucide-react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/**
 * Used for both true errors and the pre-data state. Until the first patch crawl
 * runs, the API returns 503 — we frame that as an informative wait, not a failure.
 */
export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border-subtle bg-bg-surface py-16 text-center">
      <p className="font-display text-lg text-text-secondary">{title}</p>
      {detail ? <p className="max-w-md text-sm text-text-muted">{detail}</p> : null}
    </div>
  );
}

export const AWAITING_DATA = {
  title: 'Stats land after the first patch crawl',
  detail:
    'The dataset is built from sampled ranked matches by a scheduled job. Once it runs, this view fills in automatically — no reload needed.',
} as const;
