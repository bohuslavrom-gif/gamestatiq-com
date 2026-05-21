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
    .slice(0, 48) || 'klub';
}

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings', 303);

  const form = await request.formData();
  const name        = String(form.get('name') ?? '').trim();
  const slugRaw     = String(form.get('slug') ?? '').trim();
  const sport       = String(form.get('sport') ?? '').trim() || null;
  const yearRaw     = String(form.get('founded_year') ?? '').trim();
  const description = String(form.get('description') ?? '').trim() || null;
  const primary     = String(form.get('primary_color') ?? '').trim();
  const secondary   = String(form.get('secondary_color') ?? '').trim();
  const customDom   = String(form.get('custom_domain') ?? '').trim();

  if (!name) {
    return redirect(`/app/settings?error=${encodeURIComponent('Název klubu nesmí být prázdný.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('clubs')
    .select('id, slug, subscription_tier')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) return redirect(`/app/settings?error=${encodeURIComponent('Klub nenalezen.')}`, 303);

  const updates: Record<string, any> = { name };
  const slug = slugify(slugRaw || name);
  if (slug !== club.slug) {
    const { data: dup } = await admin.from('clubs').select('id').eq('slug', slug).neq('id', club.id).maybeSingle();
    if (dup) return redirect(`/app/settings?error=${encodeURIComponent('Tento slug už používá jiný klub.')}`, 303);
    updates.slug = slug;
  }
  updates.sport = sport;
  if (yearRaw) {
    const yr = parseInt(yearRaw, 10);
    updates.founded_year = (!isNaN(yr) && yr >= 1800 && yr <= 3000) ? yr : null;
  } else {
    updates.founded_year = null;
  }
  updates.description = description;
  if (primary && isHex(primary)) updates.primary_color = primary;
  if (secondary && isHex(secondary)) updates.secondary_color = secondary;

  if (customDom) {
    // Klub+ tier allows custom domain (post tier-rename: klub = multi-team, liga = federace)
    if (club.subscription_tier === 'klub' || club.subscription_tier === 'liga') {
      const d = customDom.toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) {
        return redirect(`/app/settings?error=${encodeURIComponent('Neplatný formát domény.')}`, 303);
      }
      updates.custom_domain = d;
    }
    // for tym/trial silently ignored
  } else {
    updates.custom_domain = null;
  }

  const { error } = await admin.from('clubs').update(updates).eq('id', club.id);
  if (error) return redirect(`/app/settings?error=${encodeURIComponent('Uložení selhalo: ' + error.message)}`, 303);

  return redirect('/app/settings?saved=1', 303);
};
