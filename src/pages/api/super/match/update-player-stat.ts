import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const NUMERIC = [
  'qb_att', 'qb_comp', 'qb_yds', 'qb_td', 'qb_int', 'qb_sack',
  'wr_targets', 'wr_rec', 'wr_yds', 'wr_td', 'wr_xp', 'wr_pts',
  'db_flag_pull', 'db_sack', 'db_brkup', 'db_int',
];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const matchId  = String(form.get('match_id') ?? '').trim();
  const playerId = String(form.get('player_id') ?? '').trim();
  if (!matchId || !playerId) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent('Chybí match_id nebo player_id.')}`, 303);
  }

  const row: Record<string, any> = { match_id: matchId, player_id: playerId };
  for (const k of NUMERIC) {
    const raw = form.get(k);
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s === '') { row[k] = 0; continue; }
    const n = parseInt(s, 10);
    row[k] = isNaN(n) || n < 0 ? 0 : n;
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('match_player_stats')
    .upsert(row, { onConflict: 'match_id,player_id' });
  if (error) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/admin/matches/${matchId}?saved=stats#player-${playerId}`, 303);
};
