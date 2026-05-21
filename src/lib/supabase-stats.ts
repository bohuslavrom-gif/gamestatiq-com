// Supabase-backed match reader. Symmetric to lib/bobcats.ts but reads from the
// matches/match_player_stats/match_plays/match_fouls tables that the Scorer
// PWA writes to. Designed to be merged side-by-side with GAS data in
// /app/stats so the user can see live PWA-saved matches without the legacy
// Sheets bridge yet being retired.
//
// v6.1 scope: matches + per-match player stat aggregates. No drives,
// downs, playbook, or faul aggregates (those will land in v6.2 once
// match_plays / match_fouls have meaningful data).

import { getSupabaseAdmin } from './supabase';
import type {
  Match, MatchLogEntry, QbPlayer, WrPlayer, DbPlayer, PlayerMatchStats,
  CoachStats, DownBreakdown, PlaybookAction, FaulType, OffSnapshot, DefSnapshot,
  DriveResults,
} from './bobcats';

// ── DB row shapes ────────────────────────────────────────────────

type MatchRow = {
  id: string;
  club_id: string;
  date: string;
  opponent: string;
  our_score: number;
  opp_score: number;
  rush_yds: number | null;
  pass_yds: number | null;
  total_yds: number | null;
  off_drives: number | null;
  off_td: number | null;
  qb_att: number | null;
  qb_comp: number | null;
  qb_td: number | null;
  qb_int: number | null;
  qb_yds: number | null;
  xp1_att: number | null;
  xp1_ok: number | null;
  xp2_att: number | null;
  xp2_ok: number | null;
  def_drives: number | null;
  def_stops: number | null;
  opp_rush_yds: number | null;
  opp_pass_yds: number | null;
  opp_total_yds: number | null;
  pen_count: number | null;
  pen_yds: number | null;
  created_at: string;
};

type PlayerStatsRow = {
  match_id: string;
  player_id: string;
  qb_att: number | null; qb_comp: number | null; qb_yds: number | null;
  qb_td: number | null;  qb_int: number | null;  qb_sack: number | null;
  wr_targets: number | null; wr_rec: number | null; wr_yds: number | null;
  wr_td: number | null; wr_xp: number | null; wr_pts: number | null;
  db_flag_pull: number | null; db_sack: number | null;
  db_brkup: number | null; db_int: number | null;
  players: {
    first_name: string;
    last_name: string | null;
    jersey_number: number | null;
    photo_url: string | null;
  } | null;
};

// ── Public types ─────────────────────────────────────────────────

export type SupabaseMatchSummary = MatchLogEntry & {
  /** Stable UUID from Supabase. Useful for /app/stats?match=<uuid> drilldown later. */
  supabaseId: string;
  /** Mark as coming from Supabase so the UI can show a source badge. */
  source: 'supabase';
};

export type SupabaseStatsResult = {
  clubId: string | null;
  matches: SupabaseMatchSummary[];
  /** Aggregated season-level player stats across all Supabase matches. */
  qbStats: QbPlayer[];
  wrStats: WrPlayer[];
  defenseLeaders: DbPlayer[];
  /** Convenience: latest match date string (YYYY-MM-DD) or null. */
  latestDate: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────

const formatDate = (iso: string) => {
  // Convert "2026-04-13" → "13. 4. 2026" to match GAS rendering
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${parseInt(d, 10)}. ${parseInt(m, 10)}. ${y}`;
};

const formatPlayerName = (first: string, last: string | null) =>
  last ? `${first} ${last}` : first;

function rowToMatchLogEntry(row: MatchRow, idx: number): SupabaseMatchSummary {
  const result: 'W' | 'L' | 'T' =
    row.our_score > row.opp_score ? 'W' :
    row.our_score < row.opp_score ? 'L' : 'T';

  const rushYds  = row.rush_yds  ?? 0;
  const passYds  = row.pass_yds  ?? 0;
  const totalYds = row.total_yds ?? (rushYds + passYds);

  const oppRush = row.opp_rush_yds ?? 0;
  const oppPass = row.opp_pass_yds ?? 0;
  const oppTotal = row.opp_total_yds ?? (oppRush + oppPass);

  const passPct =
    row.qb_att && row.qb_att > 0 && row.qb_comp != null
      ? row.qb_comp / row.qb_att
      : undefined;

  const tdPct =
    row.off_drives && row.off_drives > 0 && row.off_td != null
      ? row.off_td / row.off_drives
      : undefined;

  const stopPct =
    row.def_drives && row.def_drives > 0 && row.def_stops != null
      ? row.def_stops / row.def_drives
      : undefined;

  const xp1Pct =
    row.xp1_att && row.xp1_att > 0 && row.xp1_ok != null
      ? row.xp1_ok / row.xp1_att
      : undefined;
  const xp2Pct =
    row.xp2_att && row.xp2_att > 0 && row.xp2_ok != null
      ? row.xp2_ok / row.xp2_att
      : undefined;

  return {
    supabaseId: row.id,
    source: 'supabase',
    idx,
    date: formatDate(row.date),
    opponent: row.opponent,
    result,
    ourScore: row.our_score,
    oppScore: row.opp_score,
    offDrives: row.off_drives ?? undefined,
    offTD:    row.off_td     ?? undefined,
    defDrives: row.def_drives ?? undefined,
    defStops:  row.def_stops  ?? undefined,
    qbAtt:  row.qb_att  ?? undefined,
    qbComp: row.qb_comp ?? undefined,
    qbTD:   row.qb_td   ?? undefined,
    qbINT:  row.qb_int  ?? undefined,
    qbYds:  row.qb_yds  ?? undefined,
    passPct,
    rushYds, passYds, totalYds,
    oppRushYds: oppRush, oppPassYds: oppPass, oppTotalYds: oppTotal,
    penCount: row.pen_count ?? undefined,
    penYds:   row.pen_yds   ?? undefined,
    tdPct, stopPct,
    xp1Att: row.xp1_att ?? undefined,
    xp1Ok:  row.xp1_ok  ?? undefined,
    xp1Pct,
    xp2Att: row.xp2_att ?? undefined,
    xp2Ok:  row.xp2_ok  ?? undefined,
    xp2Pct,
    // v6.2: downDist, playbookAkce from match_plays
  };
}

function aggregatePlayerStats(rows: PlayerStatsRow[]): {
  qbStats: QbPlayer[]; wrStats: WrPlayer[]; defenseLeaders: DbPlayer[];
} {
  // Group by player_id, sum all per-match stats
  type Bucket = {
    name: string; jersey: number | string; photoUrl?: string;
    qb: { att: number; comp: number; td: number; int: number; yds: number };
    wr: { rec: number; targets: number; td: number; yds: number; pts: number };
    db: { flagPull: number; sack: number; int: number; brkup: number };
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    if (!r.players) continue;
    const id = r.player_id;
    let b = buckets.get(id);
    if (!b) {
      b = {
        name: formatPlayerName(r.players.first_name, r.players.last_name),
        jersey: r.players.jersey_number ?? '—',
        photoUrl: r.players.photo_url ?? undefined,
        qb: { att: 0, comp: 0, td: 0, int: 0, yds: 0 },
        wr: { rec: 0, targets: 0, td: 0, yds: 0, pts: 0 },
        db: { flagPull: 0, sack: 0, int: 0, brkup: 0 },
      };
      buckets.set(id, b);
    }
    b.qb.att   += r.qb_att   ?? 0;
    b.qb.comp  += r.qb_comp  ?? 0;
    b.qb.td    += r.qb_td    ?? 0;
    b.qb.int   += r.qb_int   ?? 0;
    b.qb.yds   += r.qb_yds   ?? 0;
    b.wr.targets += r.wr_targets ?? 0;
    b.wr.rec     += r.wr_rec     ?? 0;
    b.wr.td      += r.wr_td      ?? 0;
    b.wr.yds     += r.wr_yds     ?? 0;
    b.wr.pts     += r.wr_pts     ?? 0;
    b.db.flagPull += r.db_flag_pull ?? 0;
    b.db.sack     += r.db_sack     ?? 0;
    b.db.int      += r.db_int      ?? 0;
    b.db.brkup    += r.db_brkup    ?? 0;
  }

  const qbStats: QbPlayer[] = [];
  const wrStats: WrPlayer[] = [];
  const defenseLeaders: DbPlayer[] = [];

  for (const b of buckets.values()) {
    if (b.qb.att > 0 || b.qb.td > 0) {
      qbStats.push({ name: b.name, jersey: b.jersey, photoUrl: b.photoUrl, qb: b.qb });
    }
    if (b.wr.targets > 0 || b.wr.rec > 0 || b.wr.td > 0) {
      wrStats.push({ name: b.name, jersey: b.jersey, photoUrl: b.photoUrl, wr: b.wr });
    }
    if (b.db.flagPull > 0 || b.db.sack > 0 || b.db.int > 0 || b.db.brkup > 0) {
      defenseLeaders.push({ name: b.name, jersey: b.jersey, photoUrl: b.photoUrl, db: b.db });
    }
  }

  return { qbStats, wrStats, defenseLeaders };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Fetch all Supabase-backed matches + season-level aggregates for the user's
 * primary club (resolved via club_members → club_id).
 * Returns nulls/empty arrays gracefully if user has no club or no matches.
 */
export async function fetchSupabaseStats(teamId: string | null): Promise<SupabaseStatsResult> {
  const empty: SupabaseStatsResult = {
    clubId: null, matches: [], qbStats: [], wrStats: [], defenseLeaders: [], latestDate: null,
  };

  if (!teamId) return empty;
  const admin = getSupabaseAdmin();

  // 1. Resolve club_id via teams (just for the result metadata)
  const { data: teamRow } = await admin
    .from('teams')
    .select('club_id')
    .eq('id', teamId)
    .maybeSingle();
  const clubId = (teamRow as { club_id: string } | null)?.club_id ?? null;

  // 2. Fetch matches for that team, oldest first (so idx matches GAS convention)
  const { data: matchRowsRaw, error: matchErr } = await admin
    .from('matches')
    .select('*')
    .eq('team_id', teamId)
    .order('date', { ascending: true });
  if (matchErr || !matchRowsRaw) {
    // eslint-disable-next-line no-console
    console.warn('[supabase-stats] matches fetch failed', matchErr);
    return { ...empty, clubId };
  }
  const matchRows = matchRowsRaw as MatchRow[];
  const matches = matchRows.map((row, i) => rowToMatchLogEntry(row, i + 1));

  if (matches.length === 0) {
    return { ...empty, clubId };
  }

  // 3. Fetch player stats with player join (one round-trip)
  const matchIds = matchRows.map((m) => m.id);
  const { data: psRowsRaw, error: psErr } = await admin
    .from('match_player_stats')
    .select(`
      match_id, player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int, qb_sack,
      wr_targets, wr_rec, wr_yds, wr_td, wr_xp, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url )
    `)
    .in('match_id', matchIds);
  if (psErr) {
    // eslint-disable-next-line no-console
    console.warn('[supabase-stats] match_player_stats fetch failed', psErr);
  }
  const psRows = (psRowsRaw ?? []) as unknown as PlayerStatsRow[];

  const { qbStats, wrStats, defenseLeaders } = aggregatePlayerStats(psRows);

  const latestDate = matchRows.length > 0
    ? matchRows[matchRows.length - 1].date
    : null;

  return { clubId, matches, qbStats, wrStats, defenseLeaders, latestDate };
}

/**
 * Parse any common date string GAS or Supabase might emit into a stable
 * YYYYMMDD numeric key. Handles:
 *   - ISO: "2026-04-13" or "2026-04-13T..."
 *   - cs-CZ: "13. 4. 2026" or "13.4.2026"
 *   - JS toString: "Mon Apr 13 2026 00:00:00 GMT+0200 (...)"
 * Returns 0 if unparseable (which will only match other unparseables).
 */
function dateKey(s: string): number {
  if (!s) return 0;
  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return parseInt(m[1] + m[2] + m[3], 10);
  // cs-CZ "D. M. YYYY" or "D.M.YYYY"
  m = s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/);
  if (m) {
    const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
    return parseInt(yyyy + m[2].padStart(2, '0') + m[1].padStart(2, '0'), 10);
  }
  // Fallback: JS Date.parse (handles "Mon Apr 13 2026 ..." and most variants)
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return parseInt(
      String(d.getUTCFullYear()) +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCDate()).padStart(2, '0'),
      10
    );
  }
  return 0;
}

/** Composite key (date + opponent), normalized for cross-source matching. */
export function matchKey(m: { date: string; opponent: string }): string {
  return `${dateKey(m.date)}|${oppKey(m.opponent)}`;
}

/** Normalize opponent string: strip diacritics, whitespace, lowercase. */
function oppKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Merge GAS match log with Supabase matches, deduplicating by (date, opponent).
 * Supabase entries win when both sources have the same match. Returns the
 * merged log sorted by idx (chronological).
 */
export function mergeMatchLogs(
  gasLog: MatchLogEntry[],
  supabaseLog: SupabaseMatchSummary[]
): Array<MatchLogEntry & { source?: 'supabase' | 'gas'; supabaseId?: string }> {
  const merged = new Map<string, MatchLogEntry & { source?: 'supabase' | 'gas'; supabaseId?: string }>();

  const keyOf = (m: { date: string; opponent: string }) =>
    `${dateKey(m.date)}|${oppKey(m.opponent)}`;

  // Start with GAS entries
  for (const m of gasLog) {
    merged.set(keyOf(m), { ...m, source: 'gas' });
  }
  // Overlay Supabase entries (overwrites GAS where keys match)
  for (const m of supabaseLog) {
    merged.set(keyOf(m), m);
  }

  // Convert back, re-index chronologically
  const arr = Array.from(merged.values());
  arr.sort((a, b) => dateKey(a.date) - dateKey(b.date));
  arr.forEach((m, i) => { m.idx = i + 1; });
  return arr;
}

/**
 * Per-match player stats (for ?match=<idx>&view=players). Symmetric to
 * bobcats.fetchPlayerMatchStats but takes a Supabase match UUID.
 */
export async function fetchSupabasePlayerMatchStats(
  matchId: string,
  matchDate: string,
  opponent: string
): Promise<PlayerMatchStats | null> {
  if (!matchId) return null;
  const admin = getSupabaseAdmin();

  const { data: psRowsRaw } = await admin
    .from('match_player_stats')
    .select(`
      match_id, player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int, qb_sack,
      wr_targets, wr_rec, wr_yds, wr_td, wr_xp, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url )
    `)
    .eq('match_id', matchId);

  const psRows = (psRowsRaw ?? []) as unknown as PlayerStatsRow[];
  const { qbStats, wrStats, defenseLeaders } = aggregatePlayerStats(psRows);

  return {
    team: 'Muži',
    date: matchDate,
    opponent,
    qbStats, wrStats, defenseLeaders,
  };
}

// ─────────────────────────────────────────────────────────────────
// v6.2 — Coach stats aggregations (down dist, playbook, fauly, totals)
// ─────────────────────────────────────────────────────────────────

type PlayRow = {
  match_id: string;
  side: string | null;
  down: number | null;
  yards_gained: number | null;
  is_td: boolean | null;
  play_name: string | null;
};

type FoulRow = {
  match_id: string;
  fault_name: string;
  side: string | null;
  count: number | null;
  yards: number | null;
};

type DriveRow = {
  match_id: string;
  drive_no: number;
  side: string;        // 'OFFENSE' | 'DEFENSE' | 'SPECIAL'
  result: string;      // 'TD' | 'DOWNS' | 'INT' | 'SAFETY' | 'HALFTIME' | 'EOG' | 'TURNOVER' | 'PUNT' | 'OTHER'
  play_count: number | null;
  yds_gained: number | null;
};

function aggregateDriveResults(drives: DriveRow[]): { results: DriveResults; count: number } {
  // Aggregate from the team's (Bobcats) point of view — that means OFFENSE drives only,
  // since DriveResults shape mirrors bobcats.ts which only tracks our offensive drives.
  let td = 0, downs = 0, intc = 0, safety = 0;
  let halftime = 0, eog = 0, turnover = 0, other = 0;
  let count = 0;

  for (const d of drives) {
    if (d.side !== 'OFFENSE') continue;
    count += 1;
    switch (d.result) {
      case 'TD':       td       += 1; break;
      case 'DOWNS':    downs    += 1; break;
      case 'INT':      intc     += 1; break;
      case 'SAFETY':   safety   += 1; break;
      case 'HALFTIME': halftime += 1; break;
      case 'EOG':      eog      += 1; break;
      case 'TURNOVER': turnover += 1; break;
      case 'PUNT':     other    += 1; break;   // PUNT bucketed into "other" for GAS-parity
      default:         other    += 1;
    }
  }
  return {
    results: { td, downs, int: intc, safety, halftime, eog, turnover, other },
    count,
  };
}

function bucketYards(y: number): 'short' | 'medium' | 'long' {
  if (y >= 16) return 'long';
  if (y >= 8) return 'medium';
  return 'short';
}

function aggregateDownDist(plays: PlayRow[]): Record<string, DownBreakdown> {
  const out: Record<string, { total: number; short: number; medium: number; long: number; sumYds: number; td: number }> = {
    '1': { total: 0, short: 0, medium: 0, long: 0, sumYds: 0, td: 0 },
    '2': { total: 0, short: 0, medium: 0, long: 0, sumYds: 0, td: 0 },
    '3': { total: 0, short: 0, medium: 0, long: 0, sumYds: 0, td: 0 },
    '4': { total: 0, short: 0, medium: 0, long: 0, sumYds: 0, td: 0 },
  };
  for (const p of plays) {
    if (p.side && p.side !== 'OFFENSE') continue;
    if (p.down == null || p.down < 1 || p.down > 4) continue;
    const key = String(p.down);
    const yds = p.yards_gained ?? 0;
    out[key].total += 1;
    out[key][bucketYards(yds)] += 1;
    out[key].sumYds += yds;
    if (p.is_td) out[key].td += 1;
  }
  return out;
}

function aggregatePlaybook(plays: PlayRow[]): PlaybookAction[] {
  const map = new Map<string, { name: string; count: number; totalYds: number; td: number }>();
  for (const p of plays) {
    if (!p.play_name) continue;
    if (p.side && p.side !== 'OFFENSE') continue;
    const name = p.play_name.trim();
    if (!name) continue;
    let b = map.get(name);
    if (!b) { b = { name, count: 0, totalYds: 0, td: 0 }; map.set(name, b); }
    b.count += 1;
    b.totalYds += p.yards_gained ?? 0;
    if (p.is_td) b.td += 1;
  }
  return Array.from(map.values()).map((b) => ({
    name: b.name,
    count: b.count,
    totalYds: b.totalYds,
    avgYds: b.count > 0 ? Math.round((b.totalYds / b.count) * 10) / 10 : 0,
    td: b.td,
  })).sort((a, b) => b.count - a.count);
}

function aggregateFouls(rows: FoulRow[]): FaulType[] {
  // Group by (fault_name, side); sum count + yards across all matches.
  const map = new Map<string, { name: string; side: string; count: number; yds: number }>();
  for (const r of rows) {
    const name = r.fault_name?.trim() || 'Unknown';
    const sideRaw = (r.side ?? '').toUpperCase();
    const side = sideRaw === 'OFFENSE' ? 'Útok'
              : sideRaw === 'DEFENSE' ? 'Obrana'
              : sideRaw === 'SPECIAL' ? 'Special'
              : sideRaw === 'OTHER'   ? '—'
              : (r.side || '—');
    const key = name + '|' + side;
    let b = map.get(key);
    if (!b) { b = { name, side, count: 0, yds: 0 }; map.set(key, b); }
    b.count += r.count ?? 0;
    b.yds   += r.yards ?? 0;
  }
  return Array.from(map.values())
    .map((b) => ({ name: b.name, side: b.side, count: b.count, yds: b.yds }))
    .sort((a, b) => b.count - a.count);
}

function aggregateTotals(matches: MatchRow[]): { off: OffSnapshot; def: DefSnapshot; fauly: { count: number; yds: number } } {
  const N = matches.length;
  const sum = (k: keyof MatchRow): number => matches.reduce((s, m) => s + ((m[k] as number | null) ?? 0), 0);

  const offTd = sum('off_td');
  const offDrives = sum('off_drives');
  const qbAtt = sum('qb_att');
  const qbComp = sum('qb_comp');
  const xp1Att = sum('xp1_att');
  const xp1Ok = sum('xp1_ok');
  const xp2Att = sum('xp2_att');
  const xp2Ok = sum('xp2_ok');

  const off: OffSnapshot = {
    points: sum('our_score'),
    pointsAvg: N > 0 ? sum('our_score') / N : 0,
    rushYds: sum('rush_yds'),
    passYds: sum('pass_yds'),
    totalYds: sum('total_yds'),
    drives: offDrives,
    td: offTd,
    driveEffPct: offDrives > 0 ? offTd / offDrives : 0,
    qbAtt, qbComp,
    qbYds: sum('qb_yds'),
    qbTD:  sum('qb_td'),
    qbINT: sum('qb_int'),
    passPct: qbAtt > 0 ? qbComp / qbAtt : 0,
    xp1Att, xp1Ok,
    xp1Pct: xp1Att > 0 ? xp1Ok / xp1Att : 0,
    xp2Att, xp2Ok,
    xp2Pct: xp2Att > 0 ? xp2Ok / xp2Att : 0,
  };

  const defDrives = sum('def_drives');
  const defStops  = sum('def_stops');
  const def: DefSnapshot = {
    pointsAgainst: sum('opp_score'),
    pointsAvg: N > 0 ? sum('opp_score') / N : 0,
    drives: defDrives,
    stops: defStops,
    stopPct: defDrives > 0 ? defStops / defDrives : 0,
    rushYds: sum('opp_rush_yds'),
    passYds: sum('opp_pass_yds'),
    totalYds: sum('opp_total_yds'),
  };

  const fauly = { count: sum('pen_count'), yds: sum('pen_yds') };

  return { off, def, fauly };
}

/**
 * Full Supabase-side CoachStats aggregate. Drive results stay empty
 * (no drive tracking in match_plays schema yet). matchLog is shared
 * with fetchSupabaseStats — call both in parallel only if you need
 * matchLog twice.
 */
export type SupabaseCoachStats = CoachStats & {
  /** Marker so UI can show data source. */
  source: 'supabase';
  /** Count of matches that contributed plays — useful for "empty data" detection. */
  playMatchCount: number;
  /** Count of matches that contributed fouls. */
  foulMatchCount: number;
  /** Count of matches that contributed drives. */
  driveMatchCount: number;
};

export async function fetchSupabaseCoachStats(teamId: string | null): Promise<SupabaseCoachStats | null> {
  if (!teamId) return null;
  const admin = getSupabaseAdmin();

  // 1. matches for totals + matchLog — filtered by team_id
  const { data: matchRowsRaw } = await admin
    .from('matches')
    .select('*')
    .eq('team_id', teamId)
    .order('date', { ascending: true });
  const matchRows = (matchRowsRaw ?? []) as MatchRow[];
  if (matchRows.length === 0) return null;

  const matchIds = matchRows.map((m) => m.id);

  // 2. plays + fouls + drives in parallel
  const [playsRes, foulsRes, drivesRes] = await Promise.all([
    admin
      .from('match_plays')
      .select('match_id, side, down, yards_gained, is_td, play_name')
      .in('match_id', matchIds),
    admin
      .from('match_fouls')
      .select('match_id, fault_name, side, count, yards')
      .in('match_id', matchIds),
    admin
      .from('match_drives')
      .select('match_id, drive_no, side, result, play_count, yds_gained')
      .in('match_id', matchIds),
  ]);
  const plays  = (playsRes.data  ?? []) as PlayRow[];
  const fouls  = (foulsRes.data  ?? []) as FoulRow[];
  const drives = (drivesRes.data ?? []) as DriveRow[];

  // 3. aggregate
  const downDist       = aggregateDownDist(plays);
  const playbookAkce   = aggregatePlaybook(plays);
  const faulyBreakdown = aggregateFouls(fouls);
  const { off, def, fauly } = aggregateTotals(matchRows);
  const { results: driveResults, count: driveCount } = aggregateDriveResults(drives);

  const playMatchIds  = new Set(plays.map((p)  => p.match_id));
  const foulMatchIds  = new Set(fouls.map((f)  => f.match_id));
  const driveMatchIds = new Set(drives.map((d) => d.match_id));

  // matchLog from same rows we already have
  const matchLog = matchRows.map((row, i) => rowToMatchLogEntry(row, i + 1));

  return {
    source: 'supabase',
    driveCount,
    driveResults,
    endPositions: [],
    faulyBreakdown,
    matchCount: matchRows.length,
    matchLog,
    totals: {
      matches: matchRows.length,
      off, def, fauly,
      downDist,
      playbookAkce,
    },
    playMatchCount:  playMatchIds.size,
    foulMatchCount:  foulMatchIds.size,
    driveMatchCount: driveMatchIds.size,
  };
}

// ── Aliased imports for stats.astro convenience ──────────────────
export type { Match };
