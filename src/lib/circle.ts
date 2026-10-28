import { decode } from 'base64-arraybuffer';

import type { PickedPhoto } from '@/lib/photo-picker';
import { supabase } from '@/lib/supabase';

// Your circle (rebuild stage 1, 2026-10-25, docs/context/05_LIMEN_REBUILD.md).
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
  photo_url: string | null;
};

export type OutsideFriend = {
  id: string;
  name: string;
  circle: Circle;
  rhythm: Rhythm;
  note: string | null;
  created_at: string;
  // Filled in by stage 3 ("I reached out"); until then the added date counts.
  last_reached_at: string | null;
  // Private photo in the friend-photos bucket (owner's folder), or none.
  photo_path: string | null;
  // A linked phone contact (stage 3): only its id on that phone, never a
  // number or an email.
  contact_id: string | null;
};

const FRIEND_COLUMNS = 'id, name, circle, rhythm, note, created_at, last_reached_at, photo_path, contact_id';

export const NAME_MAX = 60;
export const NOTE_MAX = 1000;

export async function fetchMyPeople(): Promise<LimenPerson[]> {
  const { data } = await supabase.rpc('my_people');
  return (data ?? []) as LimenPerson[];
}

export async function fetchOutsideFriends(): Promise<OutsideFriend[]> {
  const { data } = await supabase
    .from('outside_friends')
    .select(FRIEND_COLUMNS)
    .order('name', { ascending: true });
  return (data ?? []) as OutsideFriend[];
}

export async function fetchOutsideFriend(id: string): Promise<OutsideFriend | null> {
  const { data } = await supabase
    .from('outside_friends')
    .select(FRIEND_COLUMNS)
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
  const { data } = await supabase.from('outside_friends').select('photo_path').eq('id', id).maybeSingle();
  const path = (data as { photo_path: string | null } | null)?.photo_path;
  if (path) await supabase.storage.from(FRIEND_PHOTOS).remove([path]);
  const { error } = await supabase.from('outside_friends').delete().eq('id', id);
  return !error;
}

// ---- Next check-in date (2026-10-26, stage 1c) ----------------------------
// The rule lives in ONE place, the database (20261026000000_circle_person_page.sql):
// outside_friend_next_check_in picks where the count starts (the last time
// you reached out to that person, or the day they were added) and
// circle_next_check_in adds the rhythm you chose. The person page and the
// line under the rhythm choice ask it; stage 3 suggestions must use the same
// functions. Only the wording of the line is here.

// The day something happened, in this device's own time zone, as YYYY-MM-DD.
export function localDay(iso: string | Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// The next check-in day (YYYY-MM-DD) for a saved friend (optionally with a
// rhythm not saved yet), or for someone being added today. null = no date
// (the "No suggestions" rhythm).
export async function nextCheckIn(friendId: string | null, rhythm: Rhythm): Promise<string | null> {
  const { data, error } = friendId
    ? await supabase.rpc('outside_friend_next_check_in', { p_friend_id: friendId, p_tz: deviceTimeZone(), p_rhythm: rhythm })
    : await supabase.rpc('circle_next_check_in', { p_from: localDay(), p_rhythm: rhythm });
  if (error) return null;
  return (data as string | null) ?? null;
}

// "Limen will bring Momo up again around Nov 8." (05, decided wording).
export function nextCheckInLine(name: string, day: string | null, rhythm: Rhythm): string {
  const first = name.trim().split(/\s+/)[0] || 'them';
  if (rhythm === 'none' || !day) return `Limen won't bring ${first} up on its own.`;
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date.getTime() <= today.getTime()) return `Limen will bring ${first} up again soon.`;
  const label = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  });
  return `Limen will bring ${first} up again around ${label}.`;
}

// ---- Photos for friends outside Limen (2026-10-26) --------------------------
// Private: a file in the friend-photos bucket, in the owner's own folder.
// Only its owner can read it (through a short-lived signed link); it's used
// for nothing but their face in Your circle.
export const FRIEND_PHOTOS = 'friend-photos';

export async function friendPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(FRIEND_PHOTOS).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function setFriendPhoto(friendId: string, photo: PickedPhoto): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: old } = await supabase.from('outside_friends').select('photo_path').eq('id', friendId).maybeSingle();
  const path = `${user.id}/${friendId}-${Date.now()}.${photo.ext}`;
  const { error } = await supabase.storage
    .from(FRIEND_PHOTOS)
    .upload(path, decode(photo.base64), { contentType: photo.contentType, upsert: true });
  if (error) return false;
  const { error: saveError } = await supabase.from('outside_friends').update({ photo_path: path }).eq('id', friendId);
  if (saveError) {
    await supabase.storage.from(FRIEND_PHOTOS).remove([path]);
    return false;
  }
  const oldPath = (old as { photo_path: string | null } | null)?.photo_path;
  if (oldPath && oldPath !== path) await supabase.storage.from(FRIEND_PHOTOS).remove([oldPath]);
  return true;
}

export async function removeFriendPhoto(friend: OutsideFriend): Promise<boolean> {
  if (!friend.photo_path) return true;
  const { error } = await supabase.from('outside_friends').update({ photo_path: null }).eq('id', friend.id);
  if (error) return false;
  await supabase.storage.from(FRIEND_PHOTOS).remove([friend.photo_path]);
  return true;
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

// The one line under a Limen person's name in Your circle.
export const LIMEN_STATE_LABELS: Record<LimenPerson['state'], string> = {
  chat: 'Chatting on Limen',
  paused: 'Chatting on Limen, paused',
  waiting: 'Waiting to connect',
  friend: 'Met on Limen',
};

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Why someone you said Interested to is still waiting (wording from the
// old Inbox Pending tab, 2026-10-14). The other person is never told.
export function waitingLine(p: { display_name: string | null; state: string; closes_at: string }): string {
  const first = (p.display_name ?? 'They').split(' ')[0];
  const why =
    p.state === 'my_selfie'
      ? 'You both said Interested. Your chat opens once your selfie is approved.'
      : p.state === 'their_selfie'
        ? `You both said Interested. Your chat opens once ${first}'s selfie check is done.`
        : p.state === 'room'
          ? "You both said Interested. Your chat opens as soon as there's room for a new chat."
          : `Waiting for ${first}. If ${first} says Interested too, you can say hello.`;
  return `${why} Closes on its own on ${shortDay(p.closes_at)} if a chat hasn't opened.`;
}
