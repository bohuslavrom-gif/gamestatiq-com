import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const form = await request.formData();
  const memberId = String(form.get('member_id') ?? '');
  if (!memberId) return redirect('/app/settings', 303);

  const admin = getSupabaseAdmin();
  const { data: member } = await admin
    .from('club_members')
    .select('id, club_id, user_id')
    .eq('id', memberId)
    .maybeSingle();
  if (!member) return redirect('/app/settings', 303);

  const { data: club } = await admin.from('clubs').select('id, owner_id').eq('id', member.club_id).maybeSingle();
  if (!club || club.owner_id !== user.id) {
    return redirect(`/app/settings?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }
  if (member.user_id === club.owner_id) {
    return redirect(`/app/settings?error=${encodeURIComponent('Vlastníka klubu nelze odebrat.')}`, 303);
  }

  await admin.from('club_members').delete().eq('id', memberId);
  return redirect('/app/settings?saved=member-removed', 303);
};
