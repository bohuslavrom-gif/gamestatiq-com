import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/teams', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) {
    return redirect(`/app?error=${encodeURIComponent('Nejste členem žádné ligy.')}`, 303);
  }
  if (role !== 'admin') {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Pouze admin ligy může pozývat týmy.')}`, 303);
  }

  const form = await request.formData();
  const teamId = String(form.get('team_id') ?? '').trim();
  if (!teamId) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Chybí ID týmu.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify team exists
  const { data: team } = await admin
    .from('teams')
    .select('id, name, club_id, is_archived')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Tým neexistuje.')}`, 303);
  }
  if (team.is_archived) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Nelze pozvat archivovaný tým.')}`, 303);
  }

  // Check for duplicate (idempotent)
  const { data: existing } = await admin
    .from('league_teams')
    .select('league_id')
    .eq('league_id', league.id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (existing) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Tento tým už je v lize pozván nebo schválen.')}`, 303);
  }

  const { error } = await admin.from('league_teams').insert({
    league_id: league.id,
    team_id: teamId,
    invited_by: user.id,
    invited_at: new Date().toISOString(),
  });
  if (error) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Pozvánku se nepodařilo vytvořit: ' + error.message)}`, 303);
  }

  return redirect(`/app/league/teams?saved=invited&team=${encodeURIComponent(team.name)}`, 303);
};
