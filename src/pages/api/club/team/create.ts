import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';
import { teamLimitForTier } from '../../../../lib/teams';

export const prerender = false;

const VALID_CATEGORIES = ['men', 'women', 'u18', 'u15', 'u12', 'mixed', ''];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/settings/teams', 303);

  const form = await request.formData();
  const name      = String(form.get('name')      ?? '').trim();
  const category  = String(form.get('category')  ?? '').trim().toLowerCase();
  const sport     = String(form.get('sport')     ?? 'flag-football').trim();
  const season    = String(form.get('season')    ?? '2026').trim();
  const primary   = String(form.get('primary')   ?? '#0F1B2D').trim();
  const secondary = String(form.get('secondary') ?? '#E63946').trim();

  if (!name) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Název týmu je povinný.')}`, 303);
  }
  if (name.length > 60) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Název max 60 znaků.')}`, 303);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Neplatná kategorie.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Resolve user's primary club + role + tier
  const { data: membership } = await admin
    .from('club_members')
    .select('club_id, role, clubs(subscription_tier)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Nejste členem žádného klubu.')}`, 303);
  }
  if (membership.role !== 'admin') {
    return redirect(`/app/settings/teams?error=${encodeURIComponent('Pouze Admin může vytvářet týmy.')}`, 303);
  }

  const clubId = membership.club_id;
  const tier = (membership as any).clubs?.subscription_tier ?? 'trial';
  const limit = teamLimitForTier(tier);

  // Count current non-archived teams
  const { count } = await admin
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('is_archived', false);

  if ((count ?? 0) >= limit) {
    const msg = limit === 1
      ? 'Váš plán dovoluje pouze 1 tým. Upgradujte na Klub pro více týmů.'
      : `Limit pro váš plán: ${limit} týmů. Upgradujte pro neomezeno.`;
    return redirect(`/app/settings/teams?error=${encodeURIComponent(msg)}`, 303);
  }

  const { error } = await admin.from('teams').insert({
    club_id: clubId,
    name,
    category: category || null,
    sport,
    season,
    primary_color: primary,
    secondary_color: secondary,
  });

  if (error) {
    const msg = error.code === '23505'
      ? 'Tým s tímto názvem už v klubu existuje.'
      : 'Tým se nepodařil vytvořit: ' + error.message;
    return redirect(`/app/settings/teams?error=${encodeURIComponent(msg)}`, 303);
  }

  return redirect('/app/settings/teams?saved=created', 303);
};
