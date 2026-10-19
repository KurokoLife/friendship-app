import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeStories, type Story } from '@/lib/stories';
import { supabase } from '@/lib/supabase';

// "Start with you" (2026-10-18) comes before the phone number, so there is
// no account yet. What the person writes is kept on their phone and saved
// to their profile right after Basics (or the next time the builder opens).
//
// "What brings you to Limen?" is free text stored in
// profiles.life_transitions_other, the column every profile view already
// returns (shown as "What brings them here"). The old preset chips
// (life_transitions) are no longer asked.

export const WHAT_BRINGS_MAX_LENGTH = 600;

export type StartDraft = { whatBrings: string; stories: Story[] };

const KEY = 'limen.start_draft.v1';

export async function loadStartDraft(): Promise<StartDraft> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StartDraft>;
      return { whatBrings: typeof parsed.whatBrings === 'string' ? parsed.whatBrings : '', stories: normalizeStories(parsed.stories) };
    }
  } catch {
    // A blocked or empty storage just means a fresh start.
  }
  return { whatBrings: '', stories: [] };
}

export async function saveStartDraft(draft: StartDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Best effort only.
  }
}

export async function clearStartDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Best effort only.
  }
}

export function draftHasWriting(d: StartDraft): boolean {
  return d.whatBrings.trim().length > 0 || d.stories.some((s) => s.text.trim().length > 0);
}

// Saves the draft to the signed-in person's profile, then clears it. Only
// fills what is still empty, so it never overwrites something already saved.
export async function flushStartDraft(): Promise<void> {
  const draft = await loadStartDraft();
  if (!draftHasWriting(draft)) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: existing } = await supabase
    .from('profiles')
    .select('life_transitions_other, stories')
    .eq('user_id', user.id)
    .maybeSingle();
  const patch: Record<string, unknown> = { user_id: user.id };
  if (!existing?.life_transitions_other?.trim() && draft.whatBrings.trim()) {
    patch.life_transitions_other = draft.whatBrings.trim().slice(0, WHAT_BRINGS_MAX_LENGTH);
    patch.show_life_transitions = true;
  }
  const savedStories = normalizeStories(existing?.stories).filter((s) => s.text.trim());
  const draftStories = draft.stories.filter((s) => s.text.trim());
  if (savedStories.length === 0 && draftStories.length > 0) patch.stories = draftStories;
  if (Object.keys(patch).length > 1) {
    const { error } = await supabase.from('profiles').upsert(patch);
    if (error) return;
  }
  await clearStartDraft();
}
