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
  await env.CACHE.put(key, body, { expirationTtl: ttl });
  return json(data, { headers: { 'x-cache': 'MISS' } });
}
