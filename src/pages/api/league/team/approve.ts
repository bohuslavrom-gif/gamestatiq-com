import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app', 303);

  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const teamId   = String(form.get('team_id')   ?? '').trim();
  if (!leagueId || !teamId) {
    return redirect(`/app?error=${encodeURIComponent('Chybí league_id nebo team_id.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify the team belongs to a club the user is admin of
  const { data: team } = await admin
    .from('teams')
    .select('id, club_id')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) {
    return redirect(`/app?error=${encodeURIComponent('Tým neexistuje.')}`, 303);
  }

  const { data: membership } = await admin
    .from('club_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('club_id', team.club_id)
    .maybeSingle();
  if (!membership || membership.role !== 'admin') {
    return redirect(`/app?error=${encodeURIComponent('Pouze admin klubu může schválit účast v lize.')}`, 303);
  }

  // Verify pending invitation exists
  const { data: lt } = await admin
    .from('league_teams')
    .select('league_id, team_id, approved_at')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!lt) {
    return redirect(`/app?error=${encodeURIComponent('Pozvánka neexistuje.')}`, 303);
  }
  if (lt.approved_at) {
    return redirect(`/app?error=${encodeURIComponent('Tato pozvánka už byla schválena.')}`, 303);
  }

  const { error } = await admin
    .from('league_teams')
    .update({
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq('league_id', leagueId)
    .eq('team_id', teamId);

  if (error) {
    return redirect(`/app?error=${encodeURIComponent('Schválení selhalo: ' + error.message)}`, 303);
  }

  return redirect('/app?saved=league_approved', 303);
};
