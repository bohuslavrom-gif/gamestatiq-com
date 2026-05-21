import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const matchId  = String(form.get('match_id') ?? '').trim();
  const playerId = String(form.get('player_id') ?? '').trim();
  if (!matchId || !playerId) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent('Vyberte hráče.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('match_player_stats').upsert({
    match_id: matchId,
    player_id: playerId,
    qb_att: 0, qb_comp: 0, qb_yds: 0, qb_td: 0, qb_int: 0, qb_sack: 0,
    wr_targets: 0, wr_rec: 0, wr_yds: 0, wr_td: 0, wr_xp: 0, wr_pts: 0,
    db_flag_pull: 0, db_sack: 0, db_brkup: 0, db_int: 0,
  }, { onConflict: 'match_id,player_id' });
  if (error) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/admin/matches/${matchId}?saved=added`, 303);
};
