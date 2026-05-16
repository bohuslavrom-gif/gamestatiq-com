import type { APIRoute } from 'astro';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../../../lib/stripe';
import { getSupabaseAdmin } from '../../../lib/supabase';
import type Stripe from 'stripe';

export const prerender = false;

type TierMap = Record<string, 'klub' | 'liga' | 'federace'>;

function priceIdToTier(priceId: string): 'klub' | 'liga' | 'federace' | null {
  const map: TierMap = {};
  if (import.meta.env.STRIPE_PRICE_KLUB)     map[import.meta.env.STRIPE_PRICE_KLUB]     = 'klub';
  if (import.meta.env.STRIPE_PRICE_LIGA)     map[import.meta.env.STRIPE_PRICE_LIGA]     = 'liga';
  if (import.meta.env.STRIPE_PRICE_FEDERACE) map[import.meta.env.STRIPE_PRICE_FEDERACE] = 'federace';
  return map[priceId] ?? null;
}

export const POST: APIRoute = async ({ request }) => {
  if (!STRIPE_WEBHOOK_SECRET) {
    return new Response('webhook secret not configured', { status: 500 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid signature';
    return new Response(`Webhook error: ${msg}`, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clubId = session.metadata?.club_id;
        if (clubId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const priceId = sub.items.data[0]?.price?.id ?? '';
          const tier = priceIdToTier(priceId) ?? 'klub';
          await admin.from('clubs').update({
            stripe_subscription_id: sub.id,
            subscription_tier: tier,
            subscription_status: sub.status,
            current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
          }).eq('id', clubId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const clubId = sub.metadata?.club_id;
        const priceId = sub.items.data[0]?.price?.id ?? '';
        const tier = priceIdToTier(priceId) ?? 'klub';
        if (clubId) {
          await admin.from('clubs').update({
            stripe_subscription_id: sub.id,
            subscription_tier: tier,
            subscription_status: sub.status,
            current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
          }).eq('id', clubId);
        } else if (sub.customer) {
          // Fallback by customer id
          await admin.from('clubs').update({
            stripe_subscription_id: sub.id,
            subscription_tier: tier,
            subscription_status: sub.status,
            current_period_end: new Date(sub.items.data[0].current_period_end * 1000).toISOString(),
          }).eq('stripe_customer_id', sub.customer as string);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await admin.from('clubs').update({
          subscription_status: 'canceled',
          subscription_tier: 'trial',
        }).eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.customer) {
          await admin.from('clubs').update({
            subscription_status: 'past_due',
          }).eq('stripe_customer_id', inv.customer as string);
        }
        break;
      }
    }
  } catch (err) {
    // Log but acknowledge — Stripe should not retry forever on our internal failures.
    // eslint-disable-next-line no-console
    console.error('[stripe webhook] handler error', err);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
