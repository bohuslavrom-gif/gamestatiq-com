import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('id, logo_url')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!club) return redirect(`/app/settings?error=${encodeURIComponent('Klub nenalezen.')}`, 303);

  if (club.logo_url) {
    try {
      const oldPath = club.logo_url.split('/club-logos/')[1];
      if (oldPath) await admin.storage.from('club-logos').remove([oldPath]);
    } catch {}
  }
  await admin.from('clubs').update({ logo_url: null }).eq('id', club.id);
  return redirect('/app/settings?saved=logo-removed', 303);
};
