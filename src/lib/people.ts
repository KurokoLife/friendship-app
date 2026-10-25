import { supabase } from '@/lib/supabase';

// Your people (rebuild stage 1, 2026-10-25, docs/context/05_LIMEN_REBUILD.md).
// Four circles. Limen people are placed on their own (my_people), friends
// from outside Limen are added by hand (outside_friends). Everything here
// is private to the person: own rows only.

export type Circle = 'close' | 'friends' | 'getting_to_know' | 'reconnect';

export const CIRCLES: Circle[] = ['close', 'friends', 'getting_to_know', 'reconnect'];

export const CIRCLE_LABELS: Record<Circle, string> = {
  close: 'Close',
  friends: 'Friends',
  getting_to_know: 'Getting to know',
  reconnect: 'Want to reconnect',
};

export type Rhythm = 'few_days' | 'week' | 'two_weeks' | 'month' | 'few_months' | 'few_times_year' | 'none';

export const RHYTHM_LABELS: Record<Rhythm, string> = {
  few_days: 'Every few days',
  week: 'Every week',
  two_weeks: 'Every two weeks',
  month: 'Every month',
  few_months: 'Every few months',
  few_times_year: 'A few times a year',
  none: 'No suggestions',
};

// Choices that fit each circle. Keep in step with rhythm_fits_circle()
// (20261025000000_your_people.sql).
export const CIRCLE_RHYTHMS: Record<Circle, Rhythm[]> = {
  getting_to_know: ['few_days', 'week', 'two_weeks'],
  close: ['week', 'two_weeks', 'month'],
  friends: ['two_weeks', 'month', 'few_months'],
  reconnect: ['few_days', 'week', 'two_weeks', 'month', 'few_months', 'few_times_year', 'none'],
};

export const DEFAULT_RHYTHM: Record<Circle, Rhythm> = {
  getting_to_know: 'week',
  close: 'week',
  friends: 'month',
  reconnect: 'few_times_year',
};

// One true line under the rhythm choices (05, decided wording).
export const RHYTHM_LINES: Record<Circle, string> = {
  getting_to_know: "New friendships grow fastest when you're in touch every week or so.",
  close: 'Most people are in touch with their closest friends about once a week.',
  friends: 'Most people catch up with good friends about once a month.',
  reconnect: 'A check-in tells someone they matter to you.',
};

export function rhythmFits(circle: Circle, rhythm: Rhythm): boolean {
  return CIRCLE_RHYTHMS[circle].includes(rhythm);
}

export type LimenPerson = {
  other_user_id: string;
  connection_id: string | null;
  display_name: string | null;
  // chat: an open chat; paused; waiting: you said Interested, no chat yet;
  // friend: graduated.
  state: 'chat' | 'paused' | 'waiting' | 'friend';
  auto_circle: Circle;
  circle: Circle;
  moved: boolean;
};

export type OutsideFriend = {
  id: string;
  name: string;
  circle: Circle;
  rhythm: Rhythm;
  note: string | null;
  created_at: string;
};

export const NAME_MAX = 60;
export const NOTE_MAX = 1000;

export async function fetchMyPeople(): Promise<LimenPerson[]> {
  const { data } = await supabase.rpc('my_people');
  return (data ?? []) as LimenPerson[];
}

export async function fetchOutsideFriends(): Promise<OutsideFriend[]> {
  const { data } = await supabase
    .from('outside_friends')
    .select('id, name, circle, rhythm, note, created_at')
    .order('name', { ascending: true });
  return (data ?? []) as OutsideFriend[];
}

export async function fetchOutsideFriend(id: string): Promise<OutsideFriend | null> {
  const { data } = await supabase
    .from('outside_friends')
    .select('id, name, circle, rhythm, note, created_at')
    .eq('id', id)
    .maybeSingle();
  return (data as OutsideFriend | null) ?? null;
}

export type FriendInput = { name: string; circle: Circle; rhythm: Rhythm; note: string };

export async function saveOutsideFriend(id: string | null, input: FriendInput): Promise<{ id: string } | { error: string }> {
  const row = {
    name: input.name.trim().slice(0, NAME_MAX),
    circle: input.circle,
    rhythm: rhythmFits(input.circle, input.rhythm) ? input.rhythm : DEFAULT_RHYTHM[input.circle],
    note: input.note.trim() ? input.note.trim().slice(0, NOTE_MAX) : null,
  };
  if (id) {
    const { error } = await supabase.from('outside_friends').update(row).eq('id', id);
    return error ? { error: error.message } : { id };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'not_signed_in' };
  const { data, error } = await supabase
    .from('outside_friends')
    .insert({ ...row, user_id: user.id })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'not_saved' };
  return { id: (data as { id: string }).id };
}

export async function removeOutsideFriend(id: string): Promise<boolean> {
  const { error } = await supabase.from('outside_friends').delete().eq('id', id);
  return !error;
}

// Moving a friend from outside Limen keeps their rhythm when it fits the
// new circle, otherwise it starts from that circle's usual one.
export async function moveOutsideFriend(friend: OutsideFriend, circle: Circle): Promise<boolean> {
  const rhythm = rhythmFits(circle, friend.rhythm) ? friend.rhythm : DEFAULT_RHYTHM[circle];
  const { error } = await supabase.from('outside_friends').update({ circle, rhythm }).eq('id', friend.id);
  return !error;
}

export async function moveLimenPerson(otherUserId: string, circle: Circle): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_person_circle', { p_other_user_id: otherUserId, p_circle: circle });
  return !error && data === 'ok';
}
