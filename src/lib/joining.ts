import { supabase } from '@/lib/supabase';

// Joining (rebuild stage 2, 2026-10-26, docs/context/05_LIMEN_REBUILD.md
// "Joining (decided)"). The answers live in joining_answers, one private row
// per person (own-row RLS, migration 20261026000001_joining.sql). Never used
// for matching, never shown to anyone else.

export type HardestKey =
  | 'meeting_new'
  | 'keeping_in_touch'
  | 'plans_happen'
  | 'friendly_to_real'
  | 'reconnecting'
  | 'always_reaching_out'
  | 'not_sure_wanted'
  | 'dont_know_me'
  | 'finding_time'
  | 'other';

// Exact wording from 05, in its order.
export const HARDEST_OPTIONS: { key: HardestKey; label: string }[] = [
  { key: 'meeting_new', label: 'Meeting new people' },
  { key: 'keeping_in_touch', label: 'Keeping in touch with friends I have' },
  { key: 'plans_happen', label: 'Getting plans to actually happen' },
  { key: 'friendly_to_real', label: 'Going from friendly to real friends' },
  { key: 'reconnecting', label: "Reconnecting with people I've lost touch with" },
  { key: 'always_reaching_out', label: "I'm usually the one who reaches out" },
  { key: 'not_sure_wanted', label: 'Not sure people want to hear from me' },
  { key: 'dont_know_me', label: "Friends don't really know what's going on with me" },
  { key: 'finding_time', label: 'Finding the time' },
  { key: 'other', label: 'Something else' },
];

export const HARDEST_OTHER_MAX = 300;

export type GoalKey = 'keep_in_touch' | 'reconnect' | 'meet_new' | 'plans' | 'patterns';

// Exact wording from 05, in its order.
export const GOAL_OPTIONS: { key: GoalKey; label: string }[] = [
  { key: 'keep_in_touch', label: 'Keep in touch with the people I have' },
  { key: 'reconnect', label: 'Reconnect with someone' },
  { key: 'meet_new', label: 'Meet someone new' },
  { key: 'plans', label: 'Make plans actually happen' },
  { key: 'patterns', label: 'Notice my own patterns' },
];

// How "What's hardest" fills in "Here's where Limen can help" (draft,
// waiting for the founder's OK). Each answer turns on the goals it points
// to; the person can change anything.
export const HARDEST_TO_GOALS: Record<HardestKey, GoalKey[]> = {
  meeting_new: ['meet_new'],
  keeping_in_touch: ['keep_in_touch'],
  plans_happen: ['plans'],
  friendly_to_real: ['plans'],
  reconnecting: ['reconnect'],
  always_reaching_out: ['patterns'],
  not_sure_wanted: ['keep_in_touch', 'patterns'],
  dont_know_me: ['keep_in_touch'],
  finding_time: ['plans'],
  other: [],
};

export function goalsFromHardest(hardest: HardestKey[]): GoalKey[] {
  const picked = new Set(hardest.flatMap((h) => HARDEST_TO_GOALS[h] ?? []));
  // Nothing points anywhere (nothing picked, or only "Something else"):
  // start from keeping in touch, the part everyone has.
  if (picked.size === 0) picked.add('keep_in_touch');
  return GOAL_OPTIONS.map((g) => g.key).filter((k) => picked.has(k));
}

export type JoiningAnswers = {
  hardest: HardestKey[];
  hardest_other: string | null;
  goals: GoalKey[] | null;
  hardest_at: string | null;
  friends_at: string | null;
  goals_at: string | null;
  meet_offer_hidden_at: string | null;
};

export async function fetchJoining(): Promise<JoiningAnswers | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('joining_answers')
    .select('hardest, hardest_other, goals, hardest_at, friends_at, goals_at, meet_offer_hidden_at')
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as JoiningAnswers | null) ?? null;
}

// Saves part of the row (creating it the first time). Saves as you go.
export async function saveJoining(patch: Partial<JoiningAnswers>): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('joining_answers')
    .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return !error;
}

// Did this person choose "Meet someone new"? Members who joined before
// stage 2 have no row and count as yes.
export function wantsToMeetNew(j: JoiningAnswers | null): boolean {
  return !j || j.goals === null || j.goals.includes('meet_new');
}

// Adds "Meet someone new" (finishing the profile later from Your circle or
// Discover). Called at "Before you start", once the profile is done.
export async function addMeetNew(): Promise<boolean> {
  const j = await fetchJoining();
  if (wantsToMeetNew(j)) return true;
  return saveJoining({ goals: [...(j?.goals ?? []), 'meet_new'] });
}

// A finished member (readiness set) who skipped the profile: lets them in
// without "Before you start", which is about meeting new people.
export async function finishJoiningWithoutProfile(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase.from('users').update({ readiness_status: 'ready', paused_until: null }).eq('id', user.id);
  return !error;
}
