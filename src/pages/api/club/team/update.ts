import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_CATEGORIES = ['men', 'women', 'u18', 'u15', 'u12', 'mixed', ''];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings/teams', 303);

  const form = await request.formData();
  const teamId    = String(form.get('id')        ?? '').trim();
  const name      = String(form.get('name')      ?? '').trim();
  const category  = String(form.get('category')  ?? '').trim().toLowerCase();
  const sport     = String(form.get('sport')     ?? 'flag-football').trim();
  const season    = String(form.get('season')    ?? '2026').trim();
  const primary   = String(form.get('primary')   ?? '#0F1B2D').trim();
  const secondary = String(form.get('secondary') ?? '#E63946').trim();

  if (!teamId) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Chybí ID týmu.')}`, 303);
  }
  if (!name) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Název je povinný.')}`, 303);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Neplatná kategorie.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify user is admin of the team's club
  const { data: teamRow } = await admin
    .from('teams')
    .select('id, club_id')
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
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Pouze Admin může upravovat týmy.')}`, 303);
  }

  const { error } = await admin.from('teams').update({
    name,
    category: category || null,
    sport,
    season,
    primary_color: primary,
    secondary_color: secondary,
    updated_at: new Date().toISOString(),
  }).eq('id', teamId);

  if (error) {
    const msg = error.code === '23505'
      ? 'Tým s tímto názvem už v klubu existuje.'
      : 'Tým se nepodařil uložit: ' + error.message;
    return redirect(`/app/settings/teams?error=${encodeURIComponent(msg)}`, 303);
  }

  return redirect('/app/settings/teams?saved=updated', 303);
};
