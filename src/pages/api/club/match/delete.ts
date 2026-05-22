import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

// Delete is admin-only (vs edit which allows coach + stats too)
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/matches', 303);

  const form = await request.formData();
  const matchId = String(form.get('match_id') ?? '').trim();
  if (!matchId) return redirect('/app/matches?error=missing_id', 303);

  const admin = getSupabaseAdmin();
  const { data: match } = await admin.from('matches').select('club_id').eq('id', matchId).maybeSingle();
  if (!match) return redirect('/app/matches?error=not_found', 303);

  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('club_id', (match as { club_id: string }).club_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!cm || (cm as { role: string }).role !== 'admin') {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent('Smazání zápasu vyžaduje roli Admin.')}`, 303);
  }

  // Cascading delete via FK ON DELETE CASCADE
  const { error } = await admin.from('matches').delete().eq('id', matchId);
  if (error) {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect('/app/matches?saved=deleted', 303);
};
