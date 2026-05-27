// Iter 71: Liga member invite — admin pozve uživatele e-mailem.
// Pokud uživatel existuje v profiles, přidáme do league_members rovnou.
// Pokud neexistuje, pošleme Supabase magic-link signup invite a po prvním
// loginu se připojí. Pro MVP: zatím jen attach existing user.
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
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může zvát členy.')}`, 303);
  }

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const memberRole = String(form.get('role') ?? 'staff').trim() as Role;

  if (!email || !email.includes('@')) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Neplatný e-mail.')}`, 303);
  }
  if (!VALID_ROLES.includes(memberRole)) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Neplatná role.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // 1) Najdi user_id přes profiles
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (!profile) {
    return redirect(`/app/league/settings?error=${encodeURIComponent(`Uživatel s e-mailem ${email} v systému neexistuje. Požádejte ho, aby se nejdřív registroval na gamestatiq.com.`)}`, 303);
  }

  // 2) Zkontroluj duplicitu
  const { data: existing } = await admin
    .from('league_members')
    .select('id, role')
    .eq('league_id', league.id)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (existing) {
    return redirect(`/app/league/settings?error=${encodeURIComponent(`Uživatel ${email} už je členem (role: ${existing.role}).`)}`, 303);
  }

  // 3) Vlož členství
  const { error: insertErr } = await admin
    .from('league_members')
    .insert({
      league_id: league.id,
      user_id: profile.id,
      role: memberRole,
    });

  if (insertErr) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Nepodařilo se přidat člena: ' + insertErr.message)}`, 303);
  }

  return redirect(`/app/league/settings?saved=invite&invited=${encodeURIComponent(email)}`, 303);
};
