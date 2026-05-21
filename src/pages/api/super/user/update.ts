import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const userId    = String(form.get('user_id') ?? '').trim();
  const email     = String(form.get('email') ?? '').trim().toLowerCase();
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName  = String(form.get('last_name') ?? '').trim();

  if (!userId) {
    return redirect('/admin/users?error=missing_id', 303);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Neplatný e-mail.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Update auth.users email if changed
  if (email) {
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, { email });
    if (authErr) {
      return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Změna e-mailu selhala: ' + authErr.message)}`, 303);
    }
  }

  // Update profiles
  await admin.from('profiles').upsert({
    id: userId,
    email: email || undefined,
    first_name: firstName || null,
    last_name: lastName || null,
  });

  return redirect(`/admin/users/${userId}?saved=updated`, 303);
};
