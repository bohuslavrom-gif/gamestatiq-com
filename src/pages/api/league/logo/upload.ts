import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const MAX = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/settings', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin') {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může měnit logo.')}`, 303);
  }

  const form = await request.formData();
  const file = form.get('logo') as File | null;
  if (!file || !(file instanceof File) || file.size === 0) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Vyberte soubor.')}`, 303);
  }
  if (file.size > MAX) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Max 5 MB.')}`, 303);
  }
  if (!ALLOWED.includes(file.type)) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Povolené formáty: SVG, PNG, JPG, WebP.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${league.id}/logo_${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from('league-assets').upload(path, buf, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Upload selhal: ' + upErr.message)}`, 303);
  }

  const { data: { publicUrl } } = admin.storage.from('league-assets').getPublicUrl(path);

  // Try to delete old logo if it was stored in our bucket
  if (league.logo_url) {
    try {
      const oldPath = league.logo_url.split('/league-assets/')[1];
      if (oldPath) await admin.storage.from('league-assets').remove([oldPath]);
    } catch {
      // ignore — old URL may be external
    }
  }

  await admin.from('leagues').update({ logo_url: publicUrl }).eq('id', league.id);
  return redirect('/app/league/settings?saved=logo', 303);
};
