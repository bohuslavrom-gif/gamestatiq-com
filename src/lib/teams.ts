// Team resolution helpers — shared across middleware + pages.
//
// A user can belong (via club_members) to one club. That club has 1..N teams.
// "Current team" is resolved per request:
//   1. ?team=<uuid> query param — validated against accessible teams
//   2. cookie 'gs_team'         — last picked team (across requests)
//   3. fallback                  — first team (oldest created_at) for the user's club
//
// Result is attached to Astro.locals.team so every page/route reads it the same way.

import type { AstroCookies } from 'astro';
import { getSupabaseAdmin, type Team } from './supabase';

const COOKIE_NAME = 'gs_team';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/**
 * List all teams the user can access (via their club_members memberships).
 * Returns teams across all clubs the user belongs to — currently we only have
 * 1 club per user, but the schema supports more.
 */
export async function listTeamsForUser(userId: string): Promise<Team[]> {
  if (!userId) return [];
  const admin = getSupabaseAdmin();

  // 1. Resolve club_id(s) via club_members
  const { data: memberships } = await admin
    .from('club_members')
    .select('club_id')
    .eq('user_id', userId);
  if (!memberships || memberships.length === 0) return [];

  const clubIds = (memberships as { club_id: string }[]).map((m) => m.club_id);

  // 2. Fetch teams for those clubs (non-archived first, then archived at end)
  const { data: teams } = await admin
    .from('teams')
    .select('*')
    .in('club_id', clubIds)
    .order('is_archived', { ascending: true })
    .order('created_at', { ascending: true });

  return (teams ?? []) as Team[];
}

/**
 * Pick the team for this request. Resolution order:
 *   1. requestedTeamId (from ?team=<id>) if valid and accessible
 *   2. cookieTeamId (from 'gs_team' cookie) if valid and accessible
 *   3. first non-archived team
 *   4. first team (even if archived)
 *   5. null (user has no teams — shouldn't happen post-Iter 1 backfill)
 */
export function pickCurrentTeam(
  teams: Team[],
  requestedTeamId: string | null,
  cookieTeamId: string | null,
): Team | null {
  if (teams.length === 0) return null;

  const findById = (id: string | null) => id ? teams.find((t) => t.id === id) : null;

  const requested = findById(requestedTeamId);
  if (requested) return requested;

  const cookied = findById(cookieTeamId);
  if (cookied) return cookied;

  const active = teams.find((t) => !t.is_archived);
  if (active) return active;

  return teams[0];
}

/**
 * Set the team cookie so the next request remembers the choice.
 * Called only when user navigated via ?team=<id> (not on every request).
 */
export function setTeamCookie(cookies: AstroCookies, teamId: string) {
  cookies.set(COOKIE_NAME, teamId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: COOKIE_MAX_AGE,
  });
}

export function getTeamCookie(cookies: AstroCookies): string | null {
  return cookies.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Build a URL preserving the ?team=<id> param. Pages should use this
 * helper for internal links so team selection persists across navigation.
 */
export function withTeamParam(href: string, teamId: string | null): string {
  if (!teamId) return href;
  const [path, query] = href.split('?');
  const params = new URLSearchParams(query ?? '');
  if (!params.has('team')) params.set('team', teamId);
  return params.toString() ? `${path}?${params.toString()}` : path;
}

// ── Tier limits ──────────────────────────────────────────────────
// DB enum values (post tier-rename migration) match UI labels 1:1:
//   'trial' → Trial (3 teams during trial)
//   'tym'   → Tým  (1 team)
//   'klub'  → Klub (unlimited teams within 1 club)
//   'liga'  → Liga (cross-club / federation tier on clubs is a legacy edge;
//                   leagues table uses 'klub'|'liga' for league subscription itself)
export const TEAM_LIMIT_BY_TIER: Record<string, number> = {
  trial: 3,
  tym:   1,
  klub:  Infinity,
  liga:  Infinity,
};

export function teamLimitForTier(tier: string | null | undefined): number {
  if (!tier) return 1;
  return TEAM_LIMIT_BY_TIER[tier] ?? 1;
}

export type TierLabel = { code: string; label: string; teamLimit: number | 'unlimited' };
export const TIER_LABELS: Record<string, TierLabel> = {
  trial: { code: 'trial', label: 'Trial', teamLimit: 3 },
  tym:   { code: 'tym',   label: 'Tým',   teamLimit: 1 },
  klub:  { code: 'klub',  label: 'Klub',  teamLimit: 'unlimited' },
  liga:  { code: 'liga',  label: 'Liga',  teamLimit: 'unlimited' },
};
