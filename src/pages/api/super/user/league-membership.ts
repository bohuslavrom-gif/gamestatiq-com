import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_ROLES = ['admin', 'staff', 'viewer'];
const VALID_ACTIONS = ['add', 'update', 'remove'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const userId   = String(form.get('user_id') ?? '').trim();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const role     = String(form.get('role') ?? '').trim();
  const action   = String(form.get('action') ?? 'add').trim();

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
    const { error } = await admin.from('league_members').delete().eq('id', membershipId).eq('user_id', userId);
    if (error) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Smazání selhalo: ' + error.message)}`, 303);
    }
    return redirect(`/admin/users/${userId}?saved=league_membership_removed`, 303);
  }

  if (!leagueId) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Vyberte ligu.')}`, 303);
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
      .from('league_members')
      .update({ role })
      .eq('id', membershipId)
      .eq('user_id', userId);
    if (error) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Update selhal: ' + error.message)}`, 303);
    }
    return redirect(`/admin/users/${userId}?saved=league_membership_updated`, 303);
  }

  // action === 'add'
  const { data: existing } = await admin
    .from('league_members')
    .select('id')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .maybeSingle();
  if (existing) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Uživatel už je členem této ligy.')}`, 303);
  }

  const { error } = await admin.from('league_members').insert({
    user_id: userId,
    league_id: leagueId,
    role,
  });
  if (error) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Přidání selhalo: ' + error.message)}`, 303);
  }
  return redirect(`/admin/users/${userId}?saved=league_membership_added`, 303);
};
