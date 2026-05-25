// Club public page data loader
// gamestatiq.com/klub/{slug} → club info + per-team stats
// Iter 14.

import { getSupabaseAdmin } from './supabase';
import { fetchSupabaseStats } from './supabase-stats';

export type ClubInfo = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
};

export type ClubTeam = {
  id: string;
  name: string;
  sport: string | null;
};

export type ClubPublicShell = {
  club: ClubInfo;
  teams: ClubTeam[];
};

/**
 * Fetch club metadata + list of all teams (regardless of league status).
 * Returns null if no club matches the slug.
 */
export async function fetchClubBySlug(slug: string): Promise<ClubPublicShell | null> {
  if (!slug) return null;
  const admin = getSupabaseAdmin();

  const { data: club } = await admin
    .from('clubs')
    .select('id, name, slug, logo_url, primary_color, secondary_color')
    .eq('slug', slug)
    .maybeSingle();
  if (!club) return null;

  const { data: teamsRaw } = await admin
    .from('teams')
    .select('id, name, sport')
    .eq('club_id', (club as any).id)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });

  const teams = ((teamsRaw ?? []) as any[]).map((t) => ({
    id: t.id,
    name: t.name,
    sport: t.sport ?? null,
  }));

  return {
    club: {
      id: (club as any).id,
      name: (club as any).name,
      slug: (club as any).slug,
      logoUrl: (club as any).logo_url ?? null,
      primaryColor: (club as any).primary_color ?? '#DC1F26',
      secondaryColor: (club as any).secondary_color ?? null,
    },
    teams,
  };
}

// ── Per-team aggregated public stats ─────────────────────────────

export type ClubMatchSummary = {
  id: string;
  date: string;
  opponent: string;
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
};

export type QbRow = {
  playerId: string;
  name: string;
  jersey: number | string | null;
  photoUrl: string | null;
  att: number; comp: number; td: number; int: number; yds: number;
};

export type WrRow = {
  playerId: string;
  name: string;
  jersey: number | string | null;
  photoUrl: string | null;
  td: number; targets: number; rec: number; yds: number; pts: number;
};

export type DbRow = {
  playerId: string;
  name: string;
  jersey: number | string | null;
  photoUrl: string | null;
  flagPull: number; sack: number; brkup: number; int: number;
};

export type TdsByPlayer = {
  name: string;
  td: number;
};

export type ClubTeamStats = {
  team: ClubTeam;
  record: { wins: number; losses: number; ties: number; matches: number };
  points: { for: number; against: number; forAvg: number; againstAvg: number };
  qbStats: QbRow[];
  wrStats: WrRow[];
  defenseLeaders: DbRow[];
  tdsByPlayer: TdsByPlayer[];
  recentMatches: ClubMatchSummary[];
};

/**
 * Aggregate season stats for one team. Reads matches + match_player_stats.
 */
export async function fetchClubTeamStats(team: ClubTeam): Promise<ClubTeamStats> {
  const empty: ClubTeamStats = {
    team,
    record: { wins: 0, losses: 0, ties: 0, matches: 0 },
    points: { for: 0, against: 0, forAvg: 0, againstAvg: 0 },
    qbStats: [], wrStats: [], defenseLeaders: [],
    tdsByPlayer: [], recentMatches: [],
  };

  const admin = getSupabaseAdmin();

  const { data: matchesRaw } = await admin
    .from('matches')
    .select('id, date, opponent, our_score, opp_score')
    .eq('team_id', team.id)
    .order('date', { ascending: false });
  const matches = (matchesRaw ?? []) as any[];
  if (matches.length === 0) return empty;

  // Record + points
  let wins = 0, losses = 0, ties = 0, ptsFor = 0, ptsAgainst = 0;
  for (const m of matches) {
    ptsFor += m.our_score ?? 0;
    ptsAgainst += m.opp_score ?? 0;
    if (m.our_score > m.opp_score) wins++;
    else if (m.our_score < m.opp_score) losses++;
    else ties++;
  }

  // Player stats aggregated across all matches
  const matchIds = matches.map((m) => m.id);
  const { data: psRaw } = await admin
    .from('match_player_stats')
    .select(`
      match_id, player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int,
      wr_targets, wr_rec, wr_yds, wr_td, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url )
    `)
    .in('match_id', matchIds);
  const psRows = (psRaw ?? []) as any[];

  type Bucket = {
    playerId: string;
    name: string;
    jersey: number | string | null;
    photoUrl: string | null;
    qb: { att: number; comp: number; yds: number; td: number; int: number };
    wr: { targets: number; rec: number; yds: number; td: number; pts: number };
    db: { flagPull: number; sack: number; brkup: number; int: number };
  };
  const buckets = new Map<string, Bucket>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    let b = buckets.get(id);
    if (!b) {
      const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—';
      b = {
        playerId: id,
        name: fullName,
        jersey: p.jersey_number ?? null,
        photoUrl: p.photo_url ?? null,
        qb: { att: 0, comp: 0, yds: 0, td: 0, int: 0 },
        wr: { targets: 0, rec: 0, yds: 0, td: 0, pts: 0 },
        db: { flagPull: 0, sack: 0, brkup: 0, int: 0 },
      };
      buckets.set(id, b);
    }
    b.qb.att  += r.qb_att  ?? 0; b.qb.comp += r.qb_comp ?? 0;
    b.qb.yds  += r.qb_yds  ?? 0; b.qb.td   += r.qb_td   ?? 0;
    b.qb.int  += r.qb_int  ?? 0;
    b.wr.targets += r.wr_targets ?? 0; b.wr.rec += r.wr_rec ?? 0;
    b.wr.yds += r.wr_yds ?? 0; b.wr.td += r.wr_td ?? 0;
    b.wr.pts += r.wr_pts ?? 0;
    b.db.flagPull += r.db_flag_pull ?? 0; b.db.sack += r.db_sack ?? 0;
    b.db.brkup += r.db_brkup ?? 0; b.db.int += r.db_int ?? 0;
  }
  const all = Array.from(buckets.values());

  const qbStats: QbRow[] = all
    .filter((b) => b.qb.att > 0)
    .map((b) => ({
      playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
      att: b.qb.att, comp: b.qb.comp, td: b.qb.td, int: b.qb.int, yds: b.qb.yds,
    }))
    .sort((a, b) => b.td - a.td || b.yds - a.yds);

  const wrStats: WrRow[] = all
    .filter((b) => b.wr.targets > 0 || b.wr.td > 0)
    .map((b) => ({
      playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
      td: b.wr.td, targets: b.wr.targets, rec: b.wr.rec, yds: b.wr.yds, pts: b.wr.pts,
    }))
    .sort((a, b) => b.td - a.td || b.pts - a.pts);

  const defenseLeaders: DbRow[] = all
    .filter((b) => b.db.flagPull > 0 || b.db.sack > 0 || b.db.int > 0 || b.db.brkup > 0)
    .map((b) => ({
      playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
      flagPull: b.db.flagPull, sack: b.db.sack, brkup: b.db.brkup, int: b.db.int,
    }))
    .sort((a, b) => (b.int * 3 + b.sack * 2 + b.flagPull) - (a.int * 3 + a.sack * 2 + a.flagPull));

  // TDs by player (combined QB + WR TDs for chart)
  const tdsByPlayer: TdsByPlayer[] = all
    .map((b) => ({ name: b.name, td: b.qb.td + b.wr.td }))
    .filter((b) => b.td > 0)
    .sort((a, b) => b.td - a.td)
    .slice(0, 10);

  // Recent matches (latest 5)
  const recentMatches: ClubMatchSummary[] = matches.slice(0, 5).map((m) => ({
    id: m.id,
    date: m.date,
    opponent: m.opponent,
    ourScore: m.our_score,
    oppScore: m.opp_score,
    result: m.our_score > m.opp_score ? 'W' : m.our_score < m.opp_score ? 'L' : 'T',
  }));

  return {
    team,
    record: { wins, losses, ties, matches: matches.length },
    points: {
      for: ptsFor,
      against: ptsAgainst,
      forAvg: matches.length > 0 ? +(ptsFor / matches.length).toFixed(1) : 0,
      againstAvg: matches.length > 0 ? +(ptsAgainst / matches.length).toFixed(1) : 0,
    },
    qbStats, wrStats, defenseLeaders, tdsByPlayer, recentMatches,
  };
}

// ── Iter 25: Match list + per-match head-to-head ─────────────────

export type ClubMatchLite = {
  id: string;
  date: string;
  opponent: string;
  ourScore: number;
  oppScore: number;
  result: 'W' | 'L' | 'T';
};

/**
 * List všech zápasů týmu (jen základní info pro selektor).
 * Sortováno DESC (nejnovější první).
 */
export async function fetchClubMatchList(teamId: string): Promise<ClubMatchLite[]> {
  if (!teamId) return [];
  const admin = getSupabaseAdmin();

  // Iter 38: zápasy kde tým je home NEBO opp_team_id (shared match v lize)
  const { data } = await admin
    .from('matches')
    .select('id, date, opponent, our_score, opp_score, team_id, opp_team_id, teams(name, club_id, clubs(name))')
    .or(`team_id.eq.${teamId},opp_team_id.eq.${teamId}`)
    .order('date', { ascending: false });

  return ((data ?? []) as any[]).map((m) => {
    const isOpp = m.opp_team_id === teamId;
    const ours  = isOpp ? (m.opp_score ?? 0) : (m.our_score ?? 0);
    const theirs = isOpp ? (m.our_score ?? 0) : (m.opp_score ?? 0);
    const oppLabel = isOpp
      ? (m.teams?.clubs?.name ? `${m.teams.clubs.name}${m.teams?.name ? ' ' + m.teams.name : ''}` : (m.teams?.name || m.opponent || '—'))
      : m.opponent;
    return {
      id: m.id,
      date: m.date,
      opponent: oppLabel,
      ourScore: ours,
      oppScore: theirs,
      result: (ours > theirs ? 'W' : ours < theirs ? 'L' : 'T') as 'W'|'L'|'T',
    };
  });
}

export type HeadToHeadMetric = {
  label: string;
  /** Numeric value used for bar width (e.g. percent for ratios, raw for counts) */
  our: number;
  opp: number;
  /** Optional override display label (e.g. "5/8") — uses `our`/`opp` if not set */
  ourDisplay?: string;
  oppDisplay?: string;
  /** Optional formatter for default display */
  format?: 'int' | 'yards' | 'percent';
  /** Higher value is better for us — drives color highlight */
  higherIsBetter?: boolean;
};

export type MatchHeadToHead = {
  id: string;
  date: string;
  opponent: string;
  result: 'W' | 'L' | 'T';

  ourScore: number;
  oppScore: number;

  // Team / club info
  ourTeamName: string;
  ourClubName: string;
  ourLogoUrl: string | null;
  primaryColor: string;

  // Iter 26: opp brand color (opponents table > clubs table > default black)
  oppColor: string;
  // Iter 27: opp logo URL (if registered in opponents or clubs table)
  oppLogoUrl: string | null;

  // Aggregated metrics for the diverging bar viz
  metrics: HeadToHeadMetric[];

  // Per-player breakdown for this match (3 sortable tables)
  qbStats: QbRow[];
  wrStats: WrRow[];
  defenseLeaders: DbRow[];
};

/**
 * Fetch detailed head-to-head data for a single match.
 * Verifies the match belongs to the given team_id (security).
 */
export async function fetchClubMatchHeadToHead(
  matchId: string,
  teamId: string,
  ourTeamName: string,
  ourClubName: string,
  ourLogoUrl: string | null,
  primaryColor: string,
): Promise<MatchHeadToHead | null> {
  if (!matchId || !teamId) return null;
  const admin = getSupabaseAdmin();

  const { data: m } = await admin
    .from('matches')
    .select(`
      id, team_id, opp_team_id, date, opponent,
      our_score, opp_score,
      rush_yds, pass_yds, total_yds,
      opp_rush_yds, opp_pass_yds, opp_total_yds,
      off_td, off_drives, opp_off_td, opp_off_drives,
      qb_att, qb_comp, qb_td, qb_int, qb_yds,
      xp1_att, xp1_ok, xp2_att, xp2_ok,
      opp_xp1_att, opp_xp1_ok, opp_xp2_att, opp_xp2_ok,
      def_drives, def_stops,
      pen_count, pen_yds, opp_pen_count, opp_pen_yds,
      teams(name, club_id, clubs(name))
    `)
    .eq('id', matchId)
    .maybeSingle();
  if (!m) return null;
  const match = m as any;
  // Iter 38: match dostupný pokud team_id NEBO opp_team_id = teamId
  const isOppPerspective = match.opp_team_id === teamId;
  if (match.team_id !== teamId && !isOppPerspective) return null;

  // Iter 38: v opp perspektivě se naše/jejich pole prohazují.
  const ourScore = isOppPerspective ? (match.opp_score ?? 0) : (match.our_score ?? 0);
  const oppScore = isOppPerspective ? (match.our_score ?? 0) : (match.opp_score ?? 0);

  // Iter 38: XP konverze — v opp perspective se naše vs jejich prohazují
  const oppXp1Ok  = isOppPerspective ? (match.xp1_ok  ?? 0) : (match.opp_xp1_ok ?? 0);
  const oppXp2Ok  = isOppPerspective ? (match.xp2_ok  ?? 0) : (match.opp_xp2_ok ?? 0);
  const oppXp1Att = isOppPerspective ? (match.xp1_att ?? 0) : (match.opp_xp1_att ?? 0);
  const oppXp2Att = isOppPerspective ? (match.xp2_att ?? 0) : (match.opp_xp2_att ?? 0);
  const oppTd = Math.max(0, Math.floor((oppScore - oppXp1Ok - 2 * oppXp2Ok) / 6));

  // Iter 27: lookup opponent's brand color + logo
  // Priority: 1) opponents table (per-club registry), 2) clubs table (if opponent is GameStatiq user), 3) defaults
  let oppColor = '#1A1A1A';
  let oppLogoUrl: string | null = null;
  // Iter 38: v opp perspective je "soupeř" původní home tým — použijeme jeho jméno
  const opponentName = isOppPerspective
    ? (match.teams?.clubs?.name ? `${match.teams.clubs.name}${match.teams?.name ? ' ' + match.teams.name : ''}` : (match.teams?.name || match.opponent || ''))
    : match.opponent;
  if (opponentName) {
    const oppName = String(opponentName).trim();

    // First check this club's opponent registry
    const ourClubIdQuery = await admin
      .from('teams')
      .select('club_id')
      .eq('id', teamId)
      .maybeSingle();
    const ourClubId = (ourClubIdQuery.data as { club_id: string } | null)?.club_id ?? null;

    if (ourClubId) {
      const { data: registered } = await admin
        .from('opponents')
        .select('primary_color, logo_url')
        .eq('club_id', ourClubId)
        .ilike('name', oppName)
        .maybeSingle();
      if (registered) {
        if ((registered as any).primary_color) oppColor = (registered as any).primary_color;
        if ((registered as any).logo_url) oppLogoUrl = (registered as any).logo_url;
      }
    }

    // Fallback: maybe opponent is a club in our system (Bobcats vs Vienna both have GameStatiq accounts)
    if (oppColor === '#1A1A1A' && !oppLogoUrl) {
      const { data: oppClub } = await admin
        .from('clubs')
        .select('primary_color, logo_url')
        .ilike('name', oppName)
        .maybeSingle();
      if (oppClub) {
        if ((oppClub as any).primary_color) oppColor = (oppClub as any).primary_color;
        if ((oppClub as any).logo_url) oppLogoUrl = (oppClub as any).logo_url;
      }
    }
  }

  // Iter 26+39: helpers for ratio metrics — value used for bar width = percent (0-100)
  // Iter 39: pokud máme opp_off_td v DB (Scorer Iter 39+), použijeme; jinak fallback dopočet.
  const offTd = isOppPerspective
    ? (match.opp_off_td ?? Math.max(0, Math.floor((ourScore - (match.opp_xp1_ok ?? 0) - 2 * (match.opp_xp2_ok ?? 0)) / 6)))
    : (match.off_td ?? 0);
  const offDrives = isOppPerspective ? (match.opp_off_drives ?? match.def_drives ?? 0) : (match.off_drives ?? 0);
  const defDrives = isOppPerspective ? (match.off_drives ?? 0) : (match.def_drives ?? 0);
  const xp1Ok  = isOppPerspective ? (match.opp_xp1_ok  ?? 0) : (match.xp1_ok  ?? 0);
  const xp1Att = isOppPerspective ? (match.opp_xp1_att ?? 0) : (match.xp1_att ?? 0);
  const xp2Ok  = isOppPerspective ? (match.opp_xp2_ok  ?? 0) : (match.xp2_ok  ?? 0);
  const xp2Att = isOppPerspective ? (match.opp_xp2_att ?? 0) : (match.xp2_att ?? 0);

  const pct = (ok: number, att: number) => att > 0 ? Math.round((ok / att) * 100) : 0;
  const ratio = (ok: number, att: number) => `${ok}/${att}${att > 0 ? ` · ${Math.round((ok / att) * 100)}%` : ''}`;

  const ourDrivePct = pct(offTd, offDrives);
  const oppDrivePct = pct(oppTd, defDrives);

  // Build comparison metrics — Iter 38: zrcadlí se podle isOppPerspective
  const ourTotal = isOppPerspective ? (match.opp_total_yds ?? 0) : (match.total_yds ?? 0);
  const oppTotal = isOppPerspective ? (match.total_yds ?? 0)     : (match.opp_total_yds ?? 0);
  const ourPass  = isOppPerspective ? (match.opp_pass_yds ?? 0)  : (match.pass_yds ?? 0);
  const oppPass  = isOppPerspective ? (match.pass_yds ?? 0)      : (match.opp_pass_yds ?? 0);
  const ourRush  = isOppPerspective ? (match.opp_rush_yds ?? 0)  : (match.rush_yds ?? 0);
  const oppRush  = isOppPerspective ? (match.rush_yds ?? 0)      : (match.opp_rush_yds ?? 0);
  const metrics: HeadToHeadMetric[] = [
    { label: 'Skóre',            our: ourScore,                       opp: oppScore,                       format: 'int',    higherIsBetter: true },
    { label: 'Total yardů',      our: ourTotal,                       opp: oppTotal,                       format: 'yards',  higherIsBetter: true },
    { label: 'Pass yardů',       our: ourPass,                        opp: oppPass,                        format: 'yards',  higherIsBetter: true },
    { label: 'Rush yardů',       our: ourRush,                        opp: oppRush,                        format: 'yards',  higherIsBetter: true },
    { label: 'Touchdowny',       our: offTd,                          opp: oppTd,                          format: 'int',    higherIsBetter: true },
    {
      label: 'Úspěšnost drives',
      our: ourDrivePct, opp: oppDrivePct,
      ourDisplay: ratio(offTd, offDrives),
      oppDisplay: ratio(oppTd, defDrives),
      format: 'percent', higherIsBetter: true,
    },
    {
      label: '1PT konverze',
      our: pct(xp1Ok, xp1Att), opp: pct(oppXp1Ok, oppXp1Att),
      ourDisplay: ratio(xp1Ok, xp1Att),
      oppDisplay: ratio(oppXp1Ok, oppXp1Att),
      format: 'percent', higherIsBetter: true,
    },
    {
      label: '2PT konverze',
      our: pct(xp2Ok, xp2Att), opp: pct(oppXp2Ok, oppXp2Att),
      ourDisplay: ratio(xp2Ok, xp2Att),
      oppDisplay: ratio(oppXp2Ok, oppXp2Att),
      format: 'percent', higherIsBetter: true,
    },
    {
      label: 'Fauly',
      our: isOppPerspective ? (match.opp_pen_count ?? 0) : (match.pen_count ?? 0),
      opp: isOppPerspective ? (match.pen_count ?? 0)     : (match.opp_pen_count ?? 0),
      format: 'int', higherIsBetter: false,
    },
    {
      label: 'Fauly · yardy',
      our: isOppPerspective ? (match.opp_pen_yds ?? 0) : (match.pen_yds ?? 0),
      opp: isOppPerspective ? (match.pen_yds ?? 0)     : (match.opp_pen_yds ?? 0),
      format: 'yards', higherIsBetter: false,
    },
  ];

  // Player stats for this match — Iter 38: + players.team_id pro filtrování per current team
  const { data: psRaw } = await admin
    .from('match_player_stats')
    .select(`
      player_id,
      qb_att, qb_comp, qb_yds, qb_td, qb_int,
      wr_targets, wr_rec, wr_yds, wr_td, wr_pts,
      db_flag_pull, db_sack, db_brkup, db_int,
      players ( first_name, last_name, jersey_number, photo_url, team_id )
    `)
    .eq('match_id', matchId);
  // Iter 38: zobrazujeme jen hráče current teamu (z perspektivy které nahlížíme)
  const psRows = ((psRaw ?? []) as any[]).filter((r) => r.players?.team_id === teamId);

  type Bucket = {
    playerId: string;
    name: string;
    jersey: number | string | null;
    photoUrl: string | null;
    qb: { att: number; comp: number; yds: number; td: number; int: number };
    wr: { targets: number; rec: number; yds: number; td: number; pts: number };
    db: { flagPull: number; sack: number; brkup: number; int: number };
  };
  const buckets = new Map<string, Bucket>();
  for (const r of psRows) {
    const p = r.players ?? {};
    const id = r.player_id;
    let b = buckets.get(id);
    if (!b) {
      const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—';
      b = {
        playerId: id, name: fullName,
        jersey: p.jersey_number ?? null,
        photoUrl: p.photo_url ?? null,
        qb: { att: 0, comp: 0, yds: 0, td: 0, int: 0 },
        wr: { targets: 0, rec: 0, yds: 0, td: 0, pts: 0 },
        db: { flagPull: 0, sack: 0, brkup: 0, int: 0 },
      };
      buckets.set(id, b);
    }
    b.qb.att  += r.qb_att  ?? 0; b.qb.comp += r.qb_comp ?? 0;
    b.qb.yds  += r.qb_yds  ?? 0; b.qb.td   += r.qb_td   ?? 0;
    b.qb.int  += r.qb_int  ?? 0;
    b.wr.targets += r.wr_targets ?? 0; b.wr.rec += r.wr_rec ?? 0;
    b.wr.yds += r.wr_yds ?? 0; b.wr.td += r.wr_td ?? 0;
    b.wr.pts += r.wr_pts ?? 0;
    b.db.flagPull += r.db_flag_pull ?? 0; b.db.sack += r.db_sack ?? 0;
    b.db.brkup += r.db_brkup ?? 0; b.db.int += r.db_int ?? 0;
  }
  const all = Array.from(buckets.values());

  const qbStats: QbRow[] = all.filter((b) => b.qb.att > 0).map((b) => ({
    playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
    att: b.qb.att, comp: b.qb.comp, td: b.qb.td, int: b.qb.int, yds: b.qb.yds,
  })).sort((a, b) => b.td - a.td || b.yds - a.yds);

  const wrStats: WrRow[] = all.filter((b) => b.wr.targets > 0 || b.wr.td > 0).map((b) => ({
    playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
    td: b.wr.td, targets: b.wr.targets, rec: b.wr.rec, yds: b.wr.yds, pts: b.wr.pts,
  })).sort((a, b) => b.td - a.td || b.pts - a.pts);

  const defenseLeaders: DbRow[] = all.filter((b) => b.db.flagPull > 0 || b.db.sack > 0 || b.db.int > 0 || b.db.brkup > 0)
    .map((b) => ({
      playerId: b.playerId, name: b.name, jersey: b.jersey, photoUrl: b.photoUrl,
      flagPull: b.db.flagPull, sack: b.db.sack, brkup: b.db.brkup, int: b.db.int,
    }))
    .sort((a, b) => (b.int * 3 + b.sack * 2 + b.flagPull) - (a.int * 3 + a.sack * 2 + a.flagPull));

  return {
    id: match.id,
    date: match.date,
    // Iter 38: v opp perspective je "soupeř" původní home tým
    opponent: opponentName || match.opponent,
    result: ourScore > oppScore ? 'W' : ourScore < oppScore ? 'L' : 'T',
    ourScore, oppScore,
    ourTeamName, ourClubName, ourLogoUrl, primaryColor,
    oppColor, oppLogoUrl,
    metrics,
    qbStats, wrStats, defenseLeaders,
  };
}
