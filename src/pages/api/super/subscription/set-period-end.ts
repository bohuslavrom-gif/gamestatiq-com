import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const entityType = String(form.get('entity_type') ?? '').trim();
  const entityId   = String(form.get('entity_id') ?? '').trim();
  const date       = String(form.get('date') ?? '').trim(); // YYYY-MM-DD
  const back       = String(form.get('back') ?? '/admin/subscriptions').trim();

  if (!entityId || !['club', 'league'].includes(entityType) || !date) {
    return redirect(`${back}?error=missing`, 303);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return redirect(`${back}?error=${encodeURIComponent('Formát data YYYY-MM-DD.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const table = entityType === 'club' ? 'clubs' : 'leagues';
  const iso = new Date(date + 'T23:59:59Z').toISOString();

  const { error } = await admin.from(table).update({
    current_period_end: iso,
    updated_at: new Date().toISOString(),
  }).eq('id', entityId);

  if (error) {
    return redirect(`${back}?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect(`${back}?saved=period`, 303);
};
