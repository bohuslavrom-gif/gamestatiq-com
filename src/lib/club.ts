// Club-related helpers.
import { getSupabaseAdmin, type Club } from './supabase';

/**
 * Load the primary club owned by the user. Returns null if none.
 */
export async function getOwnedClub(userId: string): Promise<Club | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('clubs')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data as Club | null;
}

export type ClubMember = {
  id: string;
  user_id: string;
  role: 'admin' | 'coach' | 'stats' | 'viewer';
  created_at: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export async function listClubMembers(clubId: string): Promise<ClubMember[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('club_members')
    .select('id, user_id, role, created_at, profiles(email, first_name, last_name)')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    created_at: m.created_at,
    email: m.profiles?.email ?? '—',
    first_name: m.profiles?.first_name ?? null,
    last_name: m.profiles?.last_name ?? null,
  }));
}

export type ClubInvite = {
  id: string;
  token: string;
  email: string;
  role: 'admin' | 'coach' | 'stats' | 'viewer';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export async function listPendingInvites(clubId: string): Promise<ClubInvite[]> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('club_invites')
    .select('id, token, email, role, expires_at, accepted_at, created_at')
    .eq('club_id', clubId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  return (data ?? []) as ClubInvite[];
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'klub';
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  coach: 'Trenér',
  stats: 'Statistik',
  viewer: 'Pozorovatel',
};

export const TIER_HAS_CUSTOM_DOMAIN: Record<string, boolean> = {
  trial: false,
  klub: false,
  liga: true,
  federace: true,
};
