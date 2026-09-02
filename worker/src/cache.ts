import type { Env } from './env.js';
import { json } from './http.js';

const DEFAULT_TTL = 600;

/**
 * Serve a JSON payload from KV if present, otherwise produce it, cache it, and
 * return it. The cache key is the full request path+query, so each filter combo
 * is cached independently. `X-Cache` reflects HIT/MISS.
 */
export async function cachedJson(
  env: Env,
  key: string,
  produce: () => Promise<unknown>,
  ttl = DEFAULT_TTL,
): Promise<Response> {
  const hit = await env.CACHE.get(key);
  if (hit !== null) {
    return new Response(hit, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=600',
        'x-cache': 'HIT',
      },
    });
  }
  const data = await produce();
  const body = JSON.stringify(data);
  // The cache is an optimization, never a dependency: a KV write failure
  // (daily quota on a free plan, a transient KV outage) must degrade to an
  // uncached response, not turn every cache miss into a 500. This surfaced
  // when the account tripped Cloudflare's daily KV limits on 2026-09-02.
  let cacheHeader = 'MISS';
  try {
    await env.CACHE.put(key, body, { expirationTtl: ttl });
  } catch (err) {
    cacheHeader = 'BYPASS';
    console.warn(`[cache] put failed for ${key}: ${String(err)}`);
  }
  return json(data, { headers: { 'x-cache': cacheHeader } });
}
