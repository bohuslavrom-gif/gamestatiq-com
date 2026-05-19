import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../../lib/supabase';

export const prerender = false;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/players', 303);

  const form = await request.formData();
  const playerId = String(form.get('player_id') ?? '').trim();
  const file = form.get('photo') as File | null;

  if (!playerId) return redirect(`/app/players?error=${encodeURIComponent('Chybí ID hráče.')}`, 303);
  if (!file || !(file instanceof File) || file.size === 0) {
    return redirect(`/app/players?error=${encodeURIComponent('Vyberte soubor.')}`, 303);
  }
  if (file.size > MAX) return redirect(`/app/players?error=${encodeURIComponent('Max 5 MB.')}`, 303);
  if (!ALLOWED.includes(file.type)) return redirect(`/app/players?error=${encodeURIComponent('Povolené: JPG, PNG, WebP.')}`, 303);

  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from('players')
    .select('id, club_id, photo_url')
    .eq('id', playerId)
    .maybeSingle();
  if (!player) return redirect(`/app/players?error=${encodeURIComponent('Hráč nenalezen.')}`, 303);

  const { data: membership } = await admin
    .from('club_members')
    .select('role')
    .eq('club_id', player.club_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || !['admin', 'coach'].includes(membership.role)) {
    return redirect(`/app/players?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${player.club_id}/${player.id}_${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from('player-photos').upload(path, buf, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) return redirect(`/app/players?error=${encodeURIComponent('Upload selhal: ' + upErr.message)}`, 303);

  const { data: { publicUrl } } = admin.storage.from('player-photos').getPublicUrl(path);

  // Delete old photo
  if (player.photo_url) {
    try {
      const oldPath = player.photo_url.split('/player-photos/')[1];
      if (oldPath) await admin.storage.from('player-photos').remove([oldPath]);
    } catch {}
  }

  await admin.from('players').update({ photo_url: publicUrl }).eq('id', player.id);
  return redirect('/app/players?saved=photo', 303);
};
