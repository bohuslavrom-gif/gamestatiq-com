import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/players', 303);

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return redirect('/app/players', 303);

  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from('players')
    .select('id, club_id, photo_url')
    .eq('id', id)
    .maybeSingle();
  if (!player) return redirect('/app/players', 303);

  // Only admin can delete
  const { data: membership } = await admin
    .from('club_members')
    .select('role')
    .eq('club_id', player.club_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || membership.role !== 'admin') {
    return redirect(`/app/players?error=${encodeURIComponent('Smazat hráče může jen Admin.')}`, 303);
  }

  // Delete photo from Storage (best-effort)
  if (player.photo_url) {
    try {
      const oldPath = player.photo_url.split('/player-photos/')[1];
      if (oldPath) await admin.storage.from('player-photos').remove([oldPath]);
    } catch {}
  }

  await admin.from('players').delete().eq('id', id);
  return redirect('/app/players?saved=removed', 303);
};
