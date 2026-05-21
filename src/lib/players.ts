// Bridge helper: get Supabase players for a club and build name → photo map.
// Used by /app/stats and /app/index to enrich GAS-sourced data with portal-owned
// photos (and any other portal-managed metadata over time).

import { getSupabaseAdmin } from './supabase';

export type SupabasePlayer = {
  id: string;
  club_id: string;
  first_name: string;
  last_name: string | null;
  jersey_number: number | null;
  position: string;
  photo_url: string | null;
  status: string;
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export type PlayerEnrichment = {
  photoUrl?: string;
  jersey?: number | null;
  position?: string;
  // future: bio, bday, etc.
};

/**
 * For a given team, return a map keyed by normalized "first last" name to
 * enrichment data (photo, jersey, position). Players are scoped to the team_id
 * (multi-team Iter 2). Falls back to empty map if teamId is null or no players.
 */
export async function fetchPlayerEnrichmentByName(teamId: string | null): Promise<Map<string, PlayerEnrichment>> {
  const map = new Map<string, PlayerEnrichment>();
  if (!teamId) return map;

  const admin = getSupabaseAdmin();
  const { data: players } = await admin
    .from('players')
    .select('first_name, last_name, jersey_number, position, photo_url')
    .eq('team_id', teamId);
  if (!players) return map;

  for (const p of players as SupabasePlayer[]) {
    const fullName = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (!fullName) continue;
    map.set(norm(fullName), {
      photoUrl: p.photo_url ?? undefined,
      jersey: p.jersey_number,
      position: p.position,
    });
    // Also key by last-first (in case GAS shows "Vacek Tomáš")
    if (p.last_name) {
      const reversed = `${p.last_name} ${p.first_name}`.trim();
      map.set(norm(reversed), {
        photoUrl: p.photo_url ?? undefined,
        jersey: p.jersey_number,
        position: p.position,
      });
    }
  }

  return map;
}

/** Lookup enrichment by a name string (any whitespace/diacritics normalized). */
export function enrich(map: Map<string, PlayerEnrichment>, name: string): PlayerEnrichment | null {
  const key = norm(name);
  return map.get(key) ?? null;
}
