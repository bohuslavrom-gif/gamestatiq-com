// Iter 71: Remove league member.
import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/settings', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin') {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může odebírat členy.')}`, 303);
  }

  const form = await request.formData();
  const memberId = String(form.get('member_id') ?? '').trim();

  if (!memberId) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Chybí member_id.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  const { data: m } = await admin
    .from('league_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('league_id', league.id)
    .maybeSingle();

  if (!m) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Člen nepatří do této ligy.')}`, 303);
  }

  // Self-remove protection: poslední admin nemůže odejít.
  if (m.user_id === user.id && m.role === 'admin') {
    const { count } = await admin
      .from('league_members')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', league.id)
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return redirect(`/app/league/settings?error=${encodeURIComponent('Nemůžete odejít — jste poslední admin ligy.')}`, 303);
    }
  }

  // Owner protection: vlastník ligy nesmí být odebrán.
  if (m.user_id === (league as any).owner_user_id) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Vlastník ligy nemůže být odebrán z členů.')}`, 303);
  }

  const { error: delErr } = await admin
    .from('league_members')
    .delete()
    .eq('id', memberId)
    .eq('league_id', league.id);

  if (delErr) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Odebrání selhalo: ' + delErr.message)}`, 303);
  }

  return redirect(`/app/league/settings?saved=removed`, 303);
};
