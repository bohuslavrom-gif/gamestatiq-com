import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

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
    return redirect(`/app/playbook?error=${encodeURIComponent('Pouze admin/coach může smazat akci.')}`, 303);
  }

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return redirect('/app/playbook?error=missing_id', 303);

  // Verify ownership
  const { data: existing } = await admin
    .from('playbook_actions')
    .select('id, team_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing || (existing as { team_id: string }).team_id !== currentTeam.id) {
    return redirect(`/app/playbook?error=${encodeURIComponent('Akce neexistuje.')}`, 303);
  }

  const { error } = await admin.from('playbook_actions').delete().eq('id', id);
  if (error) {
    return redirect(`/app/playbook?error=${encodeURIComponent(error.message)}`, 303);
  }
  return redirect('/app/playbook?saved=deleted', 303);
};
