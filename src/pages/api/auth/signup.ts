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
    .slice(0, 48) || 'klub';
}

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email     = String(form.get('email')      ?? '').trim().toLowerCase();
  const password  = String(form.get('password')   ?? '');
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName  = String(form.get('last_name')  ?? '').trim();
  const clubName  = String(form.get('club_name')  ?? '').trim();
  const inviteTok = String(form.get('invite')     ?? '').trim();
  const consent   = form.get('consent');

  // For invite flow: club_name is not required
  if (!email || !password || !firstName || (!inviteTok && !clubName)) {
    return redirect(`/signup?error=${encodeURIComponent('Vyplňte všechna povinná pole.')}`, 303);
  }
  if (password.length < 8) {
    return redirect(`/signup?error=${encodeURIComponent('Heslo musí mít alespoň 8 znaků.')}`, 303);
  }
  if (!consent) {
    return redirect(`/signup?error=${encodeURIComponent('Pro registraci musíte souhlasit s podmínkami.')}`, 303);
  }

  const supabase = getSupabase(cookies, request.headers);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { first_name: firstName, last_name: lastName } },
  });

  if (error) return redirect(`/signup?error=${encodeURIComponent(error.message)}`, 303);
  const user = data.user;
  if (!user) return redirect(`/signup?error=${encodeURIComponent('Účet se nepodařilo vytvořit.')}`, 303);

  const admin = getSupabaseAdmin();

  // If signing up via invite, attach to inviter's club instead of creating new one
  if (inviteTok) {
    const { data: invite } = await admin
      .from('club_invites')
      .select('id, club_id, role, email, expires_at, accepted_at')
      .eq('token', inviteTok)
      .maybeSingle();

    if (invite
      && !invite.accepted_at
      && new Date(invite.expires_at) >= new Date()
      && invite.email.toLowerCase() === email
    ) {
      await admin.from('club_members').insert({
        club_id: invite.club_id,
        user_id: user.id,
        role: invite.role,
      });
      await admin.from('club_invites')
        .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
        .eq('id', invite.id);

      if (!data.session) {
        return redirect(`/login?info=${encodeURIComponent('Účet vytvořen. Zkontrolujte e-mail pro potvrzení.')}`, 303);
      }
      return redirect('/app', 303);
    }
    // Invite invalid — fall through to normal signup if club_name was supplied,
    // otherwise show error
    if (!clubName) {
      return redirect(`/signup?error=${encodeURIComponent('Pozvánka je neplatná nebo vypršela.')}`, 303);
    }
  }

  // Normal signup: create club + admin membership
  const baseSlug = slugify(clubName);
  let slug = baseSlug;
  for (let i = 0; i < 8; i++) {
    const { data: existing } = await admin.from('clubs').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${baseSlug}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  const { data: club, error: clubErr } = await admin
    .from('clubs')
    .insert({ name: clubName, slug, owner_id: user.id })
    .select('id')
    .single();
  if (clubErr || !club) {
    return redirect(`/signup?error=${encodeURIComponent('Klub se nepodařilo vytvořit: ' + (clubErr?.message ?? ''))}`, 303);
  }
  await admin.from('club_members').insert({ club_id: club.id, user_id: user.id, role: 'admin' });

  if (!data.session) {
    return redirect(`/login?info=${encodeURIComponent('Účet vytvořen. Zkontrolujte e-mail pro potvrzení.')}`, 303);
  }
  return redirect('/app', 303);
};
