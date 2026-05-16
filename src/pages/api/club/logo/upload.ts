import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const MAX = 5 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const form = await request.formData();
  const file = form.get('logo') as File | null;
  if (!file || !(file instanceof File) || file.size === 0) {
    return redirect(`/app/settings?error=${encodeURIComponent('Vyberte soubor.')}`, 303);
  }
  if (file.size > MAX) return redirect(`/app/settings?error=${encodeURIComponent('Max 5 MB.')}`, 303);
  if (!ALLOWED.includes(file.type)) return redirect(`/app/settings?error=${encodeURIComponent('Povolené: SVG, PNG, JPG, WebP.')}`, 303);

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('id, logo_url')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!club) return redirect(`/app/settings?error=${encodeURIComponent('Klub nenalezen.')}`, 303);

  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${club.id}/logo_${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from('club-logos').upload(path, buf, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) return redirect(`/app/settings?error=${encodeURIComponent('Upload selhal: ' + upErr.message)}`, 303);

  const { data: { publicUrl } } = admin.storage.from('club-logos').getPublicUrl(path);

  // Try to delete old logo
  if (club.logo_url) {
    try {
      const oldPath = club.logo_url.split('/club-logos/')[1];
      if (oldPath) await admin.storage.from('club-logos').remove([oldPath]);
    } catch {}
  }

  await admin.from('clubs').update({ logo_url: publicUrl }).eq('id', club.id);
  return redirect('/app/settings?saved=logo', 303);
};
