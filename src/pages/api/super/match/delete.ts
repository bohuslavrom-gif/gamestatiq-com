import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const matchId = String(form.get('match_id') ?? '').trim();
  if (!matchId) return redirect('/admin/matches?error=missing_id', 303);

  const admin = getSupabaseAdmin();
  // Cascading delete: match_player_stats, match_plays, match_fouls, match_drives
  // all have ON DELETE CASCADE on match_id FK, so deleting the match row suffices.
  const { error } = await admin.from('matches').delete().eq('id', matchId);
  if (error) {
    return redirect(`/admin/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect('/admin/matches?saved=deleted', 303);
};
