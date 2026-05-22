import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const EDIT_ROLES = new Set(['admin', 'coach', 'stats']);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/matches', 303);

  const form = await request.formData();
  const matchId  = String(form.get('match_id') ?? '').trim();
  const playerId = String(form.get('player_id') ?? '').trim();
  if (!matchId || !playerId) {
    return redirect(`/app/matches/${matchId}?error=missing`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: match } = await admin.from('matches').select('club_id').eq('id', matchId).maybeSingle();
  if (!match) return redirect('/app/matches?error=not_found', 303);
  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('club_id', (match as { club_id: string }).club_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!cm || !EDIT_ROLES.has((cm as { role: string }).role)) {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }

  const { error } = await admin
    .from('match_player_stats')
    .delete()
    .eq('match_id', matchId)
    .eq('player_id', playerId);
  if (error) {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/app/matches/${matchId}?saved=removed`, 303);
};
