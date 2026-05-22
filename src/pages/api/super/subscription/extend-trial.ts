import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const entityType = String(form.get('entity_type') ?? '').trim(); // 'club' | 'league'
  const entityId   = String(form.get('entity_id') ?? '').trim();
  const daysRaw    = String(form.get('days') ?? '30').trim();
  const back       = String(form.get('back') ?? '/admin/subscriptions').trim();

  if (!entityId || !['club', 'league'].includes(entityType)) {
    return redirect(`${back}?error=missing`, 303);
  }
  const days = parseInt(daysRaw, 10);
  if (isNaN(days) || days < 1 || days > 365) {
    return redirect(`${back}?error=${encodeURIComponent('Počet dní musí být 1–365.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const table = entityType === 'club' ? 'clubs' : 'leagues';

  // Read current trial_ends_at — extend from latest of (now, current trial_ends_at)
  const { data: current } = await admin.from(table).select('trial_ends_at, subscription_status').eq('id', entityId).maybeSingle();
  if (!current) {
    return redirect(`${back}?error=${encodeURIComponent('Entity nenalezena.')}`, 303);
  }

  const now = Date.now();
  const currentEnd = (current as { trial_ends_at: string | null }).trial_ends_at
    ? new Date((current as { trial_ends_at: string }).trial_ends_at).getTime()
    : 0;
  const baseTime = Math.max(now, currentEnd);
  const newEnd = new Date(baseTime + days * 24 * 3600 * 1000).toISOString();

  // If subscription was canceled or past_due, reset to 'trialing' as well
  const updates: Record<string, any> = {
    trial_ends_at: newEnd,
    updated_at: new Date().toISOString(),
  };
  const status = (current as { subscription_status: string }).subscription_status;
  if (status === 'canceled' || status === 'past_due') {
    updates.subscription_status = 'trialing';
  }

  const { error } = await admin.from(table).update(updates).eq('id', entityId);
  if (error) {
    return redirect(`${back}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`${back}?saved=extended`, 303);
};
