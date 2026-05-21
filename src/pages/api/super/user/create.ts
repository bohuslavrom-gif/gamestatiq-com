import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const email     = String(form.get('email') ?? '').trim().toLowerCase();
  const password  = String(form.get('password') ?? '');
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName  = String(form.get('last_name') ?? '').trim();
  const emailConfirm = form.get('email_confirm') === '1';

  if (!email || !password) {
    return redirect(`/admin/users/new?error=${encodeURIComponent('E-mail a heslo jsou povinné.')}`, 303);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return redirect(`/admin/users/new?error=${encodeURIComponent('Neplatný formát e-mailu.')}`, 303);
  }
  if (password.length < 8) {
    return redirect(`/admin/users/new?error=${encodeURIComponent('Heslo musí mít alespoň 8 znaků.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Create auth user (skip email confirmation if checkbox checked — super admin bypass)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: emailConfirm,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (error || !data?.user) {
    return redirect(`/admin/users/new?error=${encodeURIComponent('Vytvoření selhalo: ' + (error?.message ?? 'unknown'))}`, 303);
  }

  // Ensure profile row exists (auth trigger may handle it, but defensive upsert)
  await admin.from('profiles').upsert({
    id: data.user.id,
    email,
    first_name: firstName || null,
    last_name: lastName || null,
  });

  return redirect(`/admin/users/${data.user.id}?saved=created`, 303);
};
