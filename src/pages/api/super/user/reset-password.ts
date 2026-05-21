import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const userId   = String(form.get('user_id') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!userId || !password) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Heslo je povinné.')}`, 303);
  }
  if (password.length < 8) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Heslo musí mít alespoň 8 znaků.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    return redirect(`/admin/users/${userId}?error=${encodeURIComponent('Změna hesla selhala: ' + error.message)}`, 303);
  }

  return redirect(`/admin/users/${userId}?saved=password`, 303);
};
