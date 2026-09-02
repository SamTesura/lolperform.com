import { describe, expect, it } from 'vitest';
import { cachedJson } from './cache.js';
import type { Env } from './env.js';

function envWith(cache: { get: () => Promise<string | null>; put: () => Promise<void> }): Env {
  return { CACHE: cache as unknown as KVNamespace } as unknown as Env;
}

describe('cachedJson', () => {
  it('serves a HIT straight from KV without producing', async () => {
    let produced = 0;
    const env = envWith({
      get: async () => '{"cached":true}',
      put: async () => undefined,
    });
    const res = await cachedJson(env, '/k', async () => {
      produced += 1;
      return { cached: false };
    });
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(await res.json()).toEqual({ cached: true });
    expect(produced).toBe(0);
  });

  it('still answers when the KV write fails (quota, outage)', async () => {
    // The account tripped Cloudflare's daily KV limits on 2026-09-02. A cache
    // write failure must degrade to an uncached response, never a 500.
    const env = envWith({
      get: async () => null,
      put: async () => {
        throw new Error('KV put: daily limit exceeded');
      },
    });
    const res = await cachedJson(env, '/k', async () => ({ fresh: 1 }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
    expect(await res.json()).toEqual({ fresh: 1 });
  });
});
