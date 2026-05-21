import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const teamId   = String(form.get('team_id') ?? '').trim();
  if (!leagueId || !teamId) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Chybí league_id nebo team_id.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify team exists + not archived
  const { data: team } = await admin.from('teams').select('id, is_archived').eq('id', teamId).maybeSingle();
  if (!team) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Tým neexistuje.')}`, 303);
  }
  if ((team as { is_archived: boolean }).is_archived) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Nelze přidat archivovaný tým.')}`, 303);
  }

  // Check duplicate
  const { data: existing } = await admin
    .from('league_teams')
    .select('league_id')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (existing) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Tým už v lize je.')}`, 303);
  }

  const now = new Date().toISOString();
  const { error } = await admin.from('league_teams').insert({
    league_id: leagueId,
    team_id: teamId,
    invited_by: locals.user?.id ?? null,
    invited_at: now,
    approved_by: locals.user?.id ?? null,
    approved_at: now,
  });
  if (error) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Přidání selhalo: ' + error.message)}`, 303);
  }
  return redirect(`/admin/leagues/${leagueId}?saved=1`, 303);
};
