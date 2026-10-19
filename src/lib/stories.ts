import { supabase } from '@/lib/supabase';

// Stories and curiosity notes. Stories are the person's own words, never
// AI-written or polished, and there is no "Ask me about..." hook.

export const STORY_MAX_LENGTH = 2000;
export const MAX_STORIES = 3;

// 2026-10-18 (founder): stories show who someone is through something that
// happened, not a description of themselves. These are optional guides the
// writer can pick while writing; readers never see which one was picked.
// Asking for one moment ("something that happened") is what brings back a
// real scene instead of a summary. No "best" or "proudest" (that invites a
// highlight reel). Keys are stored in stories[].prompt_key ('' = their own way).
export const STORY_GUIDES: { key: string; title: string; hint: string }[] = [
  { key: 'moment', title: 'A moment from your life.', hint: 'Something that happened, big or small.' },
  {
    key: 'still_think',
    title: 'Something that happened that you still think about.',
    hint: "Last week or forty years ago. It doesn't need a lesson or an ending.",
  },
  { key: 'day', title: 'A day you remember well.', hint: 'Any day at all. An ordinary one counts.' },
  { key: 'remember', title: 'Start with "I remember..." and keep going.', hint: 'One memory, any size.' },
  {
    key: 'recognize',
    title: 'A story the people who know you would recognize as yours.',
    hint: "Told the way you'd tell it.",
  },
];

export function storyGuide(key: string | null | undefined) {
  return STORY_GUIDES.find((g) => g.key === key) ?? null;
}

export type Story = { prompt_key: string; text: string };

export function normalizeStories(raw: unknown): Story[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.text === 'string')
    .map((s) => ({ prompt_key: typeof s.prompt_key === 'string' ? (s.prompt_key as string) : '', text: (s.text as string).slice(0, STORY_MAX_LENGTH) }))
    .slice(0, MAX_STORIES);
}

export async function fetchProfileStories(userId: string): Promise<Story[]> {
  const { data, error } = await supabase.rpc('get_profile_stories', { p_user_id: userId });
  if (error) return [];
  return normalizeStories(data);
}

// Each viewer sees the stories in a different (but stable) order, so
// different readers start from different stories and their curiosity
// goes to different places.
export function orderStoriesForViewer<T>(items: T[], viewerId: string, subjectId: string): { item: T; index: number }[] {
  const seed = `${viewerId}:${subjectId}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const offset = items.length > 0 ? Math.abs(h) % items.length : 0;
  return items.map((_, i) => {
    const index = (i + offset) % items.length;
    return { item: items[index], index };
  });
}

export type CuriosityNote = { id: string; note: string; story_index: number | null; created_at: string };

export async function fetchCuriosityNotes(subjectUserId: string): Promise<CuriosityNote[]> {
  const { data } = await supabase
    .from('curiosity_notes')
    .select('id, note, story_index, created_at')
    .eq('subject_user_id', subjectUserId)
    .order('created_at', { ascending: false });
  return (data ?? []) as CuriosityNote[];
}

export async function addCuriosityNote(subjectUserId: string, note: string, storyIndex: number | null): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('curiosity_notes').insert({
    user_id: user.id,
    subject_user_id: subjectUserId,
    note: note.trim().slice(0, 300),
    story_index: storyIndex,
  });
  return !error;
}

export async function deleteCuriosityNote(id: string): Promise<void> {
  await supabase.from('curiosity_notes').delete().eq('id', id);
}
