import Stripe from 'stripe';

const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[stripe] STRIPE_SECRET_KEY missing — Stripe calls will fail');
}

export const stripe = new Stripe(STRIPE_SECRET_KEY ?? 'sk_test_missing', {
  apiVersion: '2025-09-30.clover',
  appInfo: { name: 'GameStatiq', version: '0.2.0' },
});

export const STRIPE_PRICE_KLUB = import.meta.env.STRIPE_PRICE_KLUB!;
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.STRIPE_PUBLISHABLE_KEY!;
export const STRIPE_WEBHOOK_SECRET = import.meta.env.STRIPE_WEBHOOK_SECRET ?? '';

export const TIER_TO_PRICE: Record<string, string | undefined> = {
  klub: STRIPE_PRICE_KLUB,
};
