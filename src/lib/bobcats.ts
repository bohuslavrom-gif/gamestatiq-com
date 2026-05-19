// Bobcats live stats fetcher. Data is collected in Google Sheets and exposed
// via a Google Apps Script web-app deployment.

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxq-2I7KqIaE-S7mriXsJ-9s5OjCzFcmpVEMVVG4kGtuns5STvRDjAQi9HdRWyeOvkX/exec';

export type TeamName = 'Muži' | 'Ženy';

export type QbPlayer = {
  name: string; jersey: number | string; photoUrl?: string;
  qb: { att: number; comp: number; td: number; int: number; yds: number };
};
export type WrPlayer = {
  name: string; jersey: number | string; photoUrl?: string;
  wr: { rec: number; targets: number; td: number; yds: number; pts: number };
};
export type DbPlayer = {
  name: string; jersey: number | string; photoUrl?: string;
  db: { flagPull: number; sack: number; int: number; brkup: number };
};
export type Match = {
  date: string; opponent: string; ourScore: number; oppScore: number;
  result: 'W' | 'L' | 'T';
};
export type PublicStats = {
  team: string;
  record: { wins: number; losses: number; ties: number; matches: number };
  points: { for: number; against: number; forAvg: number; againstAvg: number };
  qbStats: QbPlayer[]; wrStats: WrPlayer[]; defenseLeaders: DbPlayer[];
  tdsByPlayer: { name: string; td: number }[];
  recentMatches: Match[];
};

// ── Coach stats shapes ───────────────────────────────────────
export type DownBreakdown =
  | number
  | { total: number; short: number; medium: number; long: number; sumYds?: number; td?: number };

export type PlaybookAction = {
  name: string; count: number; totalYds?: number; avgYds?: number; td?: number;
};

export type DriveResults = {
  td?: number; downs?: number; int?: number; safety?: number;
  halftime?: number; eog?: number; turnover?: number; other?: number;
};

export type FaulType = {
  name: string;
  count: number;
  yds?: number;
  side: 'Útok' | 'Obrana' | string;
};

export type MatchLogEntry = {
  idx: number; date: string; opponent: string; result: 'W' | 'L' | 'T';
  ourScore: number; oppScore: number;
  offDrives?: number; offTD?: number; defDrives?: number; defStops?: number;
  qbAtt?: number; qbComp?: number; qbTD?: number; qbINT?: number; qbYds?: number; passPct?: number;
  rushYds?: number; passYds?: number; totalYds?: number;
  oppPassYds?: number; oppRushYds?: number; oppTotalYds?: number;
  penCount?: number; penYds?: number; tdPct?: number; stopPct?: number; xp?: number;
  downDist?: Record<string, DownBreakdown>;
  playbookAkce?: PlaybookAction[];
};

export type CoachStats = {
  driveCount: number;
  driveResults: DriveResults;
  endPositions: number[];
  faulyBreakdown: FaulType[];
  matchCount: number;
  matchLog: MatchLogEntry[];
  totals: {
    downDist?: Record<string, DownBreakdown>;
    playbookAkce?: PlaybookAction[];
    fauly?: { count: number; yds: number };
  };
};

// ── Cache + fetcher ──────────────────────────────────────────
const cache = new Map<string, { ts: number; data: any }>();
const TTL = 60_000;

async function fetchGAS<T>(action: string, team: TeamName): Promise<T | null> {
  const key = `${action}:${team}`;
  const now = Date.now();
  const c = cache.get(key);
  if (c && now - c.ts < TTL) return c.data as T;

  const cb = `cb_${now}`;
  const url = `${GAS_URL}?action=${action}&team=${encodeURIComponent(team)}&callback=${cb}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`[bobcats] ${action} responded`, res.status);
      return null;
    }
    const text = await res.text();
    const stripped = text.replace(/^\s*[a-zA-Z0-9_]+\s*\(/, '').replace(/\)\s*;?\s*$/, '');
    const data = JSON.parse(stripped);
    cache.set(key, { ts: now, data });
    return data as T;
  } catch (err) {
    console.warn(`[bobcats] ${action} failed`, err);
    return null;
  }
}

export const fetchPublicStats = (team: TeamName) => fetchGAS<PublicStats>('publicStats', team);
export const fetchCoachStats  = (team: TeamName) => fetchGAS<CoachStats>('coachStats', team);
