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
    .slice(0, 48) || 'klub';
}

const VALID_SPORTS = ['flag-football', 'american_football', 'football', 'basketball', 'volleyball', 'hockey', 'other'];
const VALID_TIERS  = ['trial', 'tym', 'klub', 'liga'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const name         = String(form.get('name') ?? '').trim();
  const sport        = String(form.get('sport') ?? 'flag-football').trim();
  const tierRaw      = String(form.get('tier') ?? 'trial').trim();
  const tier         = VALID_TIERS.includes(tierRaw) ? tierRaw : 'trial';
  const ownerEmail   = String(form.get('owner_email') ?? '').trim().toLowerCase();
  const createTeam   = form.get('create_default_team') === '1';
  const teamName     = String(form.get('default_team_name') ?? 'Muži').trim() || 'Muži';

  if (!name) {
    return redirect(`/admin/clubs/new?error=${encodeURIComponent('Název klubu povinný.')}`, 303);
  }
  if (!VALID_SPORTS.includes(sport)) {
    return redirect(`/admin/clubs/new?error=${encodeURIComponent('Neplatný sport.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Resolve owner (lookup by email in profiles); optional
  let ownerUserId: string | null = null;
  if (ownerEmail) {
    const { data: profile } = await admin.from('profiles').select('id').eq('email', ownerEmail).maybeSingle();
    if (!profile) {
      return redirect(`/admin/clubs/new?error=${encodeURIComponent('Uživatel s emailem "' + ownerEmail + '" neexistuje. Nejprve musí udělat /signup.')}`, 303);
    }
    ownerUserId = (profile as { id: string }).id;
  }

  // Unique slug
  const base = slugify(name);
  let slug = base;
  for (let i = 0; i < 8; i++) {
    const { data: existing } = await admin.from('clubs').select('id').eq('slug', slug).maybeSingle();
    if (!existing) break;
    slug = `${base}-${Math.floor(Math.random() * 9000) + 1000}`;
  }

  // 60-day trial for manual customers
  const trialEnds = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  const insertRow: Record<string, any> = {
    name,
    slug,
    sport,
    subscription_tier: tier,
    subscription_status: 'trialing',
    trial_ends_at: trialEnds,
  };
  if (ownerUserId) insertRow.owner_id = ownerUserId;
  // Note: owner_id may be NOT NULL in DB — if no owner provided, we use the
  // super admin's own user_id as a stand-in so the row passes. Owner can be
  // re-assigned later via /admin/clubs/[id].
  if (!insertRow.owner_id) insertRow.owner_id = locals.user?.id ?? null;

  const { data: club, error } = await admin
    .from('clubs')
    .insert(insertRow)
    .select('id')
    .single();

  if (error || !club) {
    return redirect(`/admin/clubs/new?error=${encodeURIComponent('Klub se nepodařilo vytvořit: ' + (error?.message ?? ''))}`, 303);
  }

  // If owner specified, add as admin in club_members
  if (ownerUserId) {
    await admin.from('club_members').insert({
      club_id: club.id,
      user_id: ownerUserId,
      role: 'admin',
    });
  }

  // Create default team so /app routes don't break on first login
  if (createTeam) {
    await admin.from('teams').insert({
      club_id: club.id,
      name: teamName,
      sport,
    });

    // Plus initialize members table so club has at least admin user mapped
    // (idempotent insert; skip if already inserted above)
  }

  return redirect(`/admin/clubs/${club.id}?saved=1`, 303);
};
