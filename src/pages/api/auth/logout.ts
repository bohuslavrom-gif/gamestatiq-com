import type { APIRoute } from 'astro';
import { getSupabase } from '../../../lib/supabase';

export const prerender = false;

const handler: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = getSupabase(cookies, request.headers);
  await supabase.auth.signOut();
  return redirect('/', 303);
};

export const GET = handler;
export const POST = handler;
