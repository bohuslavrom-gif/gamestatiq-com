import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_ROLES = ['admin', 'coach', 'stats', 'viewer'];
const VALID_ACTIONS = ['add', 'update', 'remove'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const userId = String(form.get('user_id') ?? '').trim();
  const clubId = String(form.get('club_id') ?? '').trim();
  const role   = String(form.get('role') ?? '').trim();
  const action = String(form.get('action') ?? 'add').trim();

  if (!userId) return redirect('/admin/users?error=missing_user', 303);
  if (!VALID_ACTIONS.includes(action)) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Neplatná akce.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  if (action === 'remove') {
    const membershipId = String(form.get('membership_id') ?? '').trim();
    if (!membershipId) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Chybí ID členství.')}`, 303);
    }
    const { error } = await admin.from('club_members').delete().eq('id', membershipId).eq('user_id', userId);
    if (error) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Smazání selhalo: ' + error.message)}`, 303);
    }
    return redirect(`/admin/users/${userId}?saved=membership_removed`, 303);
  }

  // add / update both need role + club_id
  if (!clubId) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Vyberte klub.')}`, 303);
  }
  if (!VALID_ROLES.includes(role)) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Neplatná role.')}`, 303);
  }

  if (action === 'update') {
    const membershipId = String(form.get('membership_id') ?? '').trim();
    if (!membershipId) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Chybí ID členství.')}`, 303);
    }
    const { error } = await admin
      .from('club_members')
      .update({ role })
      .eq('id', membershipId)
      .eq('user_id', userId);
    if (error) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Update selhal: ' + error.message)}`, 303);
    }
    return redirect(`/admin/users/${userId}?saved=membership_updated`, 303);
  }

  // action === 'add'
  // Check duplicate
  const { data: existing } = await admin
    .from('club_members')
    .select('id')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (existing) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Uživatel už je členem tohoto klubu. Použijte update role.')}`, 303);
  }

  const { error } = await admin.from('club_members').insert({
    user_id: userId,
    club_id: clubId,
    role,
  });
  if (error) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Přidání selhalo: ' + error.message)}`, 303);
  }
  return redirect(`/admin/users/${userId}?saved=membership_added`, 303);
};
