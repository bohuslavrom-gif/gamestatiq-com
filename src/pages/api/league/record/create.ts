import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/records', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) {
    return redirect(`/app?error=${encodeURIComponent('Nejste členem žádné ligy.')}`, 303);
  }
  if (role !== 'admin' && role !== 'staff') {
    return redirect(`/app/league/records?error=${encodeURIComponent('Pouze admin/staff ligy může editovat rekordy.')}`, 303);
  }

  const form = await request.formData();
  const recordType  = String(form.get('record_type') ?? 'career').trim();
  const category    = String(form.get('category') ?? '').trim();
  const playerName  = String(form.get('player_name') ?? '').trim();
  const jerseyRaw   = String(form.get('jersey') ?? '').trim();
  const teamName    = String(form.get('team_name') ?? '').trim();
  const clubName    = String(form.get('club_name') ?? '').trim();
  const photoUrl    = String(form.get('photo_url') ?? '').trim();
  const valueRaw    = String(form.get('value') ?? '').trim();
  const seasonRange = String(form.get('season_range') ?? '').trim();
  const notes       = String(form.get('notes') ?? '').trim();

  if (!['season', 'career'].includes(recordType)) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Neplatný typ rekordu.')}`, 303);
  }
  if (!category || !playerName || !valueRaw) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Kategorie, jméno a hodnota jsou povinné.')}`, 303);
  }
  const value = parseInt(valueRaw, 10);
  if (isNaN(value) || value < 0) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Hodnota musí být kladné celé číslo.')}`, 303);
  }
  let jersey: number | null = null;
  if (jerseyRaw) {
    const n = parseInt(jerseyRaw, 10);
    if (!isNaN(n) && n >= 0 && n <= 999) jersey = n;
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('league_records').insert({
    league_id: league.id,
    record_type: recordType,
    category,
    player_name: playerName,
    jersey,
    team_name: teamName || null,
    club_name: clubName || null,
    photo_url: photoUrl || null,
    value,
    season_range: seasonRange || null,
    notes: notes || null,
    created_by: user.id,
  });
  if (error) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Uložení selhalo: ' + error.message)}`, 303);
  }
  return redirect(`/app/league/records?tab=${recordType}&saved=created`, 303);
};
