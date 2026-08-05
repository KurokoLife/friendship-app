import { supabase } from '@/lib/supabase';

// Shared by RememberEntryComposer (create) and the Timeline's own inline
// edit (item 1, 2026-08-15), moved here so both stay byte-identical
// rather than risking drift between two copies of the same validation.
// Plain YYYY-MM-DD text input rather than a native date picker, matching
// this project's own established precedent (profile-basics.tsx's
// birthdate field, for the same stale-Metro-bundle-after-a-native-
// dependency-change reason documented there). Returns null for an empty
// string (the date is optional), a Date for a valid one, or undefined for
// genuinely invalid text so the caller can tell "not provided" apart from
// "typo".
export function parseMeetupDate(text: string): Date | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return undefined;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
    return undefined;
  }
  return date;
}

// Formats a parsed Date back into YYYY-MM-DD using its own local
// getFullYear/getMonth/getDate (never toISOString, which would convert
// through UTC and risk the exact off-by-one-day bug item 2 of this same
// session fixed on the display side, see dateLabel in
// remember/[connectionId].tsx).
export function formatMeetupDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 2026-08-12: a real, previously blocked cap/pool response used to
// throw a plain Error here, whose own comment claimed it "surfaces
// through the same error-display path every other failure already uses,
// no new UI state needed" — but both real callers (remember-entry-
// composer.tsx, remember/[connectionId].tsx) used a bare `catch {}` that
// discarded `err.message` entirely, replacing it with a generic fallback
// string. The user never saw the real blocked message, let alone an
// upgrade option. Distinguished as its own error type so callers can
// check `instanceof` and show the real message plus, for a free-tier
// block, an "Upgrade to Premium" link, matching universal-text-box's
// own CreditBlockedError pattern.
export class RememberBlockedError extends Error {
  tier?: string;
  constructor(message: string, tier?: string) {
    super(message);
    this.tier = tier;
  }
}

// Remember: private, per-user notes about a friendship. Built against the
// milestone/elapsed-time meetup system (2026-07-28 redesign), not the
// original date-based spec, see the migration's own header comment.
// "Timeline by meetup number" uses connections.meetup_count (only
// incremented on mutual "went well" confirmation), not a raw date.

export type RememberPerson = {
  connection_id: string;
  other_user_id: string;
  display_name: string | null;
  photo_url: string | null;
  meetup_count: number;
  entry_count: number;
  latest_entry_snippet: string | null;
  latest_entry_raw: string | null;
  latest_entry_at: string | null;
};

export type RememberEntry = {
  id: string;
  connection_id: string;
  user_id: string;
  raw_text: string;
  organized_text: string | null;
  follow_up_note: string | null;
  meetup_number_at_entry: number;
  created_at: string;
  // The actual date the user says the meetup happened, optional, display
  // only (never a sort key, see the migration's own header comment).
  // Null for older entries and for anyone who skips picking one, in which
  // case the Timeline falls back to created_at.
  meetup_date: string | null;
};

export async function fetchRememberPeople(): Promise<RememberPerson[]> {
  const { data } = await supabase
    .from('remember_people')
    .select('*')
    .order('latest_entry_at', { ascending: false, nullsFirst: false });
  return (data ?? []) as RememberPerson[];
}

// Chronological by real confirmed meetup number, not raw date. created_at
// is only a tiebreaker between entries that share the same
// meetup_number_at_entry bucket (for example two notes both written
// before the first confirmed meetup).
export async function fetchTimelineEntries(connectionId: string): Promise<RememberEntry[]> {
  const { data } = await supabase
    .from('remember_entries')
    .select('*')
    .eq('connection_id', connectionId)
    .order('meetup_number_at_entry', { ascending: true })
    .order('created_at', { ascending: true });
  return (data ?? []) as RememberEntry[];
}

// "Summarize for me" on the Timeline screen: explicit, user-tapped, never
// ambient (same choice pattern as "Organize with AI" on a single entry).
// Regenerated fresh on every call, nothing is cached client- or
// server-side, see the edge function's own header comment for why.
export async function summarizeRememberTimeline(connectionId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('summarize-remember-timeline', {
    body: { connectionId },
  });
  if (error) throw error;
  if (data?.blocked) throw new RememberBlockedError(data.message as string, data.tier as string | undefined);
  if (data?.error) throw new Error(data.error as string);
  if (!data?.summary) throw new Error('No summary returned');
  return data.summary as string;
}

export async function organizeRememberEntry(
  rawText: string,
  otherName: string
): Promise<{ summary: string; followUp: string | null }> {
  const { data, error } = await supabase.functions.invoke('organize-remember-entry', {
    body: { rawText, otherName },
  });
  if (error) throw error;
  if (data?.blocked) throw new RememberBlockedError(data.message as string, data.tier as string | undefined);
  if (data?.error) throw new Error(data.error as string);
  if (!data?.summary) throw new Error('No summary returned');
  return { summary: data.summary as string, followUp: (data.followUp as string | null) ?? null };
}

// Only ever called after the user has explicitly approved what's being
// saved (raw text is always theirs; organizedText/followUpNote, when
// present, have already been shown back to them, editable, before this
// runs). Never called automatically the moment AI output comes back.
export async function saveRememberEntry(params: {
  connectionId: string;
  userId: string;
  rawText: string;
  organizedText: string | null;
  followUpNote: string | null;
  // Optional, user-picked "when this actually happened" date (YYYY-MM-DD),
  // display only, see the migration's own header comment for why this is
  // never used for ordering.
  meetupDate: string | null;
}): Promise<void> {
  await supabase.from('remember_entries').insert({
    connection_id: params.connectionId,
    user_id: params.userId,
    raw_text: params.rawText,
    meetup_date: params.meetupDate,
    organized_text: params.organizedText,
    follow_up_note: params.followUpNote,
  });
}

// Item 1, 2026-08-15: direct edit, no AI-organize step. A deliberately
// different flow from saveRememberEntry's own create-time raw-vs-AI
// choice: at edit time there's already real content on screen (the
// user's own prior raw text, and possibly an already-approved organized
// version), so the need is corrective/additive ("fix or expand"), not
// "start from a blank page and decide whether AI should help." Keeps
// the user in direct control of already-approved text rather than
// reopening a new AI-invocation surface on top of it. organizedText/
// followUpNote are optional here specifically so a raw-only entry stays
// raw-only unless the caller explicitly passes a value for them.
export async function updateRememberEntry(params: {
  entryId: string;
  rawText: string;
  organizedText?: string | null;
  followUpNote?: string | null;
  meetupDate: string | null;
}): Promise<void> {
  const update: Record<string, unknown> = {
    raw_text: params.rawText,
    meetup_date: params.meetupDate,
  };
  if (params.organizedText !== undefined) update.organized_text = params.organizedText;
  if (params.followUpNote !== undefined) update.follow_up_note = params.followUpNote;
  const { error } = await supabase.from('remember_entries').update(update).eq('id', params.entryId);
  if (error) throw error;
}

export async function deleteRememberEntry(entryId: string): Promise<void> {
  await supabase.from('remember_entries').delete().eq('id', entryId);
}

export async function deleteAllEntriesForConnection(connectionId: string): Promise<void> {
  await supabase.from('remember_entries').delete().eq('connection_id', connectionId);
}

// Pre-meetup reminder (Step 2 of the Remember spec): there's no
// scheduled_at anymore to anchor a "day before" reminder to, so this is
// read at the next real planning moment instead, when "Let's plan
// something" is re-engaged for a connection that already has entries.
// Prefers the most recent follow-up note (a concrete "ask about X"); when
// no entry has one, falls back to the most recent organized summary, then
// the most recent raw text, so a reminder can still surface even from an
// entry someone chose to save without AI organizing.
export async function fetchLatestRememberNote(connectionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('remember_entries')
    .select('organized_text, follow_up_note, raw_text')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .limit(5);
  const entries = (data ?? []) as { organized_text: string | null; follow_up_note: string | null; raw_text: string }[];
  const withFollowUp = entries.find((e) => e.follow_up_note);
  if (withFollowUp) return withFollowUp.follow_up_note;
  const latest = entries[0];
  if (!latest) return null;
  return latest.organized_text ?? latest.raw_text;
}

// A real export, not just a UI promise: every entry the caller has ever
// written, across every connection, grouped by person. JSON is the
// canonical format (nothing is lost, structure is preserved); the screen
// that calls this decides how to hand it to the user (a browser download
// on web, the native Share sheet elsewhere).
export async function buildRememberExport(): Promise<string> {
  const [{ data: people }, { data: entries }] = await Promise.all([
    supabase.from('remember_people').select('*'),
    supabase.from('remember_entries').select('*').order('created_at', { ascending: true }),
  ]);

  const peopleList = (people ?? []) as RememberPerson[];
  const entryList = (entries ?? []) as RememberEntry[];

  const byConnection = new Map<string, RememberPerson>();
  for (const p of peopleList) byConnection.set(p.connection_id, p);

  const grouped: Record<string, { display_name: string | null; entries: RememberEntry[] }> = {};
  for (const entry of entryList) {
    const person = byConnection.get(entry.connection_id);
    const key = entry.connection_id;
    if (!grouped[key]) {
      grouped[key] = { display_name: person?.display_name ?? 'A member', entries: [] };
    }
    grouped[key].entries.push(entry);
  }

  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      people: Object.values(grouped),
    },
    null,
    2
  );
}
