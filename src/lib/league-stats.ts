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

  // Iter 35: zahrnout i shared matches (kde je opp_team_id v lize)
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, date, opponent, our_score, opp_score, team_id, opp_team_id, teams!matches_team_id_fkey(name, logo_url, club_id, clubs(name, logo_url)), opp_team:teams!matches_opp_team_id_fkey(name, logo_url, club_id, clubs(name, logo_url))')
    .or(orFilter)
    .order('date', { ascending: false })
    .limit(limit);

  const teamIdSet = new Set(teamIds);
  return ((matchesRaw ?? []) as any[]).map((m) => {
    const homeInLeague = teamIdSet.has(m.team_id);
    const oppInLeague = m.opp_team_id && teamIdSet.has(m.opp_team_id);
    const showAsOpp = !homeInLeague && oppInLeague;
    const ours = showAsOpp ? m.opp_score : m.our_score;
    const theirs = showAsOpp ? m.our_score : m.opp_score;
    const myTeam = showAsOpp ? m.opp_team : m.teams;
    const oppLabel = showAsOpp
      ? (m.teams?.clubs?.name ? `${m.teams.clubs.name}${m.teams?.name ? ' ' + m.teams.name : ''}` : (m.teams?.name || m.opponent || '—'))
      : m.opponent;
    return {
      id: m.id,
      date: m.date,
      opponent: oppLabel,
      ourScore: ours,
      oppScore: theirs,
      result: ours > theirs ? 'W' : ours < theirs ? 'L' : 'T',
      teamId: showAsOpp ? m.opp_team_id : m.team_id,
      teamName: myTeam?.name ?? '—',
      clubName: myTeam?.clubs?.name ?? '—',
      // Iter 43: prefer team.logo_url
      clubLogoUrl: myTeam?.logo_url ?? myTeam?.clubs?.logo_url ?? null,
    };
  }) as LeagueMatchRow[];
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
    .select('team_id, teams(id, name, primary_color, logo_url, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const ltRows = (ltRowsRaw ?? []) as any[];
  if (ltRows.length === 0) return [];

  const teamIds = ltRows.map((r) => r.team_id);
  const teamIdSet = new Set(teamIds);

  // 2. Iter 35: matches kde alespoň jedna strana (home NEBO opp) je v lize.
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('team_id, opp_team_id, date, our_score, opp_score')
    .or(orFilter)
    .order('date', { ascending: true });
  const matches = (matchesRaw ?? []) as {
    team_id: string;
    opp_team_id: string | null;
    date: string;
    our_score: number;
    opp_score: number;
  }[];

  // 3. Aggregate per team
  const byTeam = new Map<string, StandingsRow>();
  for (const r of ltRows) {
    const t = r.teams ?? {};
    const c = t.clubs ?? {};
    byTeam.set(r.team_id, {
      teamId: r.team_id,
      teamName: t.name ?? '—',
      clubName: c.name ?? '—',
      // Iter 43: prefer team.logo_url (per-tým branding), fallback club.logo_url
      clubLogoUrl: t.logo_url ?? c.logo_url ?? null,
      primaryColor: t.primary_color ?? '#0F1B2D',
      played: 0, wins: 0, losses: 0, ties: 0,
      ptsFor: 0, ptsAgainst: 0, ptsDiff: 0,
      winPct: 0, lastResult: null,
    });
  }

  for (const m of matches) {
    // Home perspektiva
    if (teamIdSet.has(m.team_id)) {
      const row = byTeam.get(m.team_id);
      if (row) {
        row.played += 1;
        row.ptsFor += m.our_score;
        row.ptsAgainst += m.opp_score;
        if (m.our_score > m.opp_score)      { row.wins += 1; row.lastResult = 'W'; }
        else if (m.our_score < m.opp_score) { row.losses += 1; row.lastResult = 'L'; }
        else                                 { row.ties += 1; row.lastResult = 'T'; }
      }
    }
    // Iter 35: opp perspektiva — shared match v lize
    if (m.opp_team_id && teamIdSet.has(m.opp_team_id)) {
      const row = byTeam.get(m.opp_team_id);
      if (row) {
        row.played += 1;
        row.ptsFor += m.opp_score;
        row.ptsAgainst += m.our_score;
        if (m.opp_score > m.our_score)      { row.wins += 1; row.lastResult = 'W'; }
        else if (m.opp_score < m.our_score) { row.losses += 1; row.lastResult = 'L'; }
        else                                 { row.ties += 1; row.lastResult = 'T'; }
      }
    }
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
  // Iter 44: team brand pro mini logo + barvy
  teamLogoUrl: string | null;
  primaryColor: string;
  // Iter 48: počet zápasů (distinct match_id v match_player_stats per hráč)
  gamesPlayed: number;
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

  // Step 1: approved team_ids — Iter 44: + branding
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(name, primary_color, logo_url, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const lt = (ltRaw ?? []) as any[];
  if (lt.length === 0) return { qb: [], wr: [], db: [] };
  const teamIds = lt.map((r) => r.team_id);

  // Iter 44: Map team_id → team/club display metadata + branding
  const teamMeta = new Map<string, { teamName: string; clubName: string; teamLogoUrl: string | null; primaryColor: string }>();
  for (const r of lt) {
    teamMeta.set(r.team_id, {
      teamName: r.teams?.name ?? '—',
      clubName: r.teams?.clubs?.name ?? '—',
      teamLogoUrl: r.teams?.logo_url ?? r.teams?.clubs?.logo_url ?? null,
      primaryColor: r.teams?.primary_color ?? '#0F1B2D',
    });
  }

  // Step 2: Iter 35 — matches incl. shared (alespoň jedna strana v lize)
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, team_id, opp_team_id')
    .or(orFilter);
  const matches = (matchesRaw ?? []) as { id: string; team_id: string; opp_team_id: string | null }[];
  if (matches.length === 0) return { qb: [], wr: [], db: [] };
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

  // Step 4: Iter 35 — attribute per player.team_id; jen hráče jejichž tým je v lize
  const teamIdSet = new Set(teamIds);
  const buckets = new Map<string, LeaderRow>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    const playerTeamId = p.team_id;
    if (!playerTeamId || !teamIdSet.has(playerTeamId)) continue;
    const meta = teamMeta.get(playerTeamId);

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
        teamLogoUrl: meta?.teamLogoUrl ?? null,
        primaryColor: meta?.primaryColor ?? '#0F1B2D',
        gamesPlayed: 0,
        qbAtt: 0, qbComp: 0, qbYds: 0, qbTd: 0, qbInt: 0,
        wrTargets: 0, wrRec: 0, wrYds: 0, wrTd: 0, wrPts: 0,
        dbFlagPull: 0, dbSack: 0, dbInt: 0, dbBrkup: 0,
      };
      buckets.set(id, b);
    }
    // Iter 48: počet distinct match_id per hráč
    b.gamesPlayed += 1;  // každý ps row = jeden match × jeden hráč; unique constraint match_player_stats(match_id, player_id)
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

// ── Iter 9b: All players (no limit) for public liga page ──────

export async function fetchLeagueAllPlayers(leagueId: string): Promise<{
  qb: LeaderRow[]; wr: LeaderRow[]; db: LeaderRow[];
}> {
  if (!leagueId) return { qb: [], wr: [], db: [] };
  const admin = getSupabaseAdmin();

  // Iter 44: + branding
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(name, primary_color, logo_url, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const lt = (ltRaw ?? []) as any[];
  if (lt.length === 0) return { qb: [], wr: [], db: [] };
  const teamIds = lt.map((r) => r.team_id);

  const teamMeta = new Map<string, { teamName: string; clubName: string; teamLogoUrl: string | null; primaryColor: string }>();
  for (const r of lt) {
    teamMeta.set(r.team_id, {
      teamName: r.teams?.name ?? '—',
      clubName: r.teams?.clubs?.name ?? '—',
      teamLogoUrl: r.teams?.logo_url ?? r.teams?.clubs?.logo_url ?? null,
      primaryColor: r.teams?.primary_color ?? '#0F1B2D',
    });
  }

  // Iter 35: shared matches incl.
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, team_id, opp_team_id')
    .or(orFilter);
  const matches = (matchesRaw ?? []) as { id: string; team_id: string; opp_team_id: string | null }[];
  if (matches.length === 0) return { qb: [], wr: [], db: [] };
  const matchIds = matches.map((m) => m.id);

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

  const teamIdSet = new Set(teamIds);
  const buckets = new Map<string, LeaderRow>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    const playerTeamId = p.team_id;
    if (!playerTeamId || !teamIdSet.has(playerTeamId)) continue;
    const meta = teamMeta.get(playerTeamId);
    let b = buckets.get(id);
    if (!b) {
      b = {
        playerId: id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—',
        jersey: p.jersey_number ?? null,
        photoUrl: p.photo_url ?? null,
        teamName: meta?.teamName ?? '—',
        clubName: meta?.clubName ?? '—',
        teamLogoUrl: meta?.teamLogoUrl ?? null,
        primaryColor: meta?.primaryColor ?? '#0F1B2D',
        gamesPlayed: 0,
        qbAtt: 0, qbComp: 0, qbYds: 0, qbTd: 0, qbInt: 0,
        wrTargets: 0, wrRec: 0, wrYds: 0, wrTd: 0, wrPts: 0,
        dbFlagPull: 0, dbSack: 0, dbInt: 0, dbBrkup: 0,
      };
      buckets.set(id, b);
    }
    // Iter 48: distinct match per hráč
    b.gamesPlayed += 1;
    b.qbAtt += r.qb_att ?? 0; b.qbComp += r.qb_comp ?? 0; b.qbYds += r.qb_yds ?? 0;
    b.qbTd  += r.qb_td  ?? 0; b.qbInt  += r.qb_int  ?? 0;
    b.wrTargets += r.wr_targets ?? 0; b.wrRec += r.wr_rec ?? 0;
    b.wrYds += r.wr_yds ?? 0; b.wrTd += r.wr_td ?? 0; b.wrPts += r.wr_pts ?? 0;
    b.dbFlagPull += r.db_flag_pull ?? 0; b.dbSack += r.db_sack ?? 0;
    b.dbInt += r.db_int ?? 0; b.dbBrkup += r.db_brkup ?? 0;
  }
  const all = Array.from(buckets.values());
  const qb = all.filter((b) => b.qbAtt > 0).sort((a, b) => b.qbTd - a.qbTd || b.qbYds - a.qbYds);
  const wr = all.filter((b) => b.wrTargets > 0 || b.wrTd > 0).sort((a, b) => b.wrTd - a.wrTd || b.wrPts - a.wrPts);
  const db = all.filter((b) => b.dbFlagPull > 0 || b.dbSack > 0 || b.dbInt > 0 || b.dbBrkup > 0)
    .sort((a, b) => (b.dbInt * 3 + b.dbSack * 2 + b.dbFlagPull) - (a.dbInt * 3 + a.dbSack * 2 + a.dbFlagPull));
  return { qb, wr, db };
}

// ── Iter 9b: Detailed team stats for public liga page (7 sections) ──

export type TeamStatsRow = {
  teamId: string;
  teamName: string;
  clubName: string;
  clubLogoUrl: string | null;
  primaryColor: string;
  // Scoring
  games: number;
  offTd: number;
  xp1Ok: number;
  xp1Att: number;
  xp2Ok: number;
  xp2Att: number;
  pointsFor: number;
  pointsForAvg: number;
  // Scoring defense — what we have today
  pointsAgainst: number;
  pointsAgainstAvg: number;
  // Pass offense
  qbAtt: number;
  qbComp: number;
  qbInt: number;
  qbYds: number;
  qbTd: number;
  passEfficiency: number;  // NCAA-style
  // Pass defense (limited — we only have opp_pass_yds + our def's INT/Sack)
  oppPassYds: number;
  oppPassYdsAvg: number;
  defInts: number;
  defSacks: number;
  // Penalties
  penCount: number;
  penYds: number;
};

// NCAA-style passing efficiency:
// (8.4 * yds + 330 * td + 100 * comp - 200 * int) / att
function passEff(att: number, comp: number, yds: number, td: number, int: number): number {
  if (att === 0) return 0;
  return Math.round(((8.4 * yds) + (330 * td) + (100 * comp) - (200 * int)) / att);
}

export async function fetchLeagueTeamStats(leagueId: string): Promise<TeamStatsRow[]> {
  if (!leagueId) return [];
  const admin = getSupabaseAdmin();

  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(id, name, primary_color, logo_url, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const ltRows = (ltRaw ?? []) as any[];
  if (ltRows.length === 0) return [];

  const teamIds = ltRows.map((r) => r.team_id);
  const teamIdSet = new Set(teamIds);

  // Iter 36+39: matches kde alespoň jedna strana v lize + opp_* agregáty pro shared
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select(`
      id, team_id, opp_team_id,
      our_score, opp_score,
      off_td, opp_off_td,
      qb_att, qb_comp, qb_td, qb_int, qb_yds,
      xp1_att, xp1_ok, xp2_att, xp2_ok,
      opp_xp1_att, opp_xp1_ok, opp_xp2_att, opp_xp2_ok,
      opp_pass_yds,
      pen_count, pen_yds, opp_pen_count, opp_pen_yds
    `)
    .or(orFilter);
  const matches = (matchesRaw ?? []) as any[];

  // Iter 36: QB + Def stats per player.team_id z match_player_stats — funguje pro home i opp
  const matchIds = matches.map((m) => m.id);
  const { data: psRaw } = matchIds.length > 0
    ? await admin
        .from('match_player_stats')
        .select('match_id, qb_att, qb_comp, qb_yds, qb_td, qb_int, db_int, db_sack, players(team_id)')
        .in('match_id', matchIds)
    : { data: [] as any[] };
  const psRows = (psRaw ?? []) as any[];
  const qbAggByTeam = new Map<string, { att: number; comp: number; yds: number; td: number; int: number }>();
  const defAggByTeam = new Map<string, { ints: number; sacks: number }>();
  for (const r of psRows) {
    const pt = r.players?.team_id;
    if (!pt || !teamIdSet.has(pt)) continue;
    let qb = qbAggByTeam.get(pt);
    if (!qb) { qb = { att: 0, comp: 0, yds: 0, td: 0, int: 0 }; qbAggByTeam.set(pt, qb); }
    qb.att  += r.qb_att  ?? 0;
    qb.comp += r.qb_comp ?? 0;
    qb.yds  += r.qb_yds  ?? 0;
    qb.td   += r.qb_td   ?? 0;
    qb.int  += r.qb_int  ?? 0;
    let d = defAggByTeam.get(pt);
    if (!d) { d = { ints: 0, sacks: 0 }; defAggByTeam.set(pt, d); }
    d.ints  += r.db_int  ?? 0;
    d.sacks += r.db_sack ?? 0;
  }

  // Aggregate per team
  const byTeam = new Map<string, TeamStatsRow>();
  for (const r of ltRows) {
    const t = r.teams ?? {};
    const c = t.clubs ?? {};
    byTeam.set(r.team_id, {
      teamId: r.team_id,
      teamName: t.name ?? '—',
      clubName: c.name ?? '—',
      // Iter 43: prefer team.logo_url
      clubLogoUrl: t.logo_url ?? c.logo_url ?? null,
      primaryColor: t.primary_color ?? '#0F1B2D',
      games: 0, offTd: 0, xp1Ok: 0, xp1Att: 0, xp2Ok: 0, xp2Att: 0,
      pointsFor: 0, pointsForAvg: 0,
      pointsAgainst: 0, pointsAgainstAvg: 0,
      qbAtt: 0, qbComp: 0, qbInt: 0, qbYds: 0, qbTd: 0, passEfficiency: 0,
      oppPassYds: 0, oppPassYdsAvg: 0,
      defInts: 0, defSacks: 0,
      penCount: 0, penYds: 0,
    });
  }

  for (const m of matches) {
    // Home perspektiva
    if (teamIdSet.has(m.team_id)) {
      const row = byTeam.get(m.team_id);
      if (row) {
        row.games += 1;
        row.offTd += m.off_td ?? 0;
        row.xp1Ok += m.xp1_ok ?? 0; row.xp1Att += m.xp1_att ?? 0;
        row.xp2Ok += m.xp2_ok ?? 0; row.xp2Att += m.xp2_att ?? 0;
        row.pointsFor += m.our_score ?? 0;
        row.pointsAgainst += m.opp_score ?? 0;
        row.oppPassYds += m.opp_pass_yds ?? 0;
        row.penCount += m.pen_count ?? 0;
        row.penYds += m.pen_yds ?? 0;
      }
    }
    // Iter 36+39: opp perspektiva — shared match v lize (s opp_* agregáty)
    if (m.opp_team_id && teamIdSet.has(m.opp_team_id)) {
      const row = byTeam.get(m.opp_team_id);
      if (row) {
        row.games += 1;
        row.offTd += m.opp_off_td ?? 0;
        row.xp1Ok += m.opp_xp1_ok ?? 0; row.xp1Att += m.opp_xp1_att ?? 0;
        row.xp2Ok += m.opp_xp2_ok ?? 0; row.xp2Att += m.opp_xp2_att ?? 0;
        row.pointsFor += m.opp_score ?? 0;
        row.pointsAgainst += m.our_score ?? 0;
        row.penCount += m.opp_pen_count ?? 0;
        row.penYds += m.opp_pen_yds ?? 0;
      }
    }
  }

  // Iter 36: QB stats + def INT/Sack z player_stats per team_id
  for (const row of byTeam.values()) {
    const qb = qbAggByTeam.get(row.teamId);
    if (qb) {
      row.qbAtt = qb.att; row.qbComp = qb.comp;
      row.qbYds = qb.yds; row.qbTd = qb.td; row.qbInt = qb.int;
    }
    if (row.games > 0) {
      row.pointsForAvg     = +(row.pointsFor     / row.games).toFixed(1);
      row.pointsAgainstAvg = +(row.pointsAgainst / row.games).toFixed(1);
      row.oppPassYdsAvg    = +(row.oppPassYds    / row.games).toFixed(1);
    }
    row.passEfficiency = passEff(row.qbAtt, row.qbComp, row.qbYds, row.qbTd, row.qbInt);
    const def = defAggByTeam.get(row.teamId);
    if (def) { row.defInts = def.ints; row.defSacks = def.sacks; }
  }

  return Array.from(byTeam.values());
}

// ── Iter 9c: Liga records (single-season + single-game) ──────────

export type RecordEntry = {
  category: string;
  value: number;
  formattedValue?: string;
  playerName?: string;
  jersey?: number | null;
  photoUrl?: string | null;
  teamName: string;
  clubName: string;
  matchContext?: string;  // "vs Lions · 12.5.2026" pro single-game
  season: string;
};

export type LeagueRecords = {
  season: string;
  // Player single-season totals
  playerSeason: {
    qb: RecordEntry[];
    wr: RecordEntry[];
    db: RecordEntry[];
  };
  // Player single-game peaks
  playerGame: {
    qb: RecordEntry[];
    wr: RecordEntry[];
    db: RecordEntry[];
  };
  // Team single-season totals + records
  teamSeason: RecordEntry[];
  // Team single-game peaks
  teamGame: RecordEntry[];
};

export async function fetchLeagueRecords(leagueId: string, season = '2026'): Promise<LeagueRecords> {
  const empty: LeagueRecords = {
    season,
    playerSeason: { qb: [], wr: [], db: [] },
    playerGame:   { qb: [], wr: [], db: [] },
    teamSeason: [],
    teamGame: [],
  };
  if (!leagueId) return empty;
  const admin = getSupabaseAdmin();

  // Approved teams + metadata
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id, teams(id, name, club_id, clubs(name, logo_url))')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const lt = (ltRaw ?? []) as any[];
  if (lt.length === 0) return empty;
  const teamIds = lt.map((r) => r.team_id);
  const teamMeta = new Map<string, { teamName: string; clubName: string }>();
  for (const r of lt) {
    teamMeta.set(r.team_id, { teamName: r.teams?.name ?? '—', clubName: r.teams?.clubs?.name ?? '—' });
  }

  // Iter 37+39: shared matches incl. + opp_* aggregates
  const teamIdSet = new Set(teamIds);
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select(`
      id, team_id, opp_team_id, date, opponent,
      our_score, opp_score, off_td, opp_off_td,
      rush_yds, pass_yds, total_yds,
      qb_att, qb_comp, qb_td, qb_int, qb_yds,
      def_drives, def_stops,
      pen_count, pen_yds, opp_pen_count, opp_pen_yds,
      teams!matches_team_id_fkey(name, club_id, clubs(name)),
      opp_team:teams!matches_opp_team_id_fkey(name, club_id, clubs(name))
    `)
    .or(orFilter);
  const matches = (matchesRaw ?? []) as any[];
  if (matches.length === 0) return empty;

  const matchById = new Map<string, any>();
  for (const m of matches) matchById.set(m.id, m);
  const matchIds = matches.map((m) => m.id);

  // Iter 37: + players.team_id; attribute per player team
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

  const formatDate = (s: string) => new Date(s).toLocaleDateString('cs-CZ');
  const matchCtxFor = (match: any, perspectiveTeamId: string) => {
    if (match.team_id === perspectiveTeamId) return `vs ${match.opponent} · ${formatDate(match.date)}`;
    const oppLabel = match.teams?.clubs?.name
      ? `${match.teams.clubs.name}${match.teams?.name ? ' ' + match.teams.name : ''}`
      : (match.teams?.name || match.opponent || '—');
    return `vs ${oppLabel} · ${formatDate(match.date)}`;
  };
  const matchCtx = (match: any) => `vs ${match.opponent} · ${formatDate(match.date)}`;

  // ── Player season totals — Iter 37: per player.team_id ──
  type PlayerAgg = {
    playerId: string; playerName: string; jersey: number | null; photoUrl: string | null;
    teamName: string; clubName: string;
    qbAtt: number; qbComp: number; qbYds: number; qbTd: number; qbInt: number;
    wrTargets: number; wrRec: number; wrYds: number; wrTd: number; wrPts: number;
    dbFlagPull: number; dbSack: number; dbInt: number; dbBrkup: number;
  };
  const playerAgg = new Map<string, PlayerAgg>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    const playerTeamId = p.team_id;
    if (!playerTeamId || !teamIdSet.has(playerTeamId)) continue;
    const m = matchById.get(r.match_id);
    if (!m) continue;
    const meta = teamMeta.get(playerTeamId) ?? { teamName: '—', clubName: '—' };
    let b = playerAgg.get(id);
    if (!b) {
      b = {
        playerId: id,
        playerName: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—',
        jersey: p.jersey_number ?? null,
        photoUrl: p.photo_url ?? null,
        teamName: meta.teamName, clubName: meta.clubName,
        qbAtt: 0, qbComp: 0, qbYds: 0, qbTd: 0, qbInt: 0,
        wrTargets: 0, wrRec: 0, wrYds: 0, wrTd: 0, wrPts: 0,
        dbFlagPull: 0, dbSack: 0, dbInt: 0, dbBrkup: 0,
      };
      playerAgg.set(id, b);
    }
    b.qbAtt += r.qb_att ?? 0; b.qbComp += r.qb_comp ?? 0; b.qbYds += r.qb_yds ?? 0;
    b.qbTd  += r.qb_td  ?? 0; b.qbInt  += r.qb_int  ?? 0;
    b.wrTargets += r.wr_targets ?? 0; b.wrRec += r.wr_rec ?? 0;
    b.wrYds += r.wr_yds ?? 0; b.wrTd += r.wr_td ?? 0; b.wrPts += r.wr_pts ?? 0;
    b.dbFlagPull += r.db_flag_pull ?? 0; b.dbSack += r.db_sack ?? 0;
    b.dbInt += r.db_int ?? 0; b.dbBrkup += r.db_brkup ?? 0;
  }
  const players = Array.from(playerAgg.values());

  // Helper: top entry by field
  const topPlayer = (
    field: keyof PlayerAgg,
    category: string,
    formatter?: (v: number) => string,
  ): RecordEntry | null => {
    const sorted = players.filter((p) => (p[field] as number) > 0).sort((a, b) => (b[field] as number) - (a[field] as number));
    if (sorted.length === 0) return null;
    const top = sorted[0];
    return {
      category, value: top[field] as number,
      formattedValue: formatter ? formatter(top[field] as number) : undefined,
      playerName: top.playerName, jersey: top.jersey, photoUrl: top.photoUrl,
      teamName: top.teamName, clubName: top.clubName, season,
    };
  };

  const playerSeasonQb = [
    topPlayer('qbTd',  'Nejvíc TD pasů za sezónu'),
    topPlayer('qbYds', 'Nejvíc yardů za sezónu (QB)'),
    topPlayer('qbComp','Nejvíc kompletních pasů za sezónu'),
  ].filter((x): x is RecordEntry => x !== null);

  const playerSeasonWr = [
    topPlayer('wrTd',  'Nejvíc TD chytů za sezónu'),
    topPlayer('wrYds', 'Nejvíc receivingových yardů za sezónu'),
    topPlayer('wrRec', 'Nejvíc receptionů za sezónu'),
    topPlayer('wrPts', 'Nejvíc bodů (WR) za sezónu'),
  ].filter((x): x is RecordEntry => x !== null);

  const playerSeasonDb = [
    topPlayer('dbInt',     'Nejvíc INT chycených za sezónu'),
    topPlayer('dbSack',    'Nejvíc sacků za sezónu'),
    topPlayer('dbFlagPull','Nejvíc flag pulls za sezónu'),
    topPlayer('dbBrkup',   'Nejvíc breakupů za sezónu'),
  ].filter((x): x is RecordEntry => x !== null);

  // ── Player single-game peaks ──
  // Each match_player_stats row IS a single-game stat. Find max per category.
  const topGameStat = (
    field: string,
    category: string,
  ): RecordEntry | null => {
    const candidates = psRows
      .map((r) => ({
        value: (r[field] as number) ?? 0,
        playerId: r.player_id,
        player: r.players ?? {},
        match: matchById.get(r.match_id),
      }))
      .filter((c) => c.value > 0 && c.match);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.value - a.value);
    const top = candidates[0];
    // Iter 37: attribute per player.team_id
    const ptid = top.player.team_id;
    if (!ptid || !teamIdSet.has(ptid)) return null;
    const meta = teamMeta.get(ptid) ?? { teamName: '—', clubName: '—' };
    return {
      category, value: top.value,
      playerName: `${top.player.first_name ?? ''} ${top.player.last_name ?? ''}`.trim() || '—',
      jersey: top.player.jersey_number ?? null,
      photoUrl: top.player.photo_url ?? null,
      teamName: meta.teamName, clubName: meta.clubName,
      matchContext: matchCtxFor(top.match, ptid), season,
    };
  };

  const playerGameQb = [
    topGameStat('qb_td',  'Nejvíc TD pasů v zápase'),
    topGameStat('qb_yds', 'Nejvíc passing yardů v zápase'),
    topGameStat('qb_comp','Nejvíc kompletních pasů v zápase'),
  ].filter((x): x is RecordEntry => x !== null);

  const playerGameWr = [
    topGameStat('wr_td',  'Nejvíc TD chytů v zápase'),
    topGameStat('wr_yds', 'Nejvíc receivingových yardů v zápase'),
    topGameStat('wr_rec', 'Nejvíc receptionů v zápase'),
  ].filter((x): x is RecordEntry => x !== null);

  const playerGameDb = [
    topGameStat('db_int',      'Nejvíc INT v zápase'),
    topGameStat('db_sack',     'Nejvíc sacků v zápase'),
    topGameStat('db_flag_pull','Nejvíc flag pulls v zápase'),
  ].filter((x): x is RecordEntry => x !== null);

  // ── Team season aggregates ──
  type TeamAgg = {
    teamId: string; teamName: string; clubName: string;
    games: number; pointsFor: number; pointsAgainst: number;
    totalYds: number; offTd: number; penCount: number; penYds: number;
    wins: number; losses: number; ties: number;
    defInts: number; defSacks: number;
  };
  const teamAgg = new Map<string, TeamAgg>();
  for (const teamId of teamIds) {
    const meta = teamMeta.get(teamId) ?? { teamName: '—', clubName: '—' };
    teamAgg.set(teamId, {
      teamId, teamName: meta.teamName, clubName: meta.clubName,
      games: 0, pointsFor: 0, pointsAgainst: 0,
      totalYds: 0, offTd: 0, penCount: 0, penYds: 0,
      wins: 0, losses: 0, ties: 0, defInts: 0, defSacks: 0,
    });
  }
  for (const m of matches) {
    // Home perspektiva
    if (teamIdSet.has(m.team_id)) {
      const ta = teamAgg.get(m.team_id);
      if (ta) {
        ta.games += 1;
        ta.pointsFor += m.our_score ?? 0;
        ta.pointsAgainst += m.opp_score ?? 0;
        ta.totalYds += m.total_yds ?? 0;
        ta.offTd += m.off_td ?? 0;
        ta.penCount += m.pen_count ?? 0;
        ta.penYds += m.pen_yds ?? 0;
        if      (m.our_score >  m.opp_score) ta.wins   += 1;
        else if (m.our_score <  m.opp_score) ta.losses += 1;
        else                                  ta.ties   += 1;
      }
    }
    // Iter 37+39: opp perspektiva
    if (m.opp_team_id && teamIdSet.has(m.opp_team_id)) {
      const ta = teamAgg.get(m.opp_team_id);
      if (ta) {
        ta.games += 1;
        ta.pointsFor += m.opp_score ?? 0;
        ta.pointsAgainst += m.our_score ?? 0;
        ta.offTd += m.opp_off_td ?? 0;
        ta.penCount += m.opp_pen_count ?? 0;
        ta.penYds += m.opp_pen_yds ?? 0;
        if      (m.opp_score >  m.our_score) ta.wins   += 1;
        else if (m.opp_score <  m.our_score) ta.losses += 1;
        else                                  ta.ties   += 1;
      }
    }
  }
  // Defense aggregates per player.team_id
  for (const r of psRows) {
    const pt = r.players?.team_id;
    if (!pt || !teamIdSet.has(pt)) continue;
    const ta = teamAgg.get(pt);
    if (!ta) continue;
    ta.defInts  += r.db_int  ?? 0;
    ta.defSacks += r.db_sack ?? 0;
  }
  const teams = Array.from(teamAgg.values());

  const topTeam = (
    field: keyof TeamAgg,
    category: string,
    formatter?: (v: number) => string,
  ): RecordEntry | null => {
    const sorted = teams.filter((t) => (t[field] as number) > 0).sort((a, b) => (b[field] as number) - (a[field] as number));
    if (sorted.length === 0) return null;
    const top = sorted[0];
    return {
      category, value: top[field] as number,
      formattedValue: formatter ? formatter(top[field] as number) : undefined,
      teamName: top.teamName, clubName: top.clubName, season,
    };
  };

  // Computed: best win percentage (only teams with games > 0)
  const topWinPct = (): RecordEntry | null => {
    const sorted = teams.filter((t) => t.games > 0).map((t) => ({
      ...t, winPct: t.wins / t.games,
    })).sort((a, b) => b.winPct - a.winPct);
    if (sorted.length === 0) return null;
    const top = sorted[0];
    return {
      category: 'Nejlepší Win % za sezónu',
      value: Math.round(top.winPct * 100),
      formattedValue: `${Math.round(top.winPct * 100)}%`,
      teamName: top.teamName, clubName: top.clubName, season,
      matchContext: `${top.wins}-${top.losses}${top.ties ? `-${top.ties}` : ''} (${top.games} zápasů)`,
    };
  };

  const teamSeason = [
    topTeam('pointsFor',   'Nejvíc bodů skórovaných za sezónu'),
    topTeam('totalYds',    'Nejvíc yardů (offense) za sezónu'),
    topTeam('offTd',       'Nejvíc TD (offense) za sezónu'),
    topTeam('defInts',     'Nejvíc INT chycených týmem za sezónu'),
    topTeam('defSacks',    'Nejvíc sacků týmem za sezónu'),
    topWinPct(),
  ].filter((x): x is RecordEntry => x !== null);

  // ── Team single-game peaks — Iter 37: dual perspective ──
  type MatchPerspective = { m: any; teamId: string; ourScore: number; oppScore: number; isHomePerspective: boolean };
  const perspectives: MatchPerspective[] = [];
  for (const m of matches) {
    if (teamIdSet.has(m.team_id)) {
      perspectives.push({ m, teamId: m.team_id, ourScore: m.our_score ?? 0, oppScore: m.opp_score ?? 0, isHomePerspective: true });
    }
    if (m.opp_team_id && teamIdSet.has(m.opp_team_id)) {
      perspectives.push({ m, teamId: m.opp_team_id, ourScore: m.opp_score ?? 0, oppScore: m.our_score ?? 0, isHomePerspective: false });
    }
  }

  const topMatchStat = (
    field: string,
    category: string,
    extract?: (m: any) => number,
    oppField?: string,  // Iter 39: pole pro opp perspective
  ): RecordEntry | null => {
    const candidates = perspectives.map((pv) => {
      let value: number;
      if (extract) value = extract(pv.m);
      else if (pv.isHomePerspective) value = (pv.m[field] as number) ?? 0;
      else if (oppField) value = (pv.m[oppField] as number) ?? 0;
      else value = 0;
      return { m: pv.m, teamId: pv.teamId, value };
    }).filter((c) => c.value > 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.value - a.value);
    const top = candidates[0];
    const meta = teamMeta.get(top.teamId) ?? { teamName: '—', clubName: '—' };
    return {
      category, value: top.value,
      teamName: meta.teamName, clubName: meta.clubName,
      matchContext: matchCtxFor(top.m, top.teamId), season,
    };
  };

  const topPointsFor = (): RecordEntry | null => {
    const candidates = perspectives.map((pv) => ({ m: pv.m, teamId: pv.teamId, value: pv.ourScore })).filter((c) => c.value > 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.value - a.value);
    const top = candidates[0];
    const meta = teamMeta.get(top.teamId) ?? { teamName: '—', clubName: '—' };
    return {
      category: 'Nejvíc bodů skórovaných v zápase',
      value: top.value,
      teamName: meta.teamName, clubName: meta.clubName,
      matchContext: matchCtxFor(top.m, top.teamId), season,
    };
  };

  const topMargin = (): RecordEntry | null => {
    const candidates = perspectives
      .map((pv) => ({ m: pv.m, teamId: pv.teamId, value: pv.ourScore - pv.oppScore, ourScore: pv.ourScore, oppScore: pv.oppScore }))
      .filter((c) => c.value > 0);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.value - a.value);
    const top = candidates[0];
    const meta = teamMeta.get(top.teamId) ?? { teamName: '—', clubName: '—' };
    const isHome = top.m.team_id === top.teamId;
    const oppLabel = isHome
      ? top.m.opponent
      : (top.m.teams?.clubs?.name ? `${top.m.teams.clubs.name}${top.m.teams?.name ? ' ' + top.m.teams.name : ''}` : (top.m.teams?.name || top.m.opponent || '—'));
    return {
      category: 'Nejvyšší rozdíl skóre v zápase',
      value: top.value,
      formattedValue: `+${top.value}`,
      teamName: meta.teamName, clubName: meta.clubName,
      matchContext: `${top.ourScore}–${top.oppScore} vs ${oppLabel} · ${formatDate(top.m.date)}`,
      season,
    };
  };

  const teamGame = [
    topPointsFor(),
    topMatchStat('total_yds', 'Nejvíc total yardů v zápase'),
    topMatchStat('off_td',    'Nejvíc TD v zápase', undefined, 'opp_off_td'),
    topMargin(),
  ].filter((x): x is RecordEntry => x !== null);

  return {
    season,
    playerSeason: { qb: playerSeasonQb, wr: playerSeasonWr, db: playerSeasonDb },
    playerGame:   { qb: playerGameQb,   wr: playerGameWr,   db: playerGameDb },
    teamSeason, teamGame,
  };
}

// ── Iter 9d+e: Manual records (season + career) from league_records table ──

export type RecordType = 'season' | 'career';

export type ManualRecord = {
  id: string;
  recordType: RecordType;
  category: string;
  playerName: string;
  jersey: number | null;
  teamName: string | null;
  clubName: string | null;
  photoUrl: string | null;
  value: number;
  seasonRange: string | null;
  notes: string | null;
};

// Category slugs (suffix-free) shared by season + career
export const RECORD_CATEGORY_LABELS: Record<string, string> = {
  qb_td:        'TD pasy',
  qb_yds:       'Yardy (QB)',
  qb_comp:      'Kompletní pasy',
  wr_td:        'TD chyty',
  wr_yds:       'Receivingové yardy',
  wr_rec:       'Recepce',
  wr_pts:       'Body (WR)',
  db_int:       'INT chycené',
  db_sack:      'Sacky',
  db_flag_pull: 'Flag pulls',
  db_brkup:     'Breakupy',
  team_points:  'Body skórované (tým)',
  team_wins:    'Výhry (tým)',
  team_yds:     'Total yardy (tým)',
  team_td:      'TD (tým)',
};
export const RECORD_CATEGORIES = Object.keys(RECORD_CATEGORY_LABELS);

export const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  season: 'Sezónní',
  career: 'Kariérní',
};

/**
 * Fetch manual records, optionally filtered by record_type.
 */
export async function fetchLeagueManualRecords(
  leagueId: string,
  type?: RecordType,
): Promise<ManualRecord[]> {
  if (!leagueId) return [];
  const admin = getSupabaseAdmin();
  let q = admin
    .from('league_records')
    .select('id, record_type, category, player_name, jersey, team_name, club_name, photo_url, value, season_range, notes')
    .eq('league_id', leagueId)
    .order('category', { ascending: true })
    .order('value', { ascending: false });
  if (type) q = q.eq('record_type', type);
  const { data } = await q;

  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    recordType: (r.record_type as RecordType) ?? 'career',
    category: r.category,
    playerName: r.player_name,
    jersey: r.jersey,
    teamName: r.team_name,
    clubName: r.club_name,
    photoUrl: r.photo_url,
    value: r.value,
    seasonRange: r.season_range,
    notes: r.notes,
  }));
}

// ── Backwards-compat aliases (will be removed once all consumers migrate) ──
export type CareerRecord = ManualRecord;
export const CAREER_CATEGORY_LABELS = RECORD_CATEGORY_LABELS;
export const CAREER_CATEGORIES = RECORD_CATEGORIES;
export async function fetchLeagueCareerRecords(leagueId: string): Promise<ManualRecord[]> {
  return fetchLeagueManualRecords(leagueId, 'career');
}

// ── Iter 10: Zápasy záložka + match detail ─────────────────────

export type LeagueMatchListRow = {
  id: string;
  date: string;
  opponent: string;           // textový fallback (Scorer free-text nebo strukturované jméno)
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
  teamId: string;
  teamName: string;
  clubName: string;
  clubLogoUrl: string | null;
  primaryColor: string;
  // Iter 45: strukturované opp údaje (pokud opp je tým v GameStatiq systému)
  opponentTeamId: string | null;
  opponentTeamName: string | null;
  opponentClubName: string | null;
  opponentLogoUrl: string | null;
  opponentPrimaryColor: string | null;
};

/**
 * All matches across approved league teams, no limit. Sorted by date DESC.
 */
export async function fetchLeagueMatches(leagueId: string): Promise<LeagueMatchListRow[]> {
  if (!leagueId) return [];
  const admin = getSupabaseAdmin();

  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const teamIds = ((ltRaw ?? []) as { team_id: string }[]).map((r) => r.team_id);
  if (teamIds.length === 0) return [];

  // Iter 37: shared matches incl.
  const orFilter = `team_id.in.(${teamIds.join(',')}),opp_team_id.in.(${teamIds.join(',')})`;
  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, date, opponent, our_score, opp_score, team_id, opp_team_id, teams!matches_team_id_fkey(name, primary_color, logo_url, club_id, clubs(name, logo_url)), opp_team:teams!matches_opp_team_id_fkey(name, primary_color, logo_url, club_id, clubs(name, logo_url))')
    .or(orFilter)
    .order('date', { ascending: false });

  const teamIdSet = new Set(teamIds);
  const out: LeagueMatchListRow[] = [];
  for (const m of (matchesRaw ?? []) as any[]) {
    const homeInLeague = teamIdSet.has(m.team_id);
    const oppInLeague  = m.opp_team_id && teamIdSet.has(m.opp_team_id);
    if (homeInLeague) {
      // Iter 45: structured opp data pokud opp je v systému
      const hasOppTeam = !!m.opp_team_id && !!m.opp_team;
      out.push({
        id: m.id,
        date: m.date,
        opponent: m.opponent,
        ourScore: m.our_score,
        oppScore: m.opp_score,
        result: m.our_score > m.opp_score ? 'W' : m.our_score < m.opp_score ? 'L' : 'T',
        teamId: m.team_id,
        teamName: m.teams?.name ?? '—',
        clubName: m.teams?.clubs?.name ?? '—',
        clubLogoUrl: m.teams?.logo_url ?? m.teams?.clubs?.logo_url ?? null,
        primaryColor: m.teams?.primary_color ?? '#0F1B2D',
        opponentTeamId:   hasOppTeam ? m.opp_team_id : null,
        opponentTeamName: hasOppTeam ? (m.opp_team?.name ?? null) : null,
        opponentClubName: hasOppTeam ? (m.opp_team?.clubs?.name ?? null) : null,
        opponentLogoUrl:  hasOppTeam ? (m.opp_team?.logo_url ?? m.opp_team?.clubs?.logo_url ?? null) : null,
        opponentPrimaryColor: hasOppTeam ? (m.opp_team?.primary_color ?? null) : null,
      });
    }
    if (oppInLeague) {
      // Iter 45: opp perspective — soupeř je home tým (m.teams)
      const oppLabel = m.teams?.clubs?.name
        ? `${m.teams.clubs.name}${m.teams?.name ? ' ' + m.teams.name : ''}`
        : (m.teams?.name || m.opponent || '—');
      out.push({
        id: m.id,
        date: m.date,
        opponent: oppLabel,
        ourScore: m.opp_score,
        oppScore: m.our_score,
        result: m.opp_score > m.our_score ? 'W' : m.opp_score < m.our_score ? 'L' : 'T',
        teamId: m.opp_team_id,
        teamName: m.opp_team?.name ?? '—',
        clubName: m.opp_team?.clubs?.name ?? '—',
        clubLogoUrl: m.opp_team?.logo_url ?? m.opp_team?.clubs?.logo_url ?? null,
        primaryColor: m.opp_team?.primary_color ?? '#0F1B2D',
        opponentTeamId:   m.team_id,
        opponentTeamName: m.teams?.name ?? null,
        opponentClubName: m.teams?.clubs?.name ?? null,
        opponentLogoUrl:  m.teams?.logo_url ?? m.teams?.clubs?.logo_url ?? null,
        opponentPrimaryColor: m.teams?.primary_color ?? null,
      });
    }
  }
  return out;
}

export type MatchPlayerStat = {
  playerId: string;
  name: string;
  jersey: number | null;
  photoUrl: string | null;
  position: string | null;
  qbAtt: number; qbComp: number; qbYds: number; qbTd: number; qbInt: number; qbSack: number;
  wrTargets: number; wrRec: number; wrYds: number; wrTd: number; wrPts: number;
  dbFlagPull: number; dbSack: number; dbInt: number; dbBrkup: number;
};

export type MatchDetail = {
  id: string;
  date: string;
  opponent: string;
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
  team: {
    id: string;
    name: string;
    clubName: string;
    clubLogoUrl: string | null;
    primaryColor: string;
  };
  league: { id: string; name: string; slug: string } | null;
  // Team-level stats
  offTd: number;
  xp1Ok: number; xp1Att: number; xp2Ok: number; xp2Att: number;
  qbAtt: number; qbComp: number; qbYds: number; qbTd: number; qbInt: number;
  rushYds: number; passYds: number; totalYds: number;
  oppPassYds: number;
  defDrives: number; defStops: number;
  penCount: number; penYds: number;
  passEfficiency: number;
  players: MatchPlayerStat[];
};

/**
 * Single match with all team-level + player-level stats. League-aware:
 * only returns if the match's team belongs to an approved league_teams row.
 */
export async function fetchMatchDetail(matchId: string, leagueId: string): Promise<MatchDetail | null> {
  if (!matchId || !leagueId) return null;
  const admin = getSupabaseAdmin();

  // Approved teams in this league (whitelist)
  const { data: ltRaw } = await admin
    .from('league_teams')
    .select('team_id')
    .eq('league_id', leagueId)
    .not('approved_at', 'is', null);
  const allowedTeams = new Set(((ltRaw ?? []) as { team_id: string }[]).map((r) => r.team_id));
  if (allowedTeams.size === 0) return null;

  const { data: m } = await admin
    .from('matches')
    .select(`
      id, team_id, opp_team_id, date, opponent,
      our_score, opp_score, off_td,
      xp1_att, xp1_ok, xp2_att, xp2_ok,
      qb_att, qb_comp, qb_td, qb_int, qb_yds,
      rush_yds, pass_yds, total_yds,
      opp_pass_yds,
      def_drives, def_stops,
      pen_count, pen_yds,
      teams!matches_team_id_fkey(id, name, primary_color, logo_url, club_id, clubs(name, logo_url)),
      opp_team:teams!matches_opp_team_id_fkey(id, name, primary_color, logo_url, club_id, clubs(name, logo_url))
    `)
    .eq('id', matchId)
    .maybeSingle();

  if (!m) return null;
  const match = m as any;
  // Iter 37: dostupný pokud home tým NEBO opp tým v lize
  const homeInLeague = allowedTeams.has(match.team_id);
  const oppInLeague  = match.opp_team_id && allowedTeams.has(match.opp_team_id);
  if (!homeInLeague && !oppInLeague) return null;

  // League metadata (resolved later by caller; supplied as null here)
  const team = match.teams ?? {};
  const club = team.clubs ?? {};

  // Player stats
  const { data: psRaw } = await admin
    .from('match_player_stats')
    .select(`
      player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int, qb_sack,
      wr_targets, wr_rec, wr_yds, wr_td, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url, position )
    `)
    .eq('match_id', matchId);

  const players: MatchPlayerStat[] = ((psRaw ?? []) as any[]).map((r) => {
    const p = r.players ?? {};
    return {
      playerId: r.player_id,
      name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—',
      jersey: p.jersey_number ?? null,
      photoUrl: p.photo_url ?? null,
      position: p.position ?? null,
      qbAtt: r.qb_att ?? 0, qbComp: r.qb_comp ?? 0, qbYds: r.qb_yds ?? 0,
      qbTd: r.qb_td ?? 0, qbInt: r.qb_int ?? 0, qbSack: r.qb_sack ?? 0,
      wrTargets: r.wr_targets ?? 0, wrRec: r.wr_rec ?? 0, wrYds: r.wr_yds ?? 0,
      wrTd: r.wr_td ?? 0, wrPts: r.wr_pts ?? 0,
      dbFlagPull: r.db_flag_pull ?? 0, dbSack: r.db_sack ?? 0,
      dbInt: r.db_int ?? 0, dbBrkup: r.db_brkup ?? 0,
    };
  });

  // NCAA passing efficiency
  const att = match.qb_att ?? 0;
  const eff = att > 0
    ? Math.round(((8.4 * (match.qb_yds ?? 0)) + (330 * (match.qb_td ?? 0)) + (100 * (match.qb_comp ?? 0)) - (200 * (match.qb_int ?? 0))) / att)
    : 0;

  return {
    id: match.id,
    date: match.date,
    opponent: match.opponent,
    ourScore: match.our_score ?? 0,
    oppScore: match.opp_score ?? 0,
    result: (match.our_score ?? 0) > (match.opp_score ?? 0) ? 'W' : (match.our_score ?? 0) < (match.opp_score ?? 0) ? 'L' : 'T',
    team: {
      id: team.id ?? match.team_id,
      name: team.name ?? '—',
      clubName: club.name ?? '—',
      clubLogoUrl: club.logo_url ?? null,
      primaryColor: team.primary_color ?? '#0F1B2D',
    },
    league: null,
    offTd: match.off_td ?? 0,
    xp1Ok: match.xp1_ok ?? 0, xp1Att: match.xp1_att ?? 0,
    xp2Ok: match.xp2_ok ?? 0, xp2Att: match.xp2_att ?? 0,
    qbAtt: att, qbComp: match.qb_comp ?? 0, qbYds: match.qb_yds ?? 0,
    qbTd: match.qb_td ?? 0, qbInt: match.qb_int ?? 0,
    rushYds: match.rush_yds ?? 0, passYds: match.pass_yds ?? 0, totalYds: match.total_yds ?? 0,
    oppPassYds: match.opp_pass_yds ?? 0,
    defDrives: match.def_drives ?? 0, defStops: match.def_stops ?? 0,
    penCount: match.pen_count ?? 0, penYds: match.pen_yds ?? 0,
    passEfficiency: eff,
    players,
  };
}
