import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { publicOrigin } from '../../../../lib/url';

export const prerender = false;
const VALID_ROLES = ['admin', 'coach', 'stats', 'viewer'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const role  = String(form.get('role') ?? 'viewer').trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return redirect(`/app/settings?error=${encodeURIComponent('Zadejte platný e-mail.')}`, 303);
  }
  if (!VALID_ROLES.includes(role)) {
    return redirect(`/app/settings?error=${encodeURIComponent('Neplatná role.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('id, name')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!club) return redirect(`/app/settings?error=${encodeURIComponent('Klub nenalezen.')}`, 303);

  // Is this email already a member?
  const { data: profile } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (profile) {
    const { data: existing } = await admin
      .from('club_members')
      .select('id')
      .eq('club_id', club.id)
      .eq('user_id', profile.id)
      .maybeSingle();
    if (existing) {
      return redirect(`/app/settings?error=${encodeURIComponent('Tento uživatel už je v klubu.')}`, 303);
    }
  }

  const { data: invite, error } = await admin
    .from('club_invites')
    .insert({ club_id: club.id, email, role, invited_by: user.id })
    .select('token')
    .single();
  if (error || !invite) {
    return redirect(`/app/settings?error=${encodeURIComponent('Pozvánka selhala: ' + (error?.message ?? ''))}`, 303);
  }

  const origin = publicOrigin(request);
  const inviteUrl = `${origin}/invite/${invite.token}`;
  return redirect(`/app/settings?invite=${encodeURIComponent(inviteUrl)}`, 303);
};
