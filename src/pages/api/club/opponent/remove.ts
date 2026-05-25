import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/opponents', 303);

  const currentTeam = locals.team;
  if (!currentTeam) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Žádný aktivní tým.')}`, 303);
  }
  const clubId = currentTeam.club_id;

  const admin = getSupabaseAdmin();
  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('club_id', clubId)
    .maybeSingle();
  const role = (cm as { role: string } | null)?.role ?? null;
  if (role !== 'admin' && role !== 'coach') {
    return redirect(`/app/opponents?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return redirect('/app/opponents?error=missing_id', 303);

  const { data: existing } = await admin
    .from('opponents')
    .select('id, club_id, logo_url')
    .eq('id', id)
    .maybeSingle();
  if (!existing || (existing as { club_id: string }).club_id !== clubId) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Soupeř neexistuje.')}`, 303);
  }

  // Cleanup logo from storage
  const logoUrl = (existing as { logo_url: string | null }).logo_url;
  if (logoUrl) {
    try {
      const oldPath = logoUrl.split('/club-logos/')[1];
      if (oldPath) await admin.storage.from('club-logos').remove([oldPath]);
    } catch {}
  }

  const { error } = await admin.from('opponents').delete().eq('id', id);
  if (error) {
    return redirect(`/app/opponents?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect('/app/opponents?saved=deleted', 303);
};
