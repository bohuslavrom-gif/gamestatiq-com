import { defineMiddleware } from 'astro:middleware';
import { getSupabase, getSupabaseAdmin } from './lib/supabase';
import { listTeamsForUser, pickCurrentTeam, setTeamCookie, getTeamCookie } from './lib/teams';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/liga-signup',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/signup-liga',
  '/api/auth/logout',
  '/api/stripe/webhook',
];

function isProtected(pathname: string) {
  return pathname === '/app' || pathname.startsWith('/app/');
}

function isLeaguePage(pathname: string) {
  return pathname === '/app/league' || pathname.startsWith('/app/league/');
}

/** Routes that need ctx.locals.team resolved (broader than auth-protected). */
function needsTeamContext(pathname: string) {
  return isProtected(pathname)
    || pathname.startsWith('/api/club/')
    || pathname.startsWith('/api/admin/');
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
  if (user && (url.pathname === '/login' || url.pathname === '/signup' || url.pathname === '/liga-signup')) {
    return ctx.redirect('/app', 302);
  }

  // ── Iter 5a + 5b: resolve league context for league members ──
  // Attach league + membership role to locals for /app/league/* pages AND
  // /api/league/* endpoints (so league admin POST handlers know which league
  // the request belongs to).
  const needsLeagueCtx = isProtected(url.pathname) || url.pathname.startsWith('/api/league/');
  if (user && needsLeagueCtx) {
    try {
      const admin = getSupabaseAdmin();
      const { data: lm } = await admin
        .from('league_members')
        .select('league_id, role, leagues(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (lm) {
        ctx.locals.league = (lm as any).leagues ?? null;
        ctx.locals.leagueRole = (lm as { role: string }).role;
      }
    } catch (e) {
      // Defensive — don't block request if league lookup fails
      console.warn('[middleware] league lookup failed', e);
    }

    // If user is league-only (no club membership) and visits /app root,
    // redirect to /app/league as their natural landing page.
    if (ctx.locals.league && url.pathname === '/app') {
      const { data: cm } = await getSupabaseAdmin()
        .from('club_members')
        .select('club_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!cm) {
        return ctx.redirect('/app/league', 302);
      }
    }
  }

  // ── Multi-team Iter 2 (+ Iter 3 fix): resolve current team for /app/* AND /api/club/* ──
  // /api/club/* needs team context so player/team create endpoints know which team to
  // attach the new row to. Without this, POST handlers fell back to the default
  // (oldest) team, which broke "add player to Ženy team" UX (Bug 2).
  if (user && needsTeamContext(url.pathname)) {
    const teams = await listTeamsForUser(user.id);
    // For form POSTs, the team id is most reliably in the Referer's query string
    // (browser doesn't carry the page's ?team=<id> to the POST action). Cookie covers
    // the case where the user navigated through the sidebar (we set cookie there).
    const requestedTeamId =
      url.searchParams.get('team')
      || (() => {
          const ref = ctx.request.headers.get('referer');
          if (!ref) return null;
          try { return new URL(ref).searchParams.get('team'); } catch { return null; }
        })();
    const cookieTeamId = getTeamCookie(ctx.cookies);
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
