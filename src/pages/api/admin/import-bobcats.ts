import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { fetchCoachStats, fetchPlayerMatchStats } from '../../../lib/bobcats';

export const prerender = false;

type Summary = {
  ok: boolean;
  matches_inserted: number;
  matches_skipped: number;
  player_stats_inserted: number;
  player_stats_skipped_unknown: number;
  errors: string[];
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** GAS returns Date as JS toString format ("Mon Apr 06 2026 00:00:00 GMT+0200..."). Convert to ISO YYYY-MM-DD. */
function toIsoDate(input: string): string | null {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return input.trim();
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const GET: APIRoute = async ({ locals, request }) => {
  const summary: Summary = {
    ok: false,
    matches_inserted: 0,
    matches_skipped: 0,
    player_stats_inserted: 0,
    player_stats_skipped_unknown: 0,
    errors: [],
  };

  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ error: 'auth required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const admin = getSupabaseAdmin();

  // Find user's club + role
  const { data: membership } = await admin
    .from('club_members')
    .select('club_id, role, clubs(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership || membership.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'admin role required' }), { status: 403, headers: { 'content-type': 'application/json' } });
  }

  const clubId = membership.club_id;
  const clubName = (membership as any).clubs?.name ?? '—';
  if (clubName !== 'Bobcats') {
    return new Response(JSON.stringify({ error: 'this endpoint is hard-coded for Bobcats club' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  // Fetch coach stats — gives us the matchLog
  const coach = await fetchCoachStats('Muži');
  if (!coach) {
    summary.errors.push('coachStats fetch failed');
    return new Response(JSON.stringify(summary), { status: 502, headers: { 'content-type': 'application/json' } });
  }

  // Load existing players from Supabase for name matching
  const { data: players } = await admin
    .from('players')
    .select('id, first_name, last_name')
    .eq('club_id', clubId);
  const playerByName = new Map<string, string>();
  for (const p of players ?? []) {
    const fn = (p.first_name ?? '').trim();
    const ln = ((p as any).last_name ?? '').trim();
    if (fn || ln) {
      playerByName.set(norm(`${fn} ${ln}`.trim()), p.id);
      if (ln) playerByName.set(norm(`${ln} ${fn}`.trim()), p.id);
    }
  }

  // Process each match
  for (const m of coach.matchLog) {
    try {
      const isoDate = toIsoDate(m.date);
      const cleanOpp = String(m.opponent ?? '').trim();
      if (!isoDate) {
        summary.errors.push(`match ${m.date} vs ${m.opponent}: invalid date format`);
        continue;
      }
      if (!cleanOpp) {
        summary.errors.push(`match ${m.date}: empty opponent`);
        continue;
      }

      // Skip if already imported (trimmed opponent comparison)
      const { data: existing } = await admin
        .from('matches')
        .select('id')
        .eq('club_id', clubId)
        .eq('date', isoDate)
        .eq('opponent', cleanOpp)
        .maybeSingle();

      let matchId = existing?.id;
      if (matchId) {
        summary.matches_skipped++;
      } else {
        const passPctNum = (m.passPct != null) ? Number(m.passPct) : null;
        const tdPctNum   = (m.tdPct != null)   ? Number(m.tdPct)   : null;
        const stopPctNum = (m.stopPct != null) ? Number(m.stopPct) : null;

        const { data: ins, error: insErr } = await admin
          .from('matches')
          .insert({
            club_id: clubId,
            date: isoDate,
            opponent: cleanOpp,
            our_score: m.ourScore ?? 0,
            opp_score: m.oppScore ?? 0,
            off_drives: m.offDrives ?? 0,
            off_td: m.offTD ?? 0,
            rush_yds: m.rushYds ?? 0,
            pass_yds: m.passYds ?? 0,
            total_yds: m.totalYds ?? 0,
            qb_att: m.qbAtt ?? 0,
            qb_comp: m.qbComp ?? 0,
            qb_td: m.qbTD ?? 0,
            qb_int: m.qbINT ?? 0,
            qb_yds: m.qbYds ?? 0,
            xp1_att: m.xp1Att ?? 0,
            xp1_ok: m.xp1Ok ?? 0,
            xp2_att: m.xp2Att ?? 0,
            xp2_ok: m.xp2Ok ?? 0,
            def_drives: m.defDrives ?? 0,
            def_stops: m.defStops ?? 0,
            opp_rush_yds: m.oppRushYds ?? 0,
            opp_pass_yds: m.oppPassYds ?? 0,
            opp_total_yds: m.oppTotalYds ?? 0,
            pen_count: m.penCount ?? 0,
            pen_yds: m.penYds ?? 0,
            created_by: user.id,
          })
          .select('id')
          .single();
        if (insErr || !ins) {
          summary.errors.push(`match ${m.date} vs ${cleanOpp}: ${insErr?.message ?? 'no id'}`);
          continue;
        }
        matchId = ins.id;
        summary.matches_inserted++;
      }

      // Per-player per-match stats
      const pms = await fetchPlayerMatchStats('Muži', m.date, m.opponent);
      if (!pms) continue;

      // Accumulate: same player can appear in qbStats AND wrStats AND defenseLeaders
      const accum = new Map<string, any>();
      const ensure = (name: string) => {
        const playerId = playerByName.get(norm(name));
        if (!playerId) { summary.player_stats_skipped_unknown++; return null; }
        if (!accum.has(playerId)) {
          accum.set(playerId, {
            match_id: matchId, player_id: playerId,
            qb_att: 0, qb_comp: 0, qb_yds: 0, qb_td: 0, qb_int: 0, qb_sack: 0,
            wr_targets: 0, wr_rec: 0, wr_yds: 0, wr_td: 0, wr_xp: 0, wr_pts: 0,
            db_flag_pull: 0, db_sack: 0, db_brkup: 0, db_int: 0,
          });
        }
        return accum.get(playerId);
      };

      for (const p of pms.qbStats) {
        const r = ensure(p.name); if (!r) continue;
        r.qb_att += p.qb.att; r.qb_comp += p.qb.comp; r.qb_yds += p.qb.yds;
        r.qb_td += p.qb.td;   r.qb_int += p.qb.int;   r.qb_sack += (p.qb as any).sack ?? 0;
      }
      for (const p of pms.wrStats) {
        const r = ensure(p.name); if (!r) continue;
        r.wr_targets += p.wr.targets; r.wr_rec += p.wr.rec; r.wr_yds += p.wr.yds;
        r.wr_td += p.wr.td;            r.wr_xp += (p.wr as any).xp ?? 0; r.wr_pts += p.wr.pts;
      }
      for (const p of pms.defenseLeaders) {
        const r = ensure(p.name); if (!r) continue;
        r.db_flag_pull += p.db.flagPull; r.db_sack += p.db.sack;
        r.db_brkup += p.db.brkup;         r.db_int += p.db.int;
      }

      if (accum.size > 0) {
        const rows = Array.from(accum.values());
        const { error: psErr } = await admin
          .from('match_player_stats')
          .upsert(rows, { onConflict: 'match_id,player_id' });
        if (psErr) {
          summary.errors.push(`player stats ${m.date} vs ${cleanOpp}: ${psErr.message}`);
        } else {
          summary.player_stats_inserted += rows.length;
        }
      }
    } catch (err) {
      summary.errors.push(`match ${m.date} vs ${m.opponent}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  summary.ok = summary.errors.length === 0;
  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
