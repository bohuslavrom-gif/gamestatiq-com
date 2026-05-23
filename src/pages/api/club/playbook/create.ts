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

  // Role check — admin/coach can edit
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
  const name      = String(form.get('name') ?? '').trim();
  const category  = String(form.get('category') ?? 'other').trim();
  const sortRaw   = String(form.get('sort_order') ?? '0').trim();

  if (!name) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Název akce je povinný.')}`, 303);
  }
  if (name.length > 80) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Max 80 znaků v názvu.')}`, 303);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Neplatná kategorie.')}`, 303);
  }
  const sortOrder = parseInt(sortRaw, 10);
  if (isNaN(sortOrder)) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Neplatné pořadí.')}`, 303);
  }

  const { error } = await admin.from('playbook_actions').insert({
    team_id: currentTeam.id,
    name,
    category,
    sort_order: sortOrder,
    active: true,
  });

  if (error) {
    if (error.code === '23505') {
      return redirect(`/app/playbook?error=${encodeURIComponent(`Akce "${name}" v playbooku týmu už existuje.`)}`, 303);
    }
    return redirect(`/app/playbook?error=${encodeURIComponent('Uložení selhalo: ' + error.message)}`, 303);
  }
  return redirect('/app/playbook?saved=created', 303);
};
