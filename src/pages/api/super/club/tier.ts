import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_TIERS = ['trial', 'tym', 'klub', 'liga'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) {
    return redirect('/app', 303);
  }
  const form = await request.formData();
  const clubId = String(form.get('club_id') ?? '').trim();
  const tier   = String(form.get('tier') ?? '').trim();
  if (!clubId || !VALID_TIERS.includes(tier)) {
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent('Neplatný tier.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from('clubs')
    .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
    .eq('id', clubId);
  if (error) {
    return redirect(`/admin/clubs/${clubId}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`/admin/clubs/${clubId}?saved=1`, 303);
};
