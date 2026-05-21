import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings/teams', 303);

  const form = await request.formData();
  const teamId = String(form.get('id') ?? '').trim();
  const action = String(form.get('action') ?? 'toggle').trim(); // 'archive' | 'unarchive' | 'toggle'

  if (!teamId) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Chybí ID týmu.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify team + admin role on its club
  const { data: teamRow } = await admin
    .from('teams')
    .select('id, club_id, is_archived')
    .eq('id', teamId)
    .maybeSingle();
  if (!teamRow) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Tým neexistuje.')}`, 303);
  }

  const { data: membership } = await admin
    .from('club_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('club_id', teamRow.club_id)
    .maybeSingle();
  if (!membership || membership.role !== 'admin') {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Pouze Admin může archivovat týmy.')}`, 303);
  }

  // Guard: don't allow archiving the last active team
  if (!teamRow.is_archived) {
    const { count: activeCount } = await admin
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', teamRow.club_id)
      .eq('is_archived', false);
    if ((activeCount ?? 0) <= 1) {
      return redirect(`/app/settings/teams?error=${encodeURIComponent('Nelze archivovat poslední aktivní tým. Musí existovat alespoň jeden.')}`, 303);
    }
  }

  const newValue = action === 'archive' ? true
                 : action === 'unarchive' ? false
                 : !teamRow.is_archived;

  const { error } = await admin.from('teams').update({
    is_archived: newValue,
    updated_at: new Date().toISOString(),
  }).eq('id', teamId);

  if (error) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Akce se nepodařila: ' + error.message)}`, 303);
  }

  return redirect(`/app/settings/teams?saved=${newValue ? 'archived' : 'unarchived'}`, 303);
};
