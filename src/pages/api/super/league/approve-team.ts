import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const teamId   = String(form.get('team_id') ?? '').trim();
  if (!leagueId || !teamId) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Chybí parametry.')}`, 303);
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('league_teams')
    .update({ approved_at: new Date().toISOString(), approved_by: locals.user?.id ?? null })
    .eq('league_id', leagueId)
    .eq('team_id', teamId);
  if (error) return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent(error.message)}`, 303);
  return redirect(`/admin/leagues/${leagueId}?saved=1`, 303);
};
