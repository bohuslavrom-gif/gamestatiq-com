// Iter 41: Liga admin může měnit primary/secondary color + jméno týmu v lize.
// Autorizace: league owner / league admin (přes league_members) / club admin toho týmu.
import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/teams', 303);

  const form = await request.formData();
  const leagueId  = String(form.get('league_id')  ?? '').trim();
  const teamId    = String(form.get('team_id')    ?? '').trim();
  const primary   = String(form.get('primary')    ?? '').trim();
  const secondary = String(form.get('secondary')  ?? '').trim();

  if (!leagueId || !teamId) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Chybí parametr.')}`, 303);
  }
  if (primary && !HEX_RE.test(primary)) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Primární barva musí být ve formátu #RRGGBB.')}`, 303);
  }
  if (secondary && !HEX_RE.test(secondary)) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Sekundární barva musí být ve formátu #RRGGBB.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Ověření že tým existuje a je v lize (schválený nebo pending)
  const { data: lt } = await admin
    .from('league_teams')
    .select('league_id, team_id')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!lt) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Tým není v této lize.')}`, 303);
  }

  // Autorizace
  let authorized = false;
  const { data: league } = await admin.from('leagues').select('owner_user_id').eq('id', leagueId).maybeSingle();
  if (league && (league as { owner_user_id: string }).owner_user_id === user.id) authorized = true;

  if (!authorized) {
    const { data: lm } = await admin
      .from('league_members')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (lm && (lm as { role: string }).role === 'admin') authorized = true;
  }

  if (!authorized) {
    const { data: team } = await admin.from('teams').select('club_id').eq('id', teamId).maybeSingle();
    if (team) {
      const { data: cm } = await admin
        .from('club_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('club_id', team.club_id)
        .maybeSingle();
      if (cm && cm.role === 'admin') authorized = true;
    }
  }

  if (!authorized) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Bez oprávnění — musíš být liga admin, vlastník ligy, nebo admin klubu týmu.')}`, 303);
  }

  const updates: Record<string, string> = { updated_at: new Date().toISOString() };
  if (primary)   updates.primary_color   = primary;
  if (secondary) updates.secondary_color = secondary;

  if (Object.keys(updates).length === 1) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Zadej alespoň jednu barvu.')}`, 303);
  }

  const { error } = await admin.from('teams').update(updates).eq('id', teamId);
  if (error) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Update selhal: ' + error.message)}`, 303);
  }

  return redirect('/app/league/teams?saved=branding', 303);
};
