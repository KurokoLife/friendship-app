import { supabase } from '@/lib/supabase';

// Limen v2 (2026-10-03): Stories and curiosity notes.
// See docs/LIMEN_V2_DECISIONS.md, "Stories and curiosity".
//
// Stories are the user's own words, never AI-written or polished. The
// prompts show character rather than achievements, and several leave an
// open thread on purpose ("still trying to figure out"), because curiosity
// starts when a reader notices a gap of their own (Loewenstein's
// information-gap theory). There is deliberately no "Ask me about..." hook:
// it fills the gap for the reader, so everyone asks the same question.

export const STORY_MAX_LENGTH = 1200; // about 200 words
export const MAX_STORIES = 3;

export const STORY_PROMPTS: { key: string; label: string }[] = [
  { key: 'changed_mind', label: 'A time I changed my mind about someone' },
  { key: 'showed_up', label: 'A time I showed up for someone' },
  { key: 'got_wrong', label: 'Something I got wrong, and what I learned' },
  { key: 'small_moment', label: 'A small moment that changed how I see something' },
  { key: 'figuring_out', label: "Something I'm still trying to figure out" },
  { key: 'unreasonably_proud', label: "Something small I'm unreasonably proud of" },
];

export function storyPromptLabel(key: string): string {
  return STORY_PROMPTS.find((p) => p.key === key)?.label ?? 'A story';
}

// Memory-jogging questions only. The AI and the app never write the story.
export const STORY_REFLECTION_QUESTIONS = [
  'Pick one specific moment. Where were you, and who was there?',
  'What did you notice, feel, or decide in that moment?',
  "It's fine to leave it unfinished. What part are you still thinking about?",
];

export type Story = { prompt_key: string; text: string };

export function normalizeStories(raw: unknown): Story[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s.prompt_key === 'string' && typeof s.text === 'string')
    .map((s) => ({ prompt_key: s.prompt_key as string, text: (s.text as string).slice(0, STORY_MAX_LENGTH) }))
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
