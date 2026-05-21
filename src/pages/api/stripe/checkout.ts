import type { APIRoute } from 'astro';
import { stripe, TIER_TO_PRICE } from '../../../lib/stripe';
import { getSupabaseAdmin } from '../../../lib/supabase';
import { publicOrigin } from '../../../lib/url';

export const prerender = false;

const SELF_SERVE_TIERS = new Set(['tym', 'klub', 'liga']);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/billing', 303);

  const form = await request.formData();
  const tier = String(form.get('tier') ?? 'tym');

  if (!SELF_SERVE_TIERS.has(tier)) {
    return redirect(`/app/billing?error=${encodeURIComponent('Neplatný plán.')}`, 303);
  }
  const priceId = TIER_TO_PRICE[tier];
  if (!priceId) {
    return redirect(`/app/billing?error=${encodeURIComponent('Tento plán zatím nemá Stripe price — kontaktujte sales.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('id, stripe_customer_id, name')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) {
    return redirect(`/app/billing?error=${encodeURIComponent('Klub nenalezen.')}`, 303);
  }

  let customerId = club.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: club.name,
      metadata: { club_id: club.id, user_id: user.id },
    });
    customerId = customer.id;
    await admin.from('clubs').update({ stripe_customer_id: customerId }).eq('id', club.id);
  }

  const origin = publicOrigin(request);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/app/billing?checkout=success`,
    cancel_url:  `${origin}/app/billing?checkout=cancel`,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    metadata: { club_id: club.id, user_id: user.id, tier },
    subscription_data: {
      metadata: { club_id: club.id, tier },
      trial_period_days: 30,
    },
  });

  if (!session.url) {
    return redirect(`/app/billing?error=${encodeURIComponent('Stripe nevrátil checkout URL.')}`, 303);
  }
  return redirect(session.url, 303);
};
