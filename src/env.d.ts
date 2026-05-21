/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly STRIPE_PUBLISHABLE_KEY: string;
  readonly STRIPE_SECRET_KEY: string;
  // Stripe price IDs (all optional — code falls back gracefully).
  // STRIPE_PRICE_KLUB is the legacy var (still works); STRIPE_PRICE_TYM is the
  // preferred new name once renamed in Vercel env settings.
  readonly STRIPE_PRICE_TYM?: string;
  readonly STRIPE_PRICE_KLUB?: string;
  readonly STRIPE_PRICE_KLUB_V2?: string;
  readonly STRIPE_PRICE_LIGA?: string;
  // Master admin allowlist (Iter 7) — comma-separated email addresses.
  readonly SUPER_ADMIN_EMAILS?: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    user: import('@supabase/supabase-js').User | null;
    supabase: ReturnType<typeof import('./lib/supabase').getSupabase>;
    /** All teams the user has access to (across their club memberships). Set on /app/* routes. */
    teams?: import('./lib/supabase').Team[];
    /** Currently selected team for this request. Resolved from ?team=<id>, cookie, or first team. */
    team?: import('./lib/supabase').Team | null;
    /** Iter 5: League context for league admin/staff users. */
    league?: import('./lib/supabase').League | null;
    leagueRole?: 'admin' | 'staff' | 'viewer';
    /** Iter 7: Super-admin flag — true on /admin/* and /api/super/* routes only. */
    isSuperAdmin?: boolean;
  }
}
