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

// Stripe price IDs per tier (post tier-rename).
//
// Backward compatibility: the existing Vercel env var STRIPE_PRICE_KLUB
// holds the 690 Kč/měs price ID. Under the new tier semantics that's the
// "Tým" tier. We read STRIPE_PRICE_TYM first (preferred new name), then
// fall back to STRIPE_PRICE_KLUB (legacy). This means renaming the Vercel
// env var is optional — code works either way.
//
// STRIPE_PRICE_KLUB_V2 / STRIPE_PRICE_LIGA = NEW plans (multi-team Klub,
// federation Liga) — will be configured in Stripe when those tiers launch.
export const STRIPE_PRICE_TYM =
  import.meta.env.STRIPE_PRICE_TYM
  ?? import.meta.env.STRIPE_PRICE_KLUB  // legacy fallback (same price, old name)
  ?? '';
export const STRIPE_PRICE_KLUB = import.meta.env.STRIPE_PRICE_KLUB_V2 ?? '';
export const STRIPE_PRICE_LIGA = import.meta.env.STRIPE_PRICE_LIGA ?? '';
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.STRIPE_PUBLISHABLE_KEY!;
export const STRIPE_WEBHOOK_SECRET = import.meta.env.STRIPE_WEBHOOK_SECRET ?? '';

export const TIER_TO_PRICE: Record<string, string | undefined> = {
  tym:  STRIPE_PRICE_TYM,
  klub: STRIPE_PRICE_KLUB,
  liga: STRIPE_PRICE_LIGA,
};
