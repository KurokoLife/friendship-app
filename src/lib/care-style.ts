import { supabase } from '@/lib/supabase';

// Limen v2 (2026-10-03): "How I like care." Each user may write, in their
// own words, how they like to be cared for (no categories, no quiz, never
// used for matching; the evidence for matching "love languages" is weak,
// Impett, Park & Muise 2024). It's shown only to people they're actually
// connected with, inside Reflect, so the other person can respond in a way
// that works for them instead of guessing. See docs/LIMEN_V2_DECISIONS.md.

export const CARE_STYLE_MAX_LENGTH = 400;

export const CARE_STYLE_PROMPT = 'How do you like people to show they care? Say it your way.';
export const CARE_STYLE_EXAMPLES =
  'For example: when you are stressed, do you want to be asked about it or distracted from it? What small things make you feel remembered?';

export async function fetchConnectionCareStyle(connectionId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_connection_care_style', { p_connection_id: connectionId });
  if (error) return null;
  const text = typeof data === 'string' ? data.trim() : '';
  return text.length > 0 ? text : null;
}
