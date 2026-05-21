import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const matchId  = String(form.get('match_id') ?? '').trim();
  const playerId = String(form.get('player_id') ?? '').trim();
  if (!matchId || !playerId) {
    return redirect(`/admin/matches/${matchId}?error=missing`, 303);
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('match_player_stats')
    .delete()
    .eq('match_id', matchId)
    .eq('player_id', playerId);
  if (error) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/admin/matches/${matchId}?saved=removed`, 303);
};
