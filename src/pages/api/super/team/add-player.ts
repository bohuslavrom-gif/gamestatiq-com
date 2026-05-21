import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_POSITIONS = ['QB', 'WR', 'RB', 'OL', 'DL', 'LB', 'DB', 'ST', 'K', 'P', 'OTHER'];
const VALID_STATUS = ['active', 'injured', 'suspended', 'retired'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.isSuperAdmin) return redirect('/app', 303);

  const form = await request.formData();
  const teamId    = String(form.get('team_id') ?? '').trim();
  const firstName = String(form.get('first_name') ?? '').trim();
  const lastName  = String(form.get('last_name') ?? '').trim();
  const jerseyRaw = String(form.get('jersey_number') ?? '').trim();
  const position  = String(form.get('position') ?? 'OTHER').trim().toUpperCase();
  const status    = String(form.get('status') ?? 'active').trim().toLowerCase();

  if (!teamId || !firstName) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Chybí team_id nebo jméno.')}`, 303);
  }
  if (!VALID_POSITIONS.includes(position)) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Neplatná pozice.')}`, 303);
  }
  if (!VALID_STATUS.includes(status)) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Neplatný status.')}`, 303);
  }

  let jersey: number | null = null;
  if (jerseyRaw) {
    const n = parseInt(jerseyRaw, 10);
    if (isNaN(n) || n < 0 || n > 999) {
      return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Číslo dresu 0–999.')}`, 303);
    }
    jersey = n;
  }

  const admin = getSupabaseAdmin();
  // Lookup club_id from team
  const { data: team } = await admin.from('teams').select('club_id').eq('id', teamId).maybeSingle();
  if (!team) {
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent('Tým neexistuje.')}`, 303);
  }

  const { error } = await admin.from('players').insert({
    club_id: (team as { club_id: string }).club_id,
    team_id: teamId,
    first_name: firstName,
    last_name: lastName || null,
    jersey_number: jersey,
    position,
    status,
  });
  if (error) {
    const msg = error.code === '23505'
      ? 'Číslo dresu už používá jiný hráč v týmu.'
      : 'Hráč se nepodařil uložit: ' + error.message;
    return redirect(`/admin/teams/${teamId}?error=${encodeURIComponent(msg)}`, 303);
  }
  return redirect(`/admin/teams/${teamId}?saved=1`, 303);
};
