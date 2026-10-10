import { supabase } from '@/lib/supabase';

// Remember (2026-10-10, docs/DECISIONS.md section 9). Private notes about
// one friend, kept inside the chat and organized by meetup. Written in the
// person's own words: no AI anywhere here. Own-row RLS only, the other
// person never sees any of it.

export type RememberNote = {
  id: string;
  connection_id: string;
  meetup_id: string | null;
  learned: string | null;
  smiled: string | null;
  ask_next: string | null;
  ask_next_done_at: string | null;
  raw_text: string;
  // Older notes (before 2026-10-10) may still carry an AI summary.
  organized_text: string | null;
  meetup_date: string | null;
  topics: TopicKey[] | null;
  created_at: string;
};

// Topic chips on free notes (2026-10-10). A short fixed list on purpose:
// custom tags get messy and add clutter. Stored as these keys.
export const TOPICS = [
  { key: 'family', label: 'Family' },
  { key: 'work', label: 'Work' },
  { key: 'loves', label: 'Things they love' },
  { key: 'going_through', label: 'Going through' },
  { key: 'ideas', label: 'Ideas for us' },
] as const;
export type TopicKey = (typeof TOPICS)[number]['key'];
export function topicLabel(key: string): string {
  return TOPICS.find((t) => t.key === key)?.label ?? key;
}

// Topic filters and search show only once there are this many notes for
// one person. Below that, a short list is easier to read.
export const FILTER_FROM_NOTES = 6;

// A free note is one open box: the first line is its title, the rest its
// body. Older notes between meetups may still use the three questions.
export function isFreeNote(n: RememberNote): boolean {
  return !n.meetup_id && !n.learned?.trim() && !n.smiled?.trim() && !n.ask_next?.trim();
}

export function splitTitle(text: string): { title: string; body: string } {
  const t = text.trim();
  const i = t.indexOf('\n');
  if (i === -1) return { title: t, body: '' };
  return { title: t.slice(0, i).trim(), body: t.slice(i + 1).trim() };
}

// Every word of a note, for search.
export function noteText(n: RememberNote): string {
  return [n.learned, n.smiled, n.ask_next, n.raw_text, n.organized_text].filter(Boolean).join(' ').toLowerCase();
}

export type RememberMeetup = {
  id: string;
  number: number; // 1 for the first meetup that happened, and so on
  date: string; // YYYY-MM-DD
  activity: string | null;
  place: string | null;
};

export type NoteFields = {
  learned: string;
  smiled: string;
  askNext: string;
  other: string;
};

export type OpenAsk = { noteId: string; text: string };

const NOTE_COLUMNS =
  'id, connection_id, meetup_id, learned, smiled, ask_next, ask_next_done_at, raw_text, organized_text, meetup_date, topics, created_at';

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// A plain YYYY-MM-DD date shown in the person's own calendar day (never
// through new Date(iso), which would read it as UTC midnight and show the
// day before for anyone in the US).
export function formatDay(day: string, withWeekday = true): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: withWeekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
  });
}

export function noteDay(note: RememberNote): string {
  if (note.meetup_date) return note.meetup_date;
  const d = new Date(note.created_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function noteIsEmpty(f: NoteFields): boolean {
  return !f.learned.trim() && !f.smiled.trim() && !f.askNext.trim() && !f.other.trim();
}

export function fieldsFromNote(note: RememberNote | null): NoteFields {
  return {
    learned: note?.learned ?? '',
    smiled: note?.smiled ?? '',
    askNext: note?.ask_next ?? '',
    other: note?.raw_text ?? '',
  };
}

// Meetups that happened in this chat, oldest first, numbered.
export async function fetchMeetupsThatHappened(connectionId: string): Promise<RememberMeetup[]> {
  const { data } = await supabase
    .from('meetups')
    .select('id, occurred_date, confirmed_date, proposed_date, activity, place, created_at')
    .eq('connection_id', connectionId)
    .eq('status', 'occurred')
    .order('occurred_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  return (
    (data ?? []) as {
      id: string;
      occurred_date: string | null;
      confirmed_date: string | null;
      proposed_date: string;
      activity: string | null;
      place: string | null;
    }[]
  ).map((m, i) => ({
    id: m.id,
    number: i + 1,
    date: m.occurred_date ?? m.confirmed_date ?? m.proposed_date,
    activity: m.activity,
    place: m.place,
  }));
}

export async function fetchNotes(connectionId: string): Promise<RememberNote[]> {
  const { data } = await supabase
    .from('remember_entries')
    .select(NOTE_COLUMNS)
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: true });
  return (data ?? []) as RememberNote[];
}

function clean(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

// Saves a note. With a meetupId, there's one note per meetup: it's updated
// if it exists. Without one, it's a note between meetups.
export async function saveNote(params: {
  connectionId: string;
  userId: string;
  meetupId: string | null;
  noteId: string | null;
  fields: NoteFields;
}): Promise<void> {
  const row = {
    learned: clean(params.fields.learned),
    smiled: clean(params.fields.smiled),
    ask_next: clean(params.fields.askNext),
    raw_text: params.fields.other.trim(),
    updated_at: new Date().toISOString(),
  };
  if (params.noteId) {
    const { data: before } = await supabase
      .from('remember_entries')
      .select('ask_next')
      .eq('id', params.noteId)
      .maybeSingle();
    const askChanged = (before as { ask_next: string | null } | null)?.ask_next !== row.ask_next;
    const { error } = await supabase
      .from('remember_entries')
      .update(askChanged ? { ...row, ask_next_done_at: null } : row)
      .eq('id', params.noteId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('remember_entries').insert({
    ...row,
    connection_id: params.connectionId,
    user_id: params.userId,
    meetup_id: params.meetupId,
  });
  if (error) throw error;
  if (params.meetupId) await markMeetupAsked(params.meetupId, params.userId);
}

// A free note: one open box plus optional topics. Not tied to a meetup.
export async function saveFreeNote(params: {
  connectionId: string;
  userId: string;
  noteId: string | null;
  text: string;
  topics: TopicKey[];
}): Promise<void> {
  const row = {
    raw_text: params.text.trim(),
    topics: params.topics,
    updated_at: new Date().toISOString(),
  };
  if (params.noteId) {
    const { error } = await supabase.from('remember_entries').update(row).eq('id', params.noteId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('remember_entries').insert({
    ...row,
    connection_id: params.connectionId,
    user_id: params.userId,
    meetup_id: null,
  });
  if (error) throw error;
}

// Notes marked "Ideas for us", newest first, for the planning card. Only
// the person who wrote them ever sees them.
export async function fetchIdeaNotes(connectionId: string): Promise<{ noteId: string; text: string }[]> {
  const { data } = await supabase
    .from('remember_entries')
    .select('id, raw_text, created_at')
    .eq('connection_id', connectionId)
    .contains('topics', ['ideas'])
    .order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; raw_text: string | null }[])
    .filter((n) => n.raw_text && n.raw_text.trim())
    .map((n) => ({ noteId: n.id, text: splitTitle(n.raw_text!).title }));
}

export async function deleteNote(noteId: string): Promise<void> {
  const { error } = await supabase.from('remember_entries').delete().eq('id', noteId);
  if (error) throw error;
}

export async function deleteAllNotes(connectionId: string): Promise<void> {
  const { error } = await supabase.from('remember_entries').delete().eq('connection_id', connectionId);
  if (error) throw error;
}

// "Asked": moves a question off the "Next time, ask..." list. Undo puts
// it back.
export async function setAsked(noteId: string, asked: boolean): Promise<void> {
  const { error } = await supabase
    .from('remember_entries')
    .update({ ask_next_done_at: asked ? new Date().toISOString() : null })
    .eq('id', noteId);
  if (error) throw error;
}

export function openAsksFrom(notes: RememberNote[]): OpenAsk[] {
  return notes
    .filter((n) => n.ask_next && n.ask_next.trim() && !n.ask_next_done_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((n) => ({ noteId: n.id, text: n.ask_next!.trim() }));
}

export async function fetchOpenAsks(connectionId: string): Promise<OpenAsk[]> {
  const { data } = await supabase
    .from('remember_entries')
    .select('id, ask_next, ask_next_done_at, created_at')
    .eq('connection_id', connectionId)
    .not('ask_next', 'is', null)
    .is('ask_next_done_at', null)
    .order('created_at', { ascending: false });
  return ((data ?? []) as { id: string; ask_next: string | null }[])
    .filter((n) => n.ask_next && n.ask_next.trim())
    .map((n) => ({ noteId: n.id, text: n.ask_next!.trim() }));
}

// After a meetup counts, the chat asks once: "Anything you'd like to
// remember about X?" Returns the meetup to ask about, or null. Only the
// most recent meetup, only within 3 weeks of it, only if there's no note
// for it yet and it hasn't been asked before.
const ASK_WINDOW_DAYS = 21;

export async function meetupToAskAbout(connectionId: string, userId: string): Promise<RememberMeetup | null> {
  const meetups = await fetchMeetupsThatHappened(connectionId);
  const latest = meetups[meetups.length - 1];
  if (!latest) return null;
  const [y, m, d] = latest.date.split('-').map(Number);
  if (Date.now() - new Date(y, m - 1, d).getTime() > ASK_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;
  const [{ data: note }, { data: asked }] = await Promise.all([
    supabase.from('remember_entries').select('id').eq('meetup_id', latest.id).maybeSingle(),
    supabase.from('remember_asks').select('meetup_id').eq('meetup_id', latest.id).eq('user_id', userId).maybeSingle(),
  ]);
  if (note || asked) return null;
  return latest;
}

export async function markMeetupAsked(meetupId: string, userId: string): Promise<void> {
  await supabase.from('remember_asks').upsert({ user_id: userId, meetup_id: meetupId }, { onConflict: 'user_id,meetup_id', ignoreDuplicates: true });
}

// A real export of every note, grouped by person. JSON keeps everything.
// Settings hands it to the person (a download on web, the Share sheet on a
// phone).
export async function buildRememberExport(): Promise<string> {
  const [{ data: notes }, { data: names }] = await Promise.all([
    supabase.from('remember_entries').select(NOTE_COLUMNS).order('created_at', { ascending: true }),
    supabase.from('connection_participant_profiles').select('connection_id, display_name'),
  ]);
  const nameFor = new Map<string, string | null>();
  for (const n of (names ?? []) as { connection_id: string; display_name: string | null }[]) {
    nameFor.set(n.connection_id, n.display_name);
  }
  const grouped: Record<string, { name: string; notes: unknown[] }> = {};
  for (const n of (notes ?? []) as RememberNote[]) {
    if (!grouped[n.connection_id]) grouped[n.connection_id] = { name: nameFor.get(n.connection_id) ?? 'A member', notes: [] };
    const free = isFreeNote(n);
    grouped[n.connection_id].notes.push({
      written: n.created_at,
      title: free && n.raw_text ? splitTitle(n.raw_text).title : null,
      topics: (n.topics ?? []).map(topicLabel),
      what_i_learned: n.learned,
      what_made_me_smile: n.smiled,
      next_time_id_love_to_ask: n.ask_next,
      asked: Boolean(n.ask_next_done_at),
      anything_else: n.raw_text || null,
      older_summary: n.organized_text,
    });
  }
  return JSON.stringify({ exported_at: new Date().toISOString(), people: Object.values(grouped) }, null, 2);
}
