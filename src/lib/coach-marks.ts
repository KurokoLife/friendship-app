import { supabase } from '@/lib/supabase';

// First-time coach-mark/tooltip system. See the header comment in
// migration 20260820000000 for why this is a small custom solution
// rather than react-native-copilot (verified live to actually render
// correctly on web, but structurally built for one linear, ordered tour,
// not 9 independent, scattered, one-off tips).
export type CoachMarkKey =
  | 'tab_discover'
  | 'tab_browse'
  | 'tab_saved'
  | 'tab_inbox'
  | 'no_ghost_prompt'
  | 'meetup_checkin'
  | 'tab_remember'
  | 'tab_profile'
  | 'credits_premium';

// Shared, module-level cache: every CoachMark instance across the whole
// app reads the same in-memory set, so marking one seen (e.g. the
// credits_premium tip, fired from any of 6 unrelated blocked-state
// surfaces) is immediately reflected everywhere else in the same session,
// not just on the one screen that happened to fire it. Cleared on every
// real auth change (see _layout.tsx) so a Dev-tab account switch never
// leaks one account's seen marks into another's.
let cachedSeen: Set<CoachMarkKey> | null = null;
let inflightFetch: Promise<Set<CoachMarkKey>> | null = null;

export async function getSeenCoachMarks(): Promise<Set<CoachMarkKey>> {
  if (cachedSeen) return cachedSeen;
  if (inflightFetch) return inflightFetch;
  inflightFetch = (async () => {
    const { data } = await supabase.from('coach_marks_seen').select('mark_key');
    const set = new Set((data ?? []).map((r) => r.mark_key as CoachMarkKey));
    cachedSeen = set;
    inflightFetch = null;
    return set;
  })();
  return inflightFetch;
}

export async function markCoachMarkSeen(key: CoachMarkKey): Promise<void> {
  if (cachedSeen?.has(key)) return;
  // Optimistic: update the shared cache immediately, before the write
  // resolves, so a coach mark that fires again a moment later on a
  // different screen (credits_premium, reachable from 6 places) doesn't
  // get a chance to flash back into view during the round trip.
  cachedSeen?.add(key);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('coach_marks_seen')
    .upsert({ user_id: user.id, mark_key: key }, { onConflict: 'user_id,mark_key', ignoreDuplicates: true });
}

// Settings' "Show tips again": deletes every row for the caller and
// clears the local cache, so the next fetch genuinely comes back empty
// and every coach mark fires again on next encounter.
export async function resetCoachMarks(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('coach_marks_seen').delete().eq('user_id', user.id);
  cachedSeen = new Set();
}

// Dev tab's Time Travel panel: reset just one mark, same own-row DELETE
// RLS as resetCoachMarks, scoped narrower. Clears the shared cache
// entirely rather than surgically removing one key, simpler and correct
// either way since the next real read re-populates it from the (now
// smaller) real table state.
export async function resetCoachMark(key: CoachMarkKey): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from('coach_marks_seen').delete().eq('user_id', user.id).eq('mark_key', key);
  cachedSeen = null;
}

// Called on every real auth change (sign-in, sign-out, Dev-tab account
// switch, token refresh) so a different account's cache is never reused.
export function clearCoachMarksCache(): void {
  cachedSeen = null;
  inflightFetch = null;
}
