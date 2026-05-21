import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'liga';
}

const VALID_SPORTS = ['flag-football', 'american_football', 'football', 'basketball', 'volleyball', 'hockey', 'other'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const name        = String(form.get('name') ?? '').trim();
  const sport       = String(form.get('sport') ?? 'flag-football').trim();
  const description = String(form.get('description') ?? '').trim();
  const ownerEmail  = String(form.get('owner_email') ?? '').trim().toLowerCase();
  const tier        = String(form.get('tier') ?? 'liga').trim();

  if (!name) {
    return redirect(`/admin/leagues/new?error=${encodeURIComponent('Název ligy povinný.')}`, 303);
  }
  if (!VALID_SPORTS.includes(sport)) {
    return redirect(`/admin/leagues/new?error=${encodeURIComponent('Neplatný sport.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Resolve owner (lookup by email in profiles); optional — can be null until claimed
  let ownerUserId: string | null = null;
  if (ownerEmail) {
    const { data: profile } = await admin.from('profiles').select('id').eq('email', ownerEmail).maybeSingle();
    if (!profile) {
      return redirect(`/admin/leagues/new?error=${encodeURIComponent('Uživatel s e-mailem "' + ownerEmail + '" neexistuje. Nejprve musí provést /signup.')}`, 303);
    }
    ownerUserId = (profile as { id: string }).id;
  }

  // Unique slug
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 8; i++) {
    const { data: existing } = await admin.from('leagues').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${base}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  // 60-day trial for manual customers (longer than self-serve 30)
  const trialEnds = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  const { data: league, error } = await admin
    .from('leagues')
    .insert({
      name, slug, sport,
      description: description || null,
      owner_user_id: ownerUserId,
      subscription_tier: tier === 'klub' ? 'klub' : 'liga',
      subscription_status: 'trialing',
      trial_ends_at: trialEnds,
    })
    .select('id')
    .single();

  if (error || !league) {
    return redirect(`/admin/leagues/new?error=${encodeURIComponent('Liga se nepodařilo vytvořit: ' + (error?.message ?? ''))}`, 303);
  }

  // If owner specified, add as admin
  if (ownerUserId) {
    await admin.from('league_members').insert({
      league_id: league.id,
      user_id: ownerUserId,
      role: 'admin',
    });
  }

  return redirect(`/admin/leagues/${league.id}?saved=1`, 303);
};
