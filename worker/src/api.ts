import { z } from 'zod';
import {
  counterQuerySchema,
  rankBracketSchema,
  regionSchema,
  tierListQuerySchema,
} from '@lolperform/shared';
import type { Env } from './env.js';
import { error, json, parseQuery } from './http.js';
import { cachedJson } from './cache.js';
import {
  getBuildsForChampion,
  getChampionById,
  getChampions,
  getCounters,
  getDuos,
  getDuosForChampion,
  getLatestPatch,
  getMatchupsForChampion,
  getRoleStatsForChampion,
  getTierList,
  type Slice,
} from './db.js';

const sliceQuerySchema = z.object({ region: regionSchema, rank: rankBracketSchema });

type Handler = (request: Request, env: Env) => Promise<Response>;

function cacheKey(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/** Latest patch is the implicit slice dimension; 503 until the first load lands. */
async function resolvePatch(env: Env): Promise<string | null> {
  const row = await getLatestPatch(env);
  return row?.patch ?? null;
}

export const meta: Handler = async (request, env) => {
  const url = new URL(request.url);
  return cachedJson(env, cacheKey(url), async () => {
    const patch = await getLatestPatch(env);
    if (!patch) return { patch: null, champions: [] };
    const champions = await getChampions(env);
    return {
      patch: patch.patch,
      version: patch.version,
      generatedAt: patch.generated_at,
      totalMatches: patch.total_matches,
      champions,
    };
  });
};

export const tierlist: Handler = async (request, env) => {
  const url = new URL(request.url);
  const parsed = parseQuery(url, tierListQuerySchema);
  if (!parsed.ok) return parsed.response;

  const patch = await resolvePatch(env);
  if (!patch) return error(503, 'dataset not loaded yet');

  return cachedJson(env, cacheKey(url), async () => {
    const slice: Slice = { patch, region: parsed.data.region, rank: parsed.data.rank };
    const champions = await getTierList(env, slice, parsed.data.role);
    return {
      patch,
      region: parsed.data.region,
      rank: parsed.data.rank,
      role: parsed.data.role,
      champions,
    };
  });
};

export const champion: Handler = async (request, env) => {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop() ?? '';
  if (!/^[A-Za-z0-9]+$/.test(id)) return error(400, 'invalid champion id');

  const parsed = parseQuery(url, sliceQuerySchema);
  if (!parsed.ok) return parsed.response;

  const patch = await resolvePatch(env);
  if (!patch) return error(503, 'dataset not loaded yet');

  const meta = await getChampionById(env, id);
  if (!meta) return error(404, 'champion not found');

  return cachedJson(env, cacheKey(url), async () => {
    const slice: Slice = { patch, region: parsed.data.region, rank: parsed.data.rank };
    const [stats, matchups, synergies, builds] = await Promise.all([
      getRoleStatsForChampion(env, slice, meta.key),
      getMatchupsForChampion(env, slice, meta.key),
      getDuosForChampion(env, slice, meta.key),
      getBuildsForChampion(env, slice, meta.key),
    ]);
    return { meta, stats, matchups, synergies, builds };
  });
};

export const counters: Handler = async (request, env) => {
  const url = new URL(request.url);
  const parsed = parseQuery(url, counterQuerySchema);
  if (!parsed.ok) return parsed.response;

  const patch = await resolvePatch(env);
  if (!patch) return error(503, 'dataset not loaded yet');

  return cachedJson(env, cacheKey(url), async () => {
    const slice: Slice = { patch, region: parsed.data.region, rank: parsed.data.rank };
    const list = await getCounters(env, slice, parsed.data.role, parsed.data.opponentKey);
    return { opponentKey: parsed.data.opponentKey, role: parsed.data.role, counters: list };
  });
};

export const duos: Handler = async (request, env) => {
  const url = new URL(request.url);
  const parsed = parseQuery(url, sliceQuerySchema);
  if (!parsed.ok) return parsed.response;

  const patch = await resolvePatch(env);
  if (!patch) return error(503, 'dataset not loaded yet');

  return cachedJson(env, cacheKey(url), async () => {
    const slice: Slice = { patch, region: parsed.data.region, rank: parsed.data.rank };
    return { patch, ...parsed.data, duos: await getDuos(env, slice) };
  });
};

export const health: Handler = async () => json({ status: 'ok', service: 'lolperform-worker' });
