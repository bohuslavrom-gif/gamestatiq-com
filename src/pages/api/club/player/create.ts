import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_POSITIONS = ['QB', 'WR', 'RB', 'OL', 'DL', 'LB', 'DB', 'ST', 'K', 'P', 'OTHER'];
const VALID_STATUS = ['active', 'injured', 'suspended', 'retired'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/players', 303);

  const form = await request.formData();
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName  = String(form.get('last_name') ?? '').trim();
  const jerseyRaw = String(form.get('jersey_number') ?? '').trim();
  const position  = String(form.get('position') ?? 'OL').trim().toUpperCase();
  const status    = String(form.get('status') ?? 'active').trim().toLowerCase();
  const dobRaw    = String(form.get('date_of_birth') ?? '').trim();
  const notes     = String(form.get('notes') ?? '').trim() || null;

  if (!firstName) {
    return redirect(`/app/players?error=${encodeURIComponent('Jméno je povinné.')}`, 303);
  }
  if (!VALID_POSITIONS.includes(position)) {
    return redirect(`/app/players?error=${encodeURIComponent('Neplatná pozice.')}`, 303);
  }
  if (!VALID_STATUS.includes(status)) {
    return redirect(`/app/players?error=${encodeURIComponent('Neplatný status.')}`, 303);
  }

  let jersey: number | null = null;
  if (jerseyRaw) {
    const n = parseInt(jerseyRaw, 10);
    if (isNaN(n) || n < 0 || n > 999) {
      return redirect(`/app/players?error=${encodeURIComponent('Číslo dresu musí být 0–999.')}`, 303);
    }
    jersey = n;
  }

  let dob: string | null = null;
  if (dobRaw && /^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
    dob = dobRaw;
  }

  const admin = getSupabaseAdmin();
  const { data: membership } = await admin
    .from('club_members')
    .select('club_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return redirect(`/app/players?error=${encodeURIComponent('Nejste členem žádného klubu.')}`, 303);
  }
  if (!['admin', 'coach'].includes(membership.role)) {
    return redirect(`/app/players?error=${encodeURIComponent('Bez oprávnění (Admin/Trenér).')}`, 303);
  }

  // Iter 2: associate player with the currently active team (resolved by middleware).
  // Fallback to the club's default (oldest) team if locals.team isn't set for any reason.
  let teamId = locals.team?.id ?? null;
  if (!teamId) {
    const { data: defaultTeam } = await admin
      .from('teams')
      .select('id')
      .eq('club_id', membership.club_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    teamId = (defaultTeam as { id: string } | null)?.id ?? null;
  }
  if (!teamId) {
    return redirect(`/app/players?error=${encodeURIComponent('Klub nemá žádný tým — vytvořte tým nejdřív v Nastavení.')}`, 303);
  }

  const { error } = await admin.from('players').insert({
    club_id: membership.club_id,
    team_id: teamId,
    first_name: firstName,
    last_name: lastName,
    jersey_number: jersey,
    position,
    status,
    date_of_birth: dob,
    notes,
  });

  if (error) {
    const msg = error.code === '23505'
      ? 'Číslo dresu už používá jiný hráč v tomto týmu.'
      : 'Hráč se nepodařil uložit: ' + error.message;
    return redirect(`/app/players?error=${encodeURIComponent(msg)}`, 303);
  }

  // Preserve team selection in redirect
  const redirUrl = teamId ? `/app/players?saved=created&team=${teamId}` : '/app/players?saved=created';
  return redirect(redirUrl, 303);
};
