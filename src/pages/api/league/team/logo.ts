// Iter 41: Liga admin může uploadovat/odstranit logo týmu (per tým v lize).
// Použivá league-assets storage bucket, path: team-logos/{teamId}/logo_<ts>.<ext>
import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const MAX = 5 * 1024 * 1024;

async function isAuthorized(admin: any, userId: string, leagueId: string, teamId: string): Promise<boolean> {
  // 1) League owner
  const { data: league } = await admin.from('leagues').select('owner_user_id').eq('id', leagueId).maybeSingle();
  if (league && (league as { owner_user_id: string }).owner_user_id === userId) return true;
  // 2) League admin via league_members
  const { data: lm } = await admin
    .from('league_members')
    .select('role')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lm && (lm as { role: string }).role === 'admin') return true;
  // 3) Club admin pro tým
  const { data: team } = await admin.from('teams').select('club_id').eq('id', teamId).maybeSingle();
  if (team) {
    const { data: cm } = await admin
      .from('club_members')
      .select('role')
      .eq('user_id', userId)
      .eq('club_id', team.club_id)
      .maybeSingle();
    if (cm && cm.role === 'admin') return true;
  }
  return false;
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/league/teams', 303);

  const form = await request.formData();
  const leagueId = String(form.get('league_id') ?? '').trim();
  const teamId   = String(form.get('team_id')   ?? '').trim();
  const action   = String(form.get('action')    ?? 'upload').trim();  // 'upload' | 'remove'

  if (!leagueId || !teamId) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Chybí parametr.')}`, 303);
  }

  const admin = getSupabaseAdmin();

  // Verify tým je v lize
  const { data: lt } = await admin
    .from('league_teams')
    .select('league_id')
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!lt) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Tým není v této lize.')}`, 303);
  }

  if (!(await isAuthorized(admin, user.id, leagueId, teamId))) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Bez oprávnění — musíš být liga admin nebo admin klubu.')}`, 303);
  }

  // Aktuální logo (pro mazání starého)
  const { data: existing } = await admin.from('teams').select('logo_url').eq('id', teamId).maybeSingle();
  const existingLogoUrl = (existing as { logo_url: string | null } | null)?.logo_url ?? null;

  if (action === 'remove') {
    if (existingLogoUrl) {
      try {
        const oldPath = existingLogoUrl.split('/league-assets/')[1];
        if (oldPath) await admin.storage.from('league-assets').remove([oldPath]);
      } catch {}
    }
    await admin.from('teams').update({ logo_url: null, updated_at: new Date().toISOString() }).eq('id', teamId);
    return redirect('/app/league/teams?saved=logo_removed', 303);
  }

  // Upload flow
  const file = form.get('logo') as File | null;
  if (!file || !(file instanceof File) || file.size === 0) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Vyberte soubor.')}`, 303);
  }
  if (file.size > MAX) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Max 5 MB.')}`, 303);
  }
  if (!ALLOWED.includes(file.type)) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Povolené: SVG, PNG, JPG, WebP.')}`, 303);
  }

  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `team-logos/${teamId}/logo_${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage.from('league-assets').upload(path, buf, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (upErr) {
    return redirect(`/app/league/teams?error=${encodeURIComponent('Upload selhal: ' + upErr.message)}`, 303);
  }

  const { data: { publicUrl } } = admin.storage.from('league-assets').getPublicUrl(path);

  // Smaž staré logo (best-effort)
  if (existingLogoUrl) {
    try {
      const oldPath = existingLogoUrl.split('/league-assets/')[1];
      if (oldPath) await admin.storage.from('league-assets').remove([oldPath]);
    } catch {}
  }

  await admin.from('teams').update({ logo_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', teamId);
  return redirect('/app/league/teams?saved=logo', 303);
};
