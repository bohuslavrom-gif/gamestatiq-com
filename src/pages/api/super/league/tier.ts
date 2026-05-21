import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_TIERS = ['klub', 'liga'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);
  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const tier     = String(form.get('tier') ?? '').trim();
  if (!leagueId || !VALID_TIERS.includes(tier)) {
    return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent('Neplatný tier.')}`, 303);
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('leagues').update({ subscription_tier: tier, updated_at: new Date().toISOString() }).eq('id', leagueId);
  if (error) return redirect(`/admin/leagues/${leagueId}?error=${encodeURIComponent(error.message)}`, 303);
  return redirect(`/admin/leagues/${leagueId}?saved=1`, 303);
};
