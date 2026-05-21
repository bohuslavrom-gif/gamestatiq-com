import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const playerId = String(form.get('player_id') ?? '').trim();
  const teamId   = String(form.get('team_id') ?? '').trim();
  if (!playerId) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Chybí player_id.')}`, 303);
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('players').delete().eq('id', playerId);
  if (error) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Smazání selhalo: ' + error.message)}`, 303);
  }
  return redirect(`/admin/teams/${teamId}?saved=removed`, 303);
};
