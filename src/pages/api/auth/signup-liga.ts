import type { APIRoute } from 'astro';
import { getSupabase, getSupabaseAdmin } from '../../../lib/supabase';

export const prerender = false;

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'liga';
}

const VALID_SPORTS = ['flag-football', 'american_football', 'football', 'basketball', 'volleyball', 'hockey', 'other'];

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email      = String(form.get('email')        ?? '').trim().toLowerCase();
  const password   = String(form.get('password')     ?? '');
  const firstName  = String(form.get('first_name')   ?? '').trim();
  const lastName   = String(form.get('last_name')    ?? '').trim();
  const leagueName = String(form.get('league_name')  ?? '').trim();
  const sportRaw   = String(form.get('sport')        ?? 'flag-football').trim();
  const consent    = form.get('consent');

  if (!email || !password || !firstName || !leagueName) {
    return redirect(`/liga-signup?error=${encodeURIComponent('Vyplňte všechna povinná pole.')}`, 303);
  }
  if (password.length < 8) {
    return redirect(`/liga-signup?error=${encodeURIComponent('Heslo musí mít alespoň 8 znaků.')}`, 303);
  }
  if (!consent) {
    return redirect(`/liga-signup?error=${encodeURIComponent('Pro registraci musíte souhlasit s podmínkami.')}`, 303);
  }
  const sport = VALID_SPORTS.includes(sportRaw) ? sportRaw : 'flag-football';

  const supabase = getSupabase(cookies, request.headers);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  });

  if (error)  return redirect(`/liga-signup?error=${encodeURIComponent(error.message)}`, 303);
  const user = data.user;
  if (!user)  return redirect(`/liga-signup?error=${encodeURIComponent('Účet se nepodařilo vytvořit.')}`, 303);

  const admin = getSupabaseAdmin();

  // Find unique slug
  const baseSlug = slugify(leagueName);
  let slug = baseSlug;
  for (let i = 0; i < 8; i++) {
    const { data: existing } = await admin.from('leagues').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  // Create league (Liga tier by default, 30-day trial)
  const trialEnds = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const { data: league, error: lgErr } = await admin
    .from('leagues')
    .insert({
      name: leagueName,
      slug,
      sport,
      owner_user_id: user.id,
      subscription_tier: 'liga',
      subscription_status: 'trialing',
      trial_ends_at: trialEnds,
    })
    .select('id')
    .single();
  if (lgErr || !league) {
    return redirect(`/liga-signup?error=${encodeURIComponent('Ligu se nepodařilo vytvořit: ' + (lgErr?.message ?? ''))}`, 303);
  }

  // Admin membership row
  await admin.from('league_members').insert({
    league_id: league.id,
    user_id: user.id,
    role: 'admin',
  });

  // Also create a profiles row if profiles table is used elsewhere — defensive
  try {
    await admin.from('profiles').upsert({
      id: user.id,
      email,
      first_name: firstName,
      last_name: lastName,
    });
  } catch {}

  if (!data.session) {
    return redirect(`/login?info=${encodeURIComponent('Účet vytvořen. Zkontrolujte e-mail pro potvrzení.')}`, 303);
  }
  return redirect('/app/league?welcome=1', 303);
};
