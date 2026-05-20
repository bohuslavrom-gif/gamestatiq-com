// Supabase server helpers for Astro SSR with cookie-based sessions.
import { createServerClient, type CookieOptionsWithName } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

const SUPABASE_URL = import.meta.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = import.meta.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] SUPABASE_URL or SUPABASE_ANON_KEY is missing in env');
}

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use inside Astro pages (`---` block) and API routes.
 */
export function getSupabase(cookies: AstroCookies, headers: Headers) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const all: { name: string; value: string }[] = [];
        for (const [name] of Object.entries(cookies as unknown as Record<string, unknown>)) {
          const c = cookies.get(name);
          if (c) all.push({ name, value: c.value });
        }
        // Fallback: parse `Cookie` header directly (Astro's cookies API doesn't always enumerate)
        const cookieHeader = headers.get('cookie') ?? '';
        if (cookieHeader && all.length === 0) {
          for (const part of cookieHeader.split(';')) {
            const [n, ...v] = part.trim().split('=');
            if (n) all.push({ name: n, value: decodeURIComponent(v.join('=')) });
          }
        }
        return all;
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, asAstroCookieOptions(options));
        }
      },
    },
  });
}

/**
 * Admin client (server-only). Uses service_role key — never expose to browser.
 * Used in webhook handlers and admin operations that bypass RLS.
 */
export function getSupabaseAdmin() {
  return createServerClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll: () => [],
      setAll: () => undefined,
    },
  });
}

function asAstroCookieOptions(o: CookieOptionsWithName | undefined) {
  if (!o) return undefined;
  return {
    domain: o.domain,
    expires: o.expires,
    httpOnly: o.httpOnly,
    maxAge: o.maxAge,
    path: o.path,
    sameSite: o.sameSite as 'lax' | 'strict' | 'none' | undefined,
    secure: o.secure,
  };
}

export type Tier = 'trial' | 'klub' | 'liga' | 'federace';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';

export type Club = {
  id: string;
  name: string;
  slug: string;
  sport: string | null;
  founded_year: number | null;
  description: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  custom_domain: string | null;
  owner_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_tier: Tier;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at: string;
};

// ── Multi-team schema (Iter 1) ─────────────────────────────────

export type TeamCategory = 'men' | 'women' | 'u18' | 'u15' | 'u12' | 'mixed' | string;

export type Team = {
  id: string;
  club_id: string;
  name: string;
  category: TeamCategory | null;
  sport: string;
  season: string;
  is_archived: boolean;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
};

export type LeagueTier = 'liga' | 'federace';

export type League = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  owner_user_id: string | null;
  subscription_tier: LeagueTier;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LeagueTeam = {
  league_id: string;
  team_id: string;
  invited_by: string | null;
  invited_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

export type LeagueMember = {
  id: string;
  league_id: string;
  user_id: string;
  role: 'admin' | 'staff' | 'viewer';
  created_at: string;
};
