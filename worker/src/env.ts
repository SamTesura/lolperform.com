/** Runtime bindings declared in wrangler.toml. */
export interface Env {
  /** Static site assets (the built Astro `dist`). */
  ASSETS: Fetcher;
  /** D1 — source of truth for aggregated stats. */
  DB: D1Database;
  /** KV — hot cache for computed API responses. */
  CACHE: KVNamespace;
}
