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
