import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_SPORTS = ['flag-football', 'american_football', 'football', 'basketball', 'volleyball', 'hockey', 'other'];
const VALID_CATEGORIES = ['men', 'women', 'u18', 'u15', 'u12', 'mixed', ''];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const clubId    = String(form.get('club_id') ?? '').trim();
  const name      = String(form.get('name') ?? '').trim();
  const sport     = String(form.get('sport') ?? 'flag-football').trim();
  const category  = String(form.get('category') ?? '').trim().toLowerCase();
  const season    = String(form.get('season') ?? '2026').trim();

  if (!clubId || !name) {
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent('Chybí název týmu nebo club_id.')}`, 303);
  }
  if (!VALID_SPORTS.includes(sport)) {
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent('Neplatný sport.')}`, 303);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent('Neplatná kategorie.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: team, error } = await admin
    .from('teams')
    .insert({
      club_id: clubId,
      name,
      sport,
      category: category || null,
      season,
    })
    .select('id')
    .single();

  if (error || !team) {
    const msg = error?.code === '23505'
      ? 'Tým s tímto názvem už v klubu existuje.'
      : 'Tým se nepodařilo vytvořit: ' + (error?.message ?? '');
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent(msg)}`, 303);
  }

  return redirect(`/admin/teams/${team.id}?saved=1`, 303);
};
