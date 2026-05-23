import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const VALID_CATEGORIES = ['run', 'pass', 'screen', 'special', 'other'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/playbook', 303);

  const currentTeam = locals.team;
  if (!currentTeam) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Žádný aktivní tým.')}`, 303);
  }

  const admin = getSupabaseAdmin();
  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('club_id', currentTeam.club_id)
    .maybeSingle();
  const role = (cm as { role: string } | null)?.role ?? null;
  if (role !== 'admin' && role !== 'coach') {
    return redirect(`/app/playbook?error=${encodeURIComponent('Pouze admin/coach může editovat playbook.')}`, 303);
  }

  const form = await request.formData();
  const id        = String(form.get('id') ?? '').trim();
  const name      = String(form.get('name') ?? '').trim();
  const category  = String(form.get('category') ?? 'other').trim();
  const sortRaw   = String(form.get('sort_order') ?? '0').trim();
  const activeRaw = form.get('active');
  const active    = activeRaw === 'on' || activeRaw === 'true' || activeRaw === '1';

  if (!id) return redirect('/app/playbook?error=missing_id', 303);
  if (!name) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Název akce je povinný.')}`, 303);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Neplatná kategorie.')}`, 303);
  }
  const sortOrder = parseInt(sortRaw, 10);
  if (isNaN(sortOrder)) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Neplatné pořadí.')}`, 303);
  }

  // Verify action belongs to current team (security)
  const { data: existing } = await admin
    .from('playbook_actions')
    .select('id, team_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing || (existing as { team_id: string }).team_id !== currentTeam.id) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Akce neexistuje nebo není z tohoto týmu.')}`, 303);
  }

  const { error } = await admin.from('playbook_actions').update({
    name, category, sort_order: sortOrder, active,
  }).eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return redirect(`/app/playbook?error=${encodeURIComponent(`Akce "${name}" v playbooku už existuje.`)}`, 303);
    }
    return redirect(`/app/playbook?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect('/app/playbook?saved=updated', 303);
};
