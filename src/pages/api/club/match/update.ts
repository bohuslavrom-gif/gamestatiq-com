import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const NUMERIC_FIELDS = [
  'our_score', 'opp_score',
  'rush_yds', 'pass_yds', 'total_yds',
  'off_drives', 'off_td',
  'qb_att', 'qb_comp', 'qb_td', 'qb_int', 'qb_yds',
  'xp1_att', 'xp1_ok', 'xp2_att', 'xp2_ok',
  // Iter 24: soupeřovy XP konverze (defense — kolik soupeř proměnil)
  'opp_xp1_att', 'opp_xp1_ok', 'opp_xp2_att', 'opp_xp2_ok',
  'def_drives', 'def_stops',
  'opp_rush_yds', 'opp_pass_yds', 'opp_total_yds',
  'pen_count', 'pen_yds',
];

// Editor roles allowed to update match-level fields
const EDIT_ROLES = new Set(['admin', 'coach', 'stats']);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/matches', 303);

  const form = await request.formData();
  const matchId = String(form.get('match_id') ?? '').trim();
  if (!matchId) {
    return redirect('/app/matches?error=missing_id', 303);
  }

  const admin = getSupabaseAdmin();

  // Verify match belongs to a club the user is a member of (with edit role)
  const { data: match } = await admin
    .from('matches')
    .select('id, club_id')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) {
    return redirect(`/app/matches?error=${encodeURIComponent('Zápas neexistuje.')}`, 303);
  }
  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('club_id', (match as { club_id: string }).club_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!cm || !EDIT_ROLES.has((cm as { role: string }).role)) {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent('Bez oprávnění (vyžaduje Admin / Trenér / Statistik).')}`, 303);
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  const date = String(form.get('date') ?? '').trim();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) updates.date = date;
  const opponent = String(form.get('opponent') ?? '').trim();
  if (opponent) updates.opponent = opponent;

  for (const k of NUMERIC_FIELDS) {
    const raw = form.get(k);
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s === '') continue;
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0) updates[k] = n;
  }

  const { error } = await admin.from('matches').update(updates).eq('id', matchId);
  if (error) {
    return redirect(`/app/matches/${matchId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/app/matches/${matchId}?saved=1`, 303);
};
