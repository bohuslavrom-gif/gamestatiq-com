import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login', 303);

  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const teamId   = String(form.get('team_id')   ?? '').trim();
  const source   = String(form.get('source')    ?? 'league').trim(); // 'league' | 'club'
  if (!leagueId || !teamId) {
    return redirect(`/app?error=${encodeURIComponent('Chybí parametr.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify authorization: league owner / league admin / club admin can remove
  let authorized = false;

  // Check league owner
  const { data: league } = await admin.from('leagues').select('owner_user_id').eq('id', leagueId).maybeSingle();
  if (league && (league as { owner_user_id: string }).owner_user_id === user.id) {
    authorized = true;
  }

  // Iter 40: league admin (přes league_members)
  if (!authorized) {
    const { data: lm } = await admin
      .from('league_members')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (lm && (lm as { role: string }).role === 'admin') authorized = true;
  }

  // Check club admin (if not already authorized)
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
    // Vrátíme se na referrer s error (předtím šel na /app/?error= což se ztratilo)
    return redirect(`/app/league/teams?error=${encodeURIComponent('Bez oprávnění — pro odebrání musíš být liga admin, vlastník ligy, nebo admin klubu.')}`, 303);
  }

  await admin
    .from('league_teams')
    .delete()
    .eq('league_id', leagueId)
    .eq('team_id', teamId);

  const redirUrl = source === 'club' ? '/app?saved=league_removed' : '/app/league/teams?saved=removed';
  return redirect(redirUrl, 303);
};
