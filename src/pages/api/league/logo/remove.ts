import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/settings', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin') {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může měnit logo.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Try to delete file from our bucket
  if (league.logo_url) {
    try {
      const oldPath = league.logo_url.split('/league-assets/')[1];
      if (oldPath) await admin.storage.from('league-assets').remove([oldPath]);
    } catch {
      // ignore
    }
  }

  await admin.from('leagues').update({ logo_url: null }).eq('id', league.id);
  return redirect('/app/league/settings?saved=logo_removed', 303);
};
