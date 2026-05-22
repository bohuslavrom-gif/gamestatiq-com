import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID = ['trialing', 'active', 'past_due', 'canceled', 'incomplete'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const entityType = String(form.get('entity_type') ?? '').trim();
  const entityId   = String(form.get('entity_id') ?? '').trim();
  const status     = String(form.get('status') ?? '').trim();
  const back       = String(form.get('back') ?? '/admin/subscriptions').trim();

  if (!entityId || !['club', 'league'].includes(entityType) || !VALID.includes(status)) {
    return redirect(`${back}?error=invalid`, 303);
  }

  const admin = getSupabaseAdmin();
  const table = entityType === 'club' ? 'clubs' : 'leagues';
  const { error } = await admin.from(table).update({
    subscription_status: status,
    updated_at: new Date().toISOString(),
  }).eq('id', entityId);
  if (error) {
    return redirect(`${back}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`${back}?saved=status`, 303);
};
