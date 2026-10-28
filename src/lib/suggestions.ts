import { Linking, Platform } from 'react-native';

import { deviceTimeZone, type Circle, type Rhythm } from '@/lib/circle';
import { supabase } from '@/lib/supabase';

// Suggestions in Your circle (rebuild stage 3, 2026-10-28,
// docs/context/05_LIMEN_REBUILD.md "Suggestions (decided)"). One person at a
// time, from timing and your own notes only. The database decides who is due
// (get_circle_suggestion, migration 20261028000000), using the stage 1c rule:
// the last time you were in touch (or the day they were added) plus the
// rhythm. No streaks, no scores, never "habit".

export type SuggestionKind = 'in_touch' | 'interest' | 'positivity' | 'support' | 'openness' | 'time_together' | 'pattern';

export type Suggestion = {
  id: string;
  person_kind: 'outside' | 'limen' | 'pattern';
  person_id: string | null;
  kind: SuggestionKind;
  detail: string | null;
  name?: string;
  circle?: Circle;
  rhythm?: Rhythm;
  photo_url?: string | null;
  photo_path?: string | null;
  contact_id?: string | null;
  connection_id?: string | null;
};

export async function fetchSuggestion(): Promise<Suggestion | null> {
  const { data, error } = await supabase.rpc('get_circle_suggestion', { p_tz: deviceTimeZone() });
  if (error || !data) return null;
  return data as Suggestion;
}

export type ResolveResult =
  | { status: 'reached'; next_day: string | null }
  | { status: 'fewer'; circle: Circle; rhythm: Rhythm }
  | { status: 'slowest'; circle: Circle; rhythm: Rhythm }
  | { status: 'not_now' }
  | { status: 'not_open' }
  | { status: 'error' };

export async function resolveSuggestion(id: string, outcome: 'reached' | 'not_now' | 'fewer'): Promise<ResolveResult> {
  const { data, error } = await supabase.rpc('resolve_circle_suggestion', {
    p_id: id,
    p_outcome: outcome,
    p_tz: deviceTimeZone(),
  });
  if (error || !data) return { status: 'error' };
  return data as ResolveResult;
}

// ---- What the card says (05 wording; lines marked draft wait for the founder)
type Line = { line: string; why: string; source: string };

const first = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'them';

export function suggestionLine(s: Suggestion): Line {
  const n = first(s.name);
  switch (s.kind) {
    case 'interest':
      // Draft: 05's example is "You wanted to hear how Tom's new job is going."
      // Limen never rewrites a note, so the person's own words are quoted.
      return {
        line: `You wanted to ask ${n}: “${s.detail ?? ''}”`,
        why: 'A follow-up question shows you were listening.',
        source: 'Huang, Yeomans, Brooks, Minson and Gino (2017). "It doesn\'t hurt to ask: Question-asking increases liking." Journal of Personality and Social Psychology.',
      };
    case 'support':
      // Draft, same reason: the note's first line, quoted.
      return {
        line: `You noted this about ${n}: “${s.detail ?? ''}” How's that going, do you think?`,
        why: 'Being there in a hard stretch keeps friendships going.',
        source: 'Oswald, Clark and Kelly (2004). "Friendship maintenance: An analysis of individual and dyad behaviors." Journal of Social and Clinical Psychology.',
      };
    case 'positivity':
      return {
        line: `Anything ${n} did lately that you'd tell them was good?`,
        why: 'Kind words land better than we think.',
        source: 'Zhao and Epley (2021). "Insufficiently complimentary? Underestimating the positive impact of compliments creates a barrier to expressing them." Journal of Personality and Social Psychology.',
      };
    case 'openness':
      return {
        line: `Anything going on with you that ${n} doesn't know yet?`,
        why: 'Friends can only understand what they get to see.',
        source: 'Bruk, Scholl and Bless (2018). "Beautiful mess effect: Self-other differences in evaluation of showing vulnerability." Journal of Personality and Social Psychology.',
      };
    case 'time_together':
      return {
        line: `When did you and ${n} last get together?`,
        why: 'Friendships grow through time together in person.',
        source: 'Hall (2019). "How many hours does it take to make a friend?" Journal of Social and Personal Relationships.',
      };
    case 'in_touch':
    default:
      return {
        line: `You and ${n} haven't been in touch for a while.`,
        why: 'People enjoy hearing from a friend more than we expect.',
        source: 'Liu, Rim, Min and Min (2022). "The surprise of reaching out: Appreciated more than we think." Journal of Personality and Social Psychology.',
      };
  }
}

// "Why lines for check-ins" (05): shown once on the card.
export const CHECK_IN_WHY = 'A check-in tells someone they matter to you.';

// ---- Pattern noticing (05 question and choices; each answer's line is a draft)
export type PatternAnswer = 'busy' | 'what_to_say' | 'awkward' | 'different' | 'other';

export const PATTERN_QUESTION = "You've put off a few check-ins lately. What usually gets in the way?";

export const PATTERN_OPTIONS: { key: PatternAnswer; label: string; line: string }[] = [
  { key: 'busy', label: 'A busy stretch', line: 'Busy stretches pass. Two lines still count as being in touch.' },
  {
    key: 'what_to_say',
    label: 'Not sure what to say',
    line: 'Small is fine: a question about their week, a photo, or "this made me think of you."',
  },
  {
    key: 'awkward',
    label: "Worried it'll feel awkward",
    line: 'Most people are glad to hear from a friend, even after a while. The awkward part is usually shorter than we expect.',
  },
  {
    key: 'different',
    label: 'The friendship feels different now',
    line: 'Friendships change shape. On their page you can move someone to another circle or change how often Limen brings them up.',
  },
  { key: 'other', label: 'Something else', line: "Thanks. Only you see this, on your profile under You." },
];

export async function answerPattern(id: string, answer: PatternAnswer | null): Promise<boolean> {
  const { error } = await supabase.rpc('answer_circle_pattern', { p_id: id, p_answer: answer });
  return !error;
}

export type PatternEntry = { answer: PatternAnswer; created_at: string };

export async function fetchPatternAnswers(): Promise<PatternEntry[]> {
  const { data } = await supabase
    .from('circle_pattern_answers')
    .select('answer, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []) as PatternEntry[];
}

// ---- How often (05: a couple of times a week / once a week (default) / every
// two weeks; "Off" added so every reminder can be turned off, draft)
export type SuggestionFrequency = 'twice_week' | 'week' | 'two_weeks' | 'off';

export const FREQUENCY_OPTIONS: { key: SuggestionFrequency; label: string }[] = [
  { key: 'twice_week', label: 'A couple of times a week' },
  { key: 'week', label: 'Once a week' },
  { key: 'two_weeks', label: 'Every two weeks' },
  { key: 'off', label: 'No suggestions' },
];

export async function getFrequency(): Promise<SuggestionFrequency> {
  const { data } = await supabase.from('circle_suggestion_settings').select('frequency').maybeSingle();
  return ((data as { frequency: SuggestionFrequency } | null)?.frequency ?? 'week') as SuggestionFrequency;
}

export async function setFrequency(frequency: SuggestionFrequency): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('circle_suggestion_settings')
    .upsert({ user_id: user.id, frequency, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return !error;
}

// ---- Phone contacts (phone app only; 05, Desktop option A) -----------------
// Limen keeps only which contact it is (its id on this phone). The number or
// email is looked up on the phone when you tap Text, Call or Email, and the
// phone's own app opens with an empty message. Nothing is sent by Limen.
export const CAN_USE_CONTACTS = Platform.OS === 'ios' || Platform.OS === 'android';

type ContactsModule = typeof import('expo-contacts');
let contactsModule: ContactsModule | null = null;
function contacts(): ContactsModule | null {
  if (!CAN_USE_CONTACTS) return null;
  if (!contactsModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      contactsModule = require('expo-contacts') as ContactsModule;
    } catch {
      contactsModule = null;
    }
  }
  return contactsModule;
}

export type PickedContact = { id: string; name: string; imageBase64: string | null };

export async function pickContact(): Promise<PickedContact | null | 'denied'> {
  const C = contacts();
  if (!C) return null;
  try {
    const picked = await C.presentContactPickerAsync();
    if (!picked?.id) return null;
    let imageBase64: string | null = null;
    try {
      const perm = await C.getPermissionsAsync();
      if (perm.granted) {
        const full = await C.getContactByIdAsync(picked.id, [C.Fields.Image]);
        imageBase64 = full?.image?.base64 ?? null;
      }
    } catch {
      imageBase64 = null;
    }
    return { id: picked.id, name: picked.name ?? '', imageBase64 };
  } catch {
    return 'denied';
  }
}

export type ContactWays = { phone: string | null; email: string | null } | 'denied' | 'missing';

// Looks up how to reach a linked contact, on this phone only.
export async function contactWays(contactId: string): Promise<ContactWays> {
  const C = contacts();
  if (!C) return 'missing';
  try {
    let perm = await C.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await C.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    const c = await C.getContactByIdAsync(contactId, [C.Fields.PhoneNumbers, C.Fields.Emails]);
    if (!c) return 'missing';
    return {
      phone: c.phoneNumbers?.find((p) => p.number)?.number ?? null,
      email: c.emails?.find((e) => e.email)?.email ?? null,
    };
  } catch {
    return 'missing';
  }
}

export function openText(phone: string) {
  return Linking.openURL(`sms:${phone.replace(/[^\d+]/g, '')}`);
}
export function openCall(phone: string) {
  return Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}
export function openEmail(email: string) {
  return Linking.openURL(`mailto:${email}`);
}

export async function linkContact(friendId: string, contactId: string | null): Promise<boolean> {
  const { error } = await supabase.from('outside_friends').update({ contact_id: contactId }).eq('id', friendId);
  return !error;
}

// "I reached out" from a friend's own page: the next check-in date now counts
// from today (an open suggestion for them closes as reached on its own).
export async function markOutsideReached(friendId: string): Promise<boolean> {
  const { error } = await supabase
    .from('outside_friends')
    .update({ last_reached_at: new Date().toISOString() })
    .eq('id', friendId);
  return !error;
}
