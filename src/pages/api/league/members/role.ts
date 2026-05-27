// Iter 71: Change league member role.
import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_ROLES = ['admin', 'staff', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/settings', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin') {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může měnit role.')}`, 303);
  }

  const form = await request.formData();
  const memberId = String(form.get('member_id') ?? '').trim();
  const newRole = String(form.get('role') ?? '').trim() as Role;

  if (!memberId) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Chybí member_id.')}`, 303);
  }
  if (!VALID_ROLES.includes(newRole)) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Neplatná role.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Ověř, že member patří do této ligy
  const { data: m } = await admin
    .from('league_members')
    .select('id, user_id, role')
    .eq('id', memberId)
    .eq('league_id', league.id)
    .maybeSingle();

  if (!m) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Člen nepatří do této ligy.')}`, 303);
  }

  // Self-demote ochrana: admin si nemůže snížit svoji vlastní roli, pokud je
  // jediným adminem (aby liga nezůstala bez admina).
  if (m.user_id === user.id && m.role === 'admin' && newRole !== 'admin') {
    const { count } = await admin
      .from('league_members')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', league.id)
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return redirect(`/app/league/settings?error=${encodeURIComponent('Nemůžete si snížit roli — jste poslední admin ligy.')}`, 303);
    }
  }

  const { error: updErr } = await admin
    .from('league_members')
    .update({ role: newRole })
    .eq('id', memberId)
    .eq('league_id', league.id);

  if (updErr) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Změna role selhala: ' + updErr.message)}`, 303);
  }

  return redirect(`/app/league/settings?saved=role`, 303);
};
