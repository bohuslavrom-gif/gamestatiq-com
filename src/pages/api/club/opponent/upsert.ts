import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../../../../lib/supabase';

export const prerender = false;

const ALLOWED = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];
const MAX = 5 * 1024 * 1024;
const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const user = locals.user;
  if (!user) return redirect('/login?next=/app/opponents', 303);

  const currentTeam = locals.team;
  if (!currentTeam) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Žádný aktivní tým.')}`, 303);
  }
  const clubId = currentTeam.club_id;

  const admin = getSupabaseAdmin();
  const { data: cm } = await admin
    .from('club_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('club_id', clubId)
    .maybeSingle();
  const role = (cm as { role: string } | null)?.role ?? null;
  if (role !== 'admin' && role !== 'coach') {
    return redirect(`/app/opponents?error=${encodeURIComponent('Pouze admin/coach může editovat soupeře.')}`, 303);
  }

  const form = await request.formData();
  const id            = String(form.get('id') ?? '').trim();
  const name          = String(form.get('name') ?? '').trim();
  const primaryColor  = String(form.get('primary_color') ?? '').trim();
  const file          = form.get('logo') as File | null;

  if (!name) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Jméno soupeře je povinné.')}`, 303);
  }
  if (name.length > 80) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Max 80 znaků.')}`, 303);
  }
  if (primaryColor && !isHex(primaryColor)) {
    return redirect(`/app/opponents?error=${encodeURIComponent('Neplatná barva (formát #RRGGBB).')}`, 303);
  }

  // Optional logo upload
  let logoUrl: string | undefined;
  if (file && file instanceof File && file.size > 0) {
    if (file.size > MAX) {
      return redirect(`/app/opponents?error=${encodeURIComponent('Max 5 MB.')}`, 303);
    }
    if (!ALLOWED.includes(file.type)) {
      return redirect(`/app/opponents?error=${encodeURIComponent('Povolené: SVG, PNG, JPG, WebP.')}`, 303);
    }
    const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${clubId}/opponents/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage.from('club-logos').upload(path, buf, {
      contentType: file.type, cacheControl: '3600', upsert: false,
    });
    if (upErr) {
      return redirect(`/app/opponents?error=${encodeURIComponent('Upload selhal: ' + upErr.message)}`, 303);
    }
    const { data: { publicUrl } } = admin.storage.from('club-logos').getPublicUrl(path);
    logoUrl = publicUrl;
  }

  // Insert or update
  if (id) {
    // Update existing
    const { data: existing } = await admin
      .from('opponents')
      .select('id, club_id, logo_url')
      .eq('id', id)
      .maybeSingle();
    if (!existing || (existing as { club_id: string }).club_id !== clubId) {
      return redirect(`/app/opponents?error=${encodeURIComponent('Soupeř neexistuje.')}`, 303);
    }
    const updates: Record<string, any> = { name };
    if (primaryColor) updates.primary_color = primaryColor;
    if (logoUrl) {
      updates.logo_url = logoUrl;
      // Cleanup old logo if it was in our bucket
      const oldLogoUrl = (existing as { logo_url: string | null }).logo_url;
      if (oldLogoUrl) {
        try {
          const oldPath = oldLogoUrl.split('/club-logos/')[1];
          if (oldPath) await admin.storage.from('club-logos').remove([oldPath]);
        } catch {}
      }
    }
    const { error } = await admin.from('opponents').update(updates).eq('id', id);
    if (error) {
      return redirect(`/app/opponents?error=${encodeURIComponent(error.message)}`, 303);
    }
    return redirect('/app/opponents?saved=updated', 303);
  } else {
    // Create new
    const { error } = await admin.from('opponents').insert({
      club_id: clubId,
      name,
      primary_color: primaryColor || '#1A1A1A',
      logo_url: logoUrl ?? null,
    });
    if (error) {
      if (error.code === '23505') {
        return redirect(`/app/opponents?error=${encodeURIComponent(`Soupeř "${name}" už existuje.`)}`, 303);
      }
      return redirect(`/app/opponents?error=${encodeURIComponent('Uložení selhalo: ' + error.message)}`, 303);
    }
    return redirect('/app/opponents?saved=created', 303);
  }
};
