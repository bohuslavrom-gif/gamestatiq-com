import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { isSuperAdmin } from '../../../../lib/admin';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const userId = String(form.get('user_id') ?? '').trim();
  if (!userId) {
    return redirect('/admin/users?error=missing_id', 303);
  }

  // Safety: can't delete yourself
  if (userId === locals.user?.id) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Nelze smazat sám sebe. Použijte jiný super-admin účet.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Safety: can't delete another super admin via UI (must be removed from env first)
  const { data: targetProfile } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
  if (targetProfile && isSuperAdmin({ email: (targetProfile as { email: string }).email })) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Nelze smazat super-admin uživatele. Nejdřív odeberte e-mail ze SUPER_ADMIN_EMAILS env var.')}`, 303);
  }

  // Delete auth user — cascading rows (profiles, club_members, league_members) via FK
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Smazání selhalo: ' + error.message)}`, 303);
  }

  // Defensive cleanup if profile FK doesn't cascade
  try { await admin.from('profiles').delete().eq('id', userId); } catch {}

  return redirect('/admin/users?saved=deleted', 303);
};
