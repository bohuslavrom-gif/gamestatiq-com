import type { APIRoute } from 'astro';
import { getSupabase } from '../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/app');

  if (!email || !password) {
    return redirect(`/login?error=${encodeURIComponent('Vyplňte e-mail i heslo.')}`, 303);
  }

  const supabase = getSupabase(cookies, request.headers);
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`, 303);
  }

  return redirect(next.startsWith('/') ? next : '/app', 303);
};
