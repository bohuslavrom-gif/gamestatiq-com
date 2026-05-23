import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/records', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin' && role !== 'staff') {
    return redirect(`/app/league/records?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }

  const form = await request.formData();
  const id          = String(form.get('id') ?? '').trim();
  const recordType  = String(form.get('record_type') ?? 'career').trim();
  const category    = String(form.get('category') ?? '').trim();
  const playerName  = String(form.get('player_name') ?? '').trim();
  const jerseyRaw   = String(form.get('jersey') ?? '').trim();
  const teamName    = String(form.get('team_name') ?? '').trim();
  const clubName    = String(form.get('club_name') ?? '').trim();
  let   photoUrl    = String(form.get('photo_url') ?? '').trim();
  const valueRaw    = String(form.get('value') ?? '').trim();
  const seasonRange = String(form.get('season_range') ?? '').trim();
  const notes       = String(form.get('notes') ?? '').trim();

  if (!id || !category || !playerName || !valueRaw) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Chybí povinná pole.')}`, 303);
  }
  if (!['season', 'career'].includes(recordType)) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Neplatný typ rekordu.')}`, 303);
  }
  const value = parseInt(valueRaw, 10);
  if (isNaN(value) || value < 0) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Neplatná hodnota.')}`, 303);
  }
  let jersey: number | null = null;
  if (jerseyRaw) {
    const n = parseInt(jerseyRaw, 10);
    if (!isNaN(n) && n >= 0 && n <= 999) jersey = n;
  }

  const admin = getSupabaseAdmin();
  // Verify record belongs to user's league
  const { data: rec } = await admin.from('league_records').select('league_id, photo_url').eq('id', id).maybeSingle();
  if (!rec || (rec as { league_id: string }).league_id !== league.id) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Rekord neexistuje nebo není ze stejné ligy.')}`, 303);
  }
  const oldPhotoUrl = (rec as { photo_url: string | null }).photo_url;

  // Optional file upload — overrides photoUrl if a file is provided
  const photoFile = form.get('photo_file') as File | null;
  if (photoFile && photoFile instanceof File && photoFile.size > 0) {
    const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
    const MAX = 5 * 1024 * 1024;
    if (photoFile.size > MAX) {
      return redirect(`/app/league/records?error=${encodeURIComponent('Foto max 5 MB.')}`, 303);
    }
    if (!ALLOWED.includes(photoFile.type)) {
      return redirect(`/app/league/records?error=${encodeURIComponent('Foto: povolené SVG, PNG, JPG, WebP.')}`, 303);
    }
    const ext = (photoFile.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${league.id}/records/photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = new Uint8Array(await photoFile.arrayBuffer());
    const { error: upErr } = await admin.storage.from('league-assets').upload(path, buf, {
      contentType: photoFile.type, cacheControl: '3600', upsert: false,
    });
    if (upErr) {
      return redirect(`/app/league/records?error=${encodeURIComponent('Upload fotky selhal: ' + upErr.message)}`, 303);
    }
    const { data: { publicUrl } } = admin.storage.from('league-assets').getPublicUrl(path);
    photoUrl = publicUrl;

    // Delete old photo if it was in our bucket
    if (oldPhotoUrl) {
      try {
        const oldPath = oldPhotoUrl.split('/league-assets/')[1];
        if (oldPath) await admin.storage.from('league-assets').remove([oldPath]);
      } catch {
        // ignore — old URL may be external
      }
    }
  }

  const { error } = await admin.from('league_records').update({
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
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  if (error) {
    return redirect(`/app/league/records?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/app/league/records?tab=${recordType}&saved=updated`, 303);
};
