import { defineMiddleware } from 'astro:middleware';
import { getSupabase } from './lib/supabase';
import { listTeamsForUser, pickCurrentTeam, setTeamCookie, getTeamCookie } from './lib/teams';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/stripe/webhook',
];

function isProtected(pathname: string) {
  return pathname === '/app' || pathname.startsWith('/app/');
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  const supabase = getSupabase(ctx.cookies, ctx.request.headers);

  // Touch session — refreshes cookies if needed
  const { data: { user } } = await supabase.auth.getUser();

  // Attach to locals so pages/endpoints can read without re-instantiating
  ctx.locals.user = user ?? null;
  ctx.locals.supabase = supabase;

  const url = new URL(ctx.request.url);

  // Auth guard on /app/*
  if (isProtected(url.pathname) && !user) {
    const next_url = url.pathname + url.search;
    return ctx.redirect(`/login?next=${encodeURIComponent(next_url)}`, 302);
  }

  // Logged-in users bounced away from auth pages
  if (user && (url.pathname === '/login' || url.pathname === '/signup')) {
    return ctx.redirect('/app', 302);
  }

  // ── Multi-team Iter 2: resolve current team for /app/* requests ──
  if (user && isProtected(url.pathname)) {
    const teams = await listTeamsForUser(user.id);
    const requestedTeamId = url.searchParams.get('team');
    const cookieTeamId    = getTeamCookie(ctx.cookies);
    const team = pickCurrentTeam(teams, requestedTeamId, cookieTeamId);

    ctx.locals.teams = teams;
    ctx.locals.team  = team;

    // Persist explicit selection across requests
    if (requestedTeamId && team && team.id === requestedTeamId && cookieTeamId !== team.id) {
      setTeamCookie(ctx.cookies, team.id);
    }
  }

  return next();
});
