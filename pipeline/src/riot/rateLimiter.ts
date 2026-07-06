export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateWindow {
  limit: number;
  intervalMs: number;
}

interface ActiveWindow extends RateWindow {
  hits: number[];
}

/**
 * Multi-window token-bucket limiter. Riot enforces several app-rate windows at
 * once (e.g. 20/s and 100/2min on a dev key); we respect every window before
 * issuing a request so we rarely trip a 429 in the first place.
 */
export class RateLimiter {
  private readonly windows: ActiveWindow[];

  constructor(windows: RateWindow[]) {
    this.windows = windows.map((w) => ({ ...w, hits: [] }));
  }

  /** Resolves once issuing a request would not exceed any window. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      let waitMs = 0;
      for (const w of this.windows) {
        while (w.hits.length > 0 && w.hits[0]! <= now - w.intervalMs) w.hits.shift();
        if (w.hits.length >= w.limit) {
          waitMs = Math.max(waitMs, w.hits[0]! + w.intervalMs - now);
        }
      }
      if (waitMs <= 0) {
        const t = Date.now();
        for (const w of this.windows) w.hits.push(t);
        return;
      }
      await sleep(waitMs);
    }
  }
}

/** Default windows for a Riot development / personal key. */
export const DEV_KEY_WINDOWS: RateWindow[] = [
  { limit: 20, intervalMs: 1000 },
  { limit: 100, intervalMs: 120_000 },
];

/**
 * Parse Riot's `X-App-Rate-Limit` header ("20:1,100:120" = 20 per 1s and 100
 * per 120s) into limiter windows, so the crawler paces at exactly what the key
 * actually allows — dev key today, production key tomorrow, no retuning.
 * Returns [] for anything malformed (caller keeps its current windows).
 */
export function parseRateLimitHeader(value: string): RateWindow[] {
  const windows: RateWindow[] = [];
  for (const part of value.split(',')) {
    const m = /^(\d+):(\d+)$/.exec(part.trim());
    if (!m) return [];
    const limit = Number(m[1]);
    const seconds = Number(m[2]);
    if (limit < 1 || seconds < 1) return [];
    windows.push({ limit, intervalMs: seconds * 1000 });
  }
  return windows;
}
