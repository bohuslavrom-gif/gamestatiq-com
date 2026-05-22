import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/records', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) return redirect('/app?error=no_league', 303);
  if (role !== 'admin' && role !== 'staff') {
    return redirect(`/app/league/records?error=${encodeURIComponent('Bez oprávnění.')}`, 303);
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return redirect('/app/league/records?error=missing_id', 303);

  const admin = getSupabaseAdmin();
  const { data: rec } = await admin.from('league_records').select('league_id, record_type').eq('id', id).maybeSingle();
  if (!rec || (rec as { league_id: string }).league_id !== league.id) {
    return redirect(`/app/league/records?error=${encodeURIComponent('Rekord neexistuje.')}`, 303);
  }
  const tab = ((rec as any).record_type as string) ?? 'career';
  const { error } = await admin.from('league_records').delete().eq('id', id);
  if (error) {
    return redirect(`/app/league/records?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/app/league/records?tab=${tab}&saved=deleted`, 303);
};
