import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  if (!id) return redirect('/app/settings', 303);

  const admin = getSupabaseAdmin();
  const { data: invite } = await admin.from('club_invites').select('club_id').eq('id', id).maybeSingle();
  if (!invite) return redirect('/app/settings', 303);

  const { data: club } = await admin.from('clubs').select('id').eq('id', invite.club_id).eq('owner_id', user.id).maybeSingle();
  if (!club) return redirect(`/app/settings?error=${encodeURIComponent('Bez oprávnění.')}`, 303);

  await admin.from('club_invites').delete().eq('id', id);
  return redirect('/app/settings?saved=invite-removed', 303);
};
