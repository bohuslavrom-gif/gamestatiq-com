import type { APIRoute } from 'astro';
import { stripe } from '../../../lib/stripe';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { publicOrigin } from '../../../lib/url';

export const prerender = false;

const handler: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/billing', 303);

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('stripe_customer_id')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club?.stripe_customer_id) {
    return redirect(`/app/billing?error=${encodeURIComponent('Nejdřív aktivujte předplatné.')}`, 303);
  }

  const origin = publicOrigin(request);
  const session = await stripe.billingPortal.sessions.create({
    customer: club.stripe_customer_id,
    return_url: `${origin}/app/billing`,
  });

  return redirect(session.url, 303);
};

export const GET = handler;
export const POST = handler;
