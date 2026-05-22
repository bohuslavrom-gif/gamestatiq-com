// League master view aggregations — standings + cross-club leaderboards.
// Reads from matches + match_player_stats, scoped by league_teams.team_id
// (approved members only, no pending invitations).
//
// Iter 6.

import { getSupabaseAdmin } from './supabase';

// ── Recent matches across all league teams ────────────────────

export type LeagueMatchRow = {
  id: string;
  date: string;
  opponent: string;
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
  teamId: string;
  teamName: string;
  clubName: string;
  clubLogoUrl: string | null;
};

export async function fetchLeagueRecentMatches(leagueId: string, limit = 10): Promise<LeagueMatchRow[]> {
  if (!leagueId) return [];
  const admin = getSupabaseAdmin();

  // Approved teams in this league
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const teamIds = ((ltRaw ?? []) as { team_id: string }[]).map((r) => r.team_id);
  if (teamIds.length === 0) return [];

  // Latest matches across those teams
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, date, opponent, our_score, opp_score, team_id, teams(name, club_id, clubs(name, logo_url))')
    .in('team_id', teamIds)
    .order('date', { ascending: false })
    .limit(limit);

  return ((matchesRaw ?? []) as any[]).map((m) => ({
    id: m.id,
    date: m.date,
    opponent: m.opponent,
    ourScore: m.our_score,
    oppScore: m.opp_score,
    result: m.our_score > m.opp_score ? 'W' : m.our_score < m.opp_score ? 'L' : 'T',
    teamId: m.team_id,
    teamName: m.teams?.name ?? '—',
    clubName: m.teams?.clubs?.name ?? '—',
    clubLogoUrl: m.teams?.clubs?.logo_url ?? null,
  })) as LeagueMatchRow[];
}

// ── Standings ────────────────────────────────────────────────────

export type StandingsRow = {
  teamId: string;
  teamName: string;
  clubName: string;
  clubLogoUrl: string | null;
  primaryColor: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  ptsFor: number;
  ptsAgainst: number;
  ptsDiff: number;
  winPct: number;        // 0–100
  lastResult: 'W' | 'L' | 'T' | null;
};

export async function fetchLeagueStandings(leagueId: string): Promise<StandingsRow[]> {
  if (!leagueId) return [];
  const admin = getSupabaseAdmin();

  // 1. Approved league_teams join with teams + clubs (for display metadata)
  const { data: ltRowsRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(id, name, primary_color, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const ltRows = (ltRowsRaw ?? []) as any[];
  if (ltRows.length === 0) return [];

  const teamIds = ltRows.map((r) => r.team_id);

  // 2. All matches for those teams, ordered chronologically
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('team_id, date, our_score, opp_score')
    .in('team_id', teamIds)
    .order('date', { ascending: true });
  const matches = (matchesRaw ?? []) as { team_id: string; date: string; our_score: number; opp_score: number }[];

  // 3. Aggregate per team
  const byTeam = new Map<string, StandingsRow>();
  for (const r of ltRows) {
    const t = r.teams ?? {};
    const c = t.clubs ?? {};
    byTeam.set(r.team_id, {
      teamId: r.team_id,
      teamName: t.name ?? '—',
      clubName: c.name ?? '—',
      clubLogoUrl: c.logo_url ?? null,
      primaryColor: t.primary_color ?? '#0F1B2D',
      played: 0, wins: 0, losses: 0, ties: 0,
      ptsFor: 0, ptsAgainst: 0, ptsDiff: 0,
      winPct: 0, lastResult: null,
    });
  }

  for (const m of matches) {
    const row = byTeam.get(m.team_id);
    if (!row) continue;
    row.played += 1;
    row.ptsFor += m.our_score;
    row.ptsAgainst += m.opp_score;
    if (m.our_score > m.opp_score)      { row.wins += 1; row.lastResult = 'W'; }
    else if (m.our_score < m.opp_score) { row.losses += 1; row.lastResult = 'L'; }
    else                                 { row.ties += 1; row.lastResult = 'T'; }
  }

  for (const row of byTeam.values()) {
    row.ptsDiff = row.ptsFor - row.ptsAgainst;
    row.winPct = row.played > 0 ? Math.round((row.wins / row.played) * 100) : 0;
  }

  // 4. Sort: by win pct desc, then by ptsDiff desc, then by ptsFor desc
  return Array.from(byTeam.values()).sort((a, b) => {
    if (b.winPct !== a.winPct)   return b.winPct - a.winPct;
    if (b.ptsDiff !== a.ptsDiff) return b.ptsDiff - a.ptsDiff;
    if (b.ptsFor !== a.ptsFor)   return b.ptsFor - a.ptsFor;
    return a.teamName.localeCompare(b.teamName, 'cs');
  });
}

// ── Cross-club leaderboards ──────────────────────────────────────

export type LeaderRow = {
  playerId: string;
  name: string;
  jersey: number | null;
  photoUrl: string | null;
  teamName: string;
  clubName: string;
  // QB
  qbAtt: number; qbComp: number; qbYds: number; qbTd: number; qbInt: number;
  // WR
  wrTargets: number; wrRec: number; wrYds: number; wrTd: number; wrPts: number;
  // DB
  dbFlagPull: number; dbSack: number; dbInt: number; dbBrkup: number;
};

export async function fetchLeagueLeaders(leagueId: string): Promise<{
  qb: LeaderRow[]; wr: LeaderRow[]; db: LeaderRow[];
}> {
  if (!leagueId) return { qb: [], wr: [], db: [] };
  const admin = getSupabaseAdmin();

  // Step 1: approved team_ids
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(name, club_id, clubs(name))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const lt = (ltRaw ?? []) as any[];
  if (lt.length === 0) return { qb: [], wr: [], db: [] };
  const teamIds = lt.map((r) => r.team_id);

  // Map team_id → team/club display metadata
  const teamMeta = new Map<string, { teamName: string; clubName: string }>();
  for (const r of lt) {
    teamMeta.set(r.team_id, {
      teamName: r.teams?.name ?? '—',
      clubName: r.teams?.clubs?.name ?? '—',
    });
  }

  // Step 2: matches for those teams (just need ids to filter match_player_stats)
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, team_id')
    .in('team_id', teamIds);
  const matches = (matchesRaw ?? []) as { id: string; team_id: string }[];
  if (matches.length === 0) return { qb: [], wr: [], db: [] };

  // Map match_id → team_id (so we can attribute a player's stat to the team that earned it)
  const matchToTeam = new Map<string, string>();
  for (const m of matches) matchToTeam.set(m.id, m.team_id);
  const matchIds = matches.map((m) => m.id);

  // Step 3: all match_player_stats for those matches + player metadata
  const { data: psRaw } = await admin
    .from('match_player_stats')
    .select(`
      match_id, player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int,
      wr_targets, wr_rec, wr_yds, wr_td, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url, team_id )
    `)
    .in('match_id', matchIds);
  const psRows = (psRaw ?? []) as any[];

  // Step 4: aggregate per player
  const buckets = new Map<string, LeaderRow>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    // Team attribution: use the team that played the match (matchToTeam),
    // not p.team_id (player could have been on a different roster at the time).
    const playMatchTeam = matchToTeam.get(r.match_id);
    if (!playMatchTeam) continue;
    const meta = teamMeta.get(playMatchTeam);

    let b = buckets.get(id);
    if (!b) {
      const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—';
      b = {
        playerId: id,
        name: fullName,
        jersey: p.jersey_number ?? null,
        photoUrl: p.photo_url ?? null,
        teamName: meta?.teamName ?? '—',
        clubName: meta?.clubName ?? '—',
        qbAtt: 0, qbComp: 0, qbYds: 0, qbTd: 0, qbInt: 0,
        wrTargets: 0, wrRec: 0, wrYds: 0, wrTd: 0, wrPts: 0,
        dbFlagPull: 0, dbSack: 0, dbInt: 0, dbBrkup: 0,
      };
      buckets.set(id, b);
    }
    b.qbAtt += r.qb_att ?? 0;
    b.qbComp += r.qb_comp ?? 0;
    b.qbYds += r.qb_yds ?? 0;
    b.qbTd += r.qb_td ?? 0;
    b.qbInt += r.qb_int ?? 0;
    b.wrTargets += r.wr_targets ?? 0;
    b.wrRec += r.wr_rec ?? 0;
    b.wrYds += r.wr_yds ?? 0;
    b.wrTd += r.wr_td ?? 0;
    b.wrPts += r.wr_pts ?? 0;
    b.dbFlagPull += r.db_flag_pull ?? 0;
    b.dbSack += r.db_sack ?? 0;
    b.dbInt += r.db_int ?? 0;
    b.dbBrkup += r.db_brkup ?? 0;
  }

  const all = Array.from(buckets.values());

  // Filter + sort per position
  const qb = all.filter((b) => b.qbAtt > 0).sort((a, b) => b.qbTd - a.qbTd || b.qbYds - a.qbYds).slice(0, 10);
  const wr = all.filter((b) => b.wrTargets > 0 || b.wrTd > 0).sort((a, b) => b.wrTd - a.wrTd || b.wrPts - a.wrPts).slice(0, 10);
  const db = all.filter((b) => b.dbFlagPull > 0 || b.dbSack > 0 || b.dbInt > 0 || b.dbBrkup > 0)
    .sort((a, b) => (b.dbInt * 3 + b.dbSack * 2 + b.dbFlagPull) - (a.dbInt * 3 + a.dbSack * 2 + a.dbFlagPull))
    .slice(0, 10);

  return { qb, wr, db };
}
