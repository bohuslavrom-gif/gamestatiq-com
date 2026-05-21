/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_ROLE_KEY: string;
  readonly STRIPE_PUBLISHABLE_KEY: string;
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_PRICE_KLUB: string;
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
  }
}
