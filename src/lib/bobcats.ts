// Bobcats live stats fetcher.
// Data is collected in Google Sheets and exposed via a Google Apps Script
// web-app deployment that returns JSON (JSONP-wrapped) for any team.

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxq-2I7KqIaE-S7mriXsJ-9s5OjCzFcmpVEMVVG4kGtuns5STvRDjAQi9HdRWyeOvkX/exec';

export type TeamName = 'Muži' | 'Ženy';

export type QbPlayer = {
  name: string;
  jersey: number | string;
  photoUrl?: string;
  qb: { att: number; comp: number; td: number; int: number; yds: number };
};

export type WrPlayer = {
  name: string;
  jersey: number | string;
  photoUrl?: string;
  wr: { rec: number; targets: number; td: number; yds: number; pts: number };
};

export type DbPlayer = {
  name: string;
  jersey: number | string;
  photoUrl?: string;
  db: { flagPull: number; sack: number; int: number; brkup: number };
};

export type Match = {
  date: string;
  opponent: string;
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
};

export type PublicStats = {
  team: string;
  record: { wins: number; losses: number; ties: number; matches: number };
  points: { for: number; against: number; forAvg: number; againstAvg: number };
  qbStats: QbPlayer[];
  wrStats: WrPlayer[];
  defenseLeaders: DbPlayer[];
  tdsByPlayer: { name: string; td: number }[];
  recentMatches: Match[];
};

// Module-level memo cache (warm lambda only).
const cache = new Map<string, { ts: number; data: PublicStats }>();
const CACHE_TTL_MS = 60_000;

/**
 * Fetch public stats for a team via the Bobcats Google Apps Script endpoint.
 * Returns null on failure (so pages can fall back to a friendly empty state).
 */
export async function fetchPublicStats(team: TeamName): Promise<PublicStats | null> {
  const cacheKey = team;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data;

  const cb = `cb_${now}`;
  const url = `${GAS_URL}?action=publicStats&team=${encodeURIComponent(team)}&callback=${cb}`;

  try {
    const res = await fetch(url, {
      // 8s budget — GAS can be slow.
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/javascript, text/javascript, */*' },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn('[bobcats] GAS responded', res.status);
      return null;
    }
    const text = await res.text();
    // Strip JSONP wrapper: cb_XXX({...});
    const stripped = text.replace(/^\s*[a-zA-Z0-9_]+\s*\(/, '').replace(/\)\s*;?\s*$/, '');
    const data = JSON.parse(stripped) as PublicStats;
    cache.set(cacheKey, { ts: now, data });
    return data;
  } catch (err) {
    console.warn('[bobcats] fetch failed', err);
    return null;
  }
}
