import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../lib/supabase';

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
const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/settings', 303);

  const league = locals.league;
  const role = locals.leagueRole;
  if (!league) {
    return redirect(`/app?error=${encodeURIComponent('Nejste členem žádné ligy.')}`, 303);
  }
  if (role !== 'admin') {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Pouze admin ligy může měnit nastavení.')}`, 303);
  }

  const form = await request.formData();
  const name        = String(form.get('name')        ?? '').trim();
  const slugRaw     = String(form.get('slug')        ?? '').trim().toLowerCase();
  const sport       = String(form.get('sport')       ?? league.sport).trim();
  const description = String(form.get('description') ?? '').trim();
  const primary     = String(form.get('primary')     ?? league.primary_color).trim();
  const secondary   = String(form.get('secondary')   ?? league.secondary_color).trim();
  const logoUrl     = String(form.get('logo_url')    ?? '').trim();

  if (!name) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Název ligy je povinný.')}`, 303);
  }
  if (!VALID_SPORTS.includes(sport)) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Neplatný sport.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  const updates: Record<string, any> = {
    name,
    sport,
    description: description || null,
    updated_at: new Date().toISOString(),
  };
  if (isHex(primary))   updates.primary_color = primary;
  if (isHex(secondary)) updates.secondary_color = secondary;
  if (logoUrl)          updates.logo_url = logoUrl;
  else if (form.has('logo_url')) updates.logo_url = null;

  // Slug change: validate uniqueness + slugify
  const slugChange = slugRaw && slugRaw !== league.slug;
  if (slugChange) {
    const cleaned = slugify(slugRaw);
    if (!cleaned) {
      return redirect(`/app/league/settings?error=${encodeURIComponent('Neplatný slug.')}`, 303);
    }
    const { data: existing } = await admin
      .from('leagues')
      .select('id')
      .eq('slug', cleaned)
      .neq('id', league.id)
      .maybeSingle();
    if (existing) {
      return redirect(`/app/league/settings?error=${encodeURIComponent('Slug už používá jiná liga.')}`, 303);
    }
    updates.slug = cleaned;
  }

  const { error } = await admin
    .from('leagues')
    .update(updates)
    .eq('id', league.id);

  if (error) {
    return redirect(`/app/league/settings?error=${encodeURIComponent('Nastavení se nepodařilo uložit: ' + error.message)}`, 303);
  }

  return redirect('/app/league/settings?saved=1', 303);
};
