import type {
  ChampionDetailResponse,
  ChampionMeta,
  CounterPick,
  DuoSynergy,
  RankBracket,
  Region,
  Role,
  RoleStats,
} from '@lolperform/shared';

const BASE = '/api/v1';

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  const res = await fetch(`${BASE}${path}${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export interface MetaResponse {
  patch: string | null;
  version?: string;
  generatedAt?: string;
  totalMatches?: number;
  champions: ChampionMeta[];
}

export interface TierListResult {
  patch: string;
  region: Region;
  rank: RankBracket;
  role: Role;
  champions: RoleStats[];
}

export interface CountersResult {
  opponentKey: string;
  role: Role;
  counters: CounterPick[];
}

export interface DuosResult {
  patch: string;
  region: Region;
  rank: RankBracket;
  duos: DuoSynergy[];
}

export const fetchMeta = () => get<MetaResponse>('/meta');

export const fetchTierList = (region: Region, rank: RankBracket, role: Role) =>
  get<TierListResult>('/tierlist', { region, rank, role });

export const fetchChampion = (id: string, region: Region, rank: RankBracket) =>
  get<ChampionDetailResponse>(`/champion/${encodeURIComponent(id)}`, { region, rank });

export const fetchCounters = (
  region: Region,
  rank: RankBracket,
  role: Role,
  opponentKey: string,
) => get<CountersResult>('/counters', { region, rank, role, opponentKey });

export const fetchDuos = (region: Region, rank: RankBracket) =>
  get<DuosResult>('/duos', { region, rank });
