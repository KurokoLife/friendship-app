import { decode } from 'base64-arraybuffer';

import { CAPACITY_ERROR_MESSAGES } from '@/lib/connections';
import { supabase } from '@/lib/supabase';

// Safety plan, docs/DECISIONS.md section 3: the mutual Interested gate, the
// selfie check, and the scam-signal note. Server-side enforcement lives in
// migration 20261004000000 (express_interest, the messages insert policy,
// submit_selfie_check); this file is the client side.

// ---------------------------------------------------------------------
// Mutual "Interested"
// ---------------------------------------------------------------------

export type SelfieStatus = 'approved' | 'pending' | 'none' | 'rejected';
export type PendingWait = 'my_selfie' | 'their_selfie' | 'room';
export type InterestResult =
  // Saved in Inbox, Pending (2026-10-14). mutual: both said Interested but
  // the chat can't open yet (wait says why).
  | { status: 'waiting'; mutual: boolean; wait: PendingWait | null; selfie: SelfieStatus }
  | { status: 'mutual'; connectionId: string }
  | { status: 'ended' }
  | { status: 'error'; message: string };

// Shown when someone says Interested while their selfie waits for review.
export const SELFIE_PENDING_COPY =
  "Your selfie is waiting for our review, usually less than a day. Once it's approved you can say Interested and send first messages.";

export async function expressInterest(otherId: string): Promise<InterestResult> {
  const { data, error } = await supabase.rpc('express_interest', { p_other_user_id: otherId });
  if (error) {
    const message = error.message ?? '';
    // Word match, not includes(): 'suspended' also contains 'ended'.
    if (/\bended\b/.test(message)) return { status: 'ended' };
    if (message.includes('active_cap_reached')) return { status: 'error', message: CAPACITY_ERROR_MESSAGES.active_cap_reached };
    if (message.includes('pending_cap_reached')) return { status: 'error', message: CAPACITY_ERROR_MESSAGES.pending_cap_reached };
    if (message.includes('interest_cap_reached')) {
      return {
        status: 'error',
        message:
          "You're waiting to hear from 5 people already. Each one closes on its own after 30 days, and then you can say Interested again.",
      };
    }
    if (message.includes('blocked') || message.includes('unavailable')) {
      return { status: 'error', message: "This person isn't available right now." };
    }
    if (message.includes('suspended')) {
      return { status: 'error', message: 'Your account is paused while we review a report. Contact support if you think this is a mistake.' };
    }
    return { status: 'error', message: 'Something went wrong. Please try again.' };
  }
  const result = data as { mutual?: boolean; connection_id?: string; waiting?: PendingWait; selfie?: SelfieStatus } | null;
  if (result?.mutual && result.connection_id) return { status: 'mutual', connectionId: result.connection_id };
  return {
    status: 'waiting',
    mutual: Boolean(result?.mutual),
    wait: result?.waiting ?? null,
    selfie: result?.selfie ?? 'approved',
  };
}

// The ids of people the signed-in member already said Interested to. RLS
// only ever returns the member's own outgoing rows: nobody can see who is
// interested in them.
// Only open ones: an Interested closes after 30 days (2026-10-10).
export async function fetchMyInterestIds(): Promise<Set<string>> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('interests').select('to_user_id').gt('created_at', since);
  return new Set((data ?? []).map((r) => r.to_user_id as string));
}

export async function connectionHasMutualInterest(connectionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('connection_has_mutual_interest', { p_connection_id: connectionId });
  if (error) return false;
  return data === true;
}

// 2026-10-10, founder's wording. Uses the person's name rather than he or
// she, since gender isn't shown on profiles.
export function waitingForInterestCopy(name: string): string {
  return `Sent privately. If ${name} says Interested too, a chat opens for you both. ${name} is only told if that happens. People decide at their own pace, and that's okay. If it doesn't become mutual within 30 days, it closes on its own.`;
}
// What shows right after tapping Interested (2026-10-14): the person is
// always saved in Inbox, Pending, and the line says what happens next.
export function interestSavedCopy(name: string, r: Extract<InterestResult, { status: 'waiting' }>): string {
  const where = "You'll find them in Inbox, under Pending.";
  if (r.mutual) {
    if (r.wait === 'my_selfie') return `You and ${name} both said Interested. Your chat opens once your selfie is approved. ${where}`;
    if (r.wait === 'their_selfie') return `You and ${name} both said Interested. Your chat opens once ${name}'s selfie check is done. ${where}`;
    return `You and ${name} both said Interested. Your chat opens as soon as there's room. ${where}`;
  }
  const base = `${waitingForInterestCopy(name)} ${where}`;
  if (r.selfie === 'pending') return `${base} Your selfie is waiting for our review, usually within a day. Chats open once it's approved.`;
  if (r.selfie === 'none' || r.selfie === 'rejected') return `${base} Chats open once your selfie check is approved.`;
  return base;
}
export const WAITING_FOR_INTEREST_COPY = waitingForInterestCopy('they').replace('If they says', 'If they say').replace('they is only', "They're only");

// Saved (2026-10-10): at most 5, each for 30 days.
export async function saveForLater(otherId: string): Promise<'saved' | 'full' | 'error'> {
  const { data, error } = await supabase.rpc('save_for_later', { p_other_user_id: otherId });
  if (error) return 'error';
  return data === 'full' ? 'full' : 'saved';
}
export const SAVED_FULL_COPY =
  "You have 5 people saved, the most at one time. Saved people stay for 30 days, or you can remove one in Saved to make room.";

export type MyInterest = {
  other_user_id: string;
  display_name: string | null;
  age_band: string | null;
  created_at: string;
  closes_at: string;
  state: 'open' | 'closed';
};
export async function fetchMyInterests(): Promise<MyInterest[]> {
  const { data } = await supabase.rpc('my_interests');
  return (data ?? []) as MyInterest[];
}
export type PendingPerson = {
  other_user_id: string;
  display_name: string | null;
  age_band: string | null;
  created_at: string;
  closes_at: string;
  state: 'waiting' | 'my_selfie' | 'their_selfie' | 'room' | 'closed';
};
export async function fetchMyPending(): Promise<PendingPerson[]> {
  const { data } = await supabase.rpc('my_pending');
  return (data ?? []) as PendingPerson[];
}
export async function openReadyInterests(): Promise<number> {
  const { data } = await supabase.rpc('open_ready_interests');
  return typeof data === 'number' ? data : 0;
}
export async function fetchMySelfieStatus(): Promise<SelfieStatus> {
  const { data } = await supabase.rpc('my_selfie_state');
  return (data as SelfieStatus | null) ?? 'none';
}
export async function ackInterestClosures(): Promise<void> {
  await supabase.rpc('ack_interest_closures');
}

// ---------------------------------------------------------------------
// Selfie check (manual review, option A)
// ---------------------------------------------------------------------

// A random pose makes a stolen photo useless. The founder compares the
// selfie with the profile photo, then the selfie is deleted.
export const SELFIE_POSES = [
  'Touch your right ear with your right hand',
  'Hold up three fingers next to your face',
  'Give a thumbs up next to your chin',
  'Put your left hand flat on top of your head',
  'Make a peace sign beside your left cheek',
  'Cover one eye with your hand',
];

export function randomSelfiePose(): string {
  return SELFIE_POSES[Math.floor(Math.random() * SELFIE_POSES.length)];
}

export type SelfieState = {
  verified: boolean;
  status: 'none' | 'pending' | 'approved' | 'rejected';
};

export async function fetchSelfieState(): Promise<SelfieState> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { verified: false, status: 'none' };
  const [{ data: userRow }, { data: check }] = await Promise.all([
    supabase.from('users').select('selfie_verified_at').eq('id', user.id).maybeSingle(),
    supabase.from('selfie_checks').select('status').eq('user_id', user.id).maybeSingle(),
  ]);
  return {
    verified: Boolean(userRow?.selfie_verified_at),
    status: (check?.status as SelfieState['status'] | undefined) ?? 'none',
  };
}

export async function submitSelfieCheck(params: {
  pose: string;
  base64: string;
  fileExt: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Your session expired. Please sign in again.' };

  const ext = params.fileExt.toLowerCase().replace('jpeg', 'jpg');
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('selfie-checks')
    .upload(path, decode(params.base64), { contentType });
  if (uploadError) return { ok: false, message: "Your selfie didn't upload. Try again." };

  const { error } = await supabase.rpc('submit_selfie_check', { p_pose: params.pose, p_storage_path: path });
  if (error) return { ok: false, message: 'Something went wrong sending your selfie. Try again.' };
  return { ok: true };
}

// ---------------------------------------------------------------------
// Scam-signal note
// ---------------------------------------------------------------------

// A plain word list, checked on the receiver's phone. Nothing is scored,
// sent anywhere, or stored. It targets the two classic scam moves: asking
// for money and moving the conversation off the app quickly.
// Widened 2026-10-10 (founder test: "money", "apple card" and "whatsup"
// slipped through). A false alarm only shows one calm, general line, so
// the list leans toward catching more.
const SCAM_PATTERNS: RegExp[] = [
  // Money
  /\bmoney\b/i,
  /\bcash\b/i,
  /\$\s?\d/,
  /\b\d+\s?(dollars|bucks|usd)\b/i,
  /\b(loan|lend|borrow)\b/i,
  /\bpay (me|for)\b/i,
  /\b(venmo|zelle|paypal|cash\s?app|western union|moneygram)\b/i,
  /\bapple\s?(card|cash|pay)\b/i,
  /\bgoogle\s?pay\b/i,
  /\b(gift|itunes|steam|amazon|google play)\s?cards?\b/i,
  /\b(crypto(currency)?|bitcoin|btc|usdt|ethereum|forex)\b/i,
  /\binvest(ment|ing)? (opportunity|platform|plan|with me)\b/i,
  /\bwire\b/i,
  /\b(bank account|routing number|account number)\b/i,
  // Moving off the app
  /\bwh?at+s?\s?app?\b/i,
  // "whatsup" is also a greeting, so only when it's about moving there.
  /\b(on|via|use|add me on|talk on|chat on|message me on)\s+wh?at+s?\s?up\b/i,
  /\bwa\.me\b/i,
  /\b(telegram|kik|wechat|snapchat|google hangouts)\b/i,
  /\bsignal app\b/i,
  /\boff (the|this) app\b/i,
  /\b(text|call|message) me (at|on)\b/i,
  /\bmy (phone )?number\b/i,
  /\b\d{3}[-.\s)]?\s?\d{3}[-.\s]?\d{4}\b/,
  /[\w.+-]+@[\w-]+\.[\w.]+/,
];

export function containsScamSignal(text: string): boolean {
  return SCAM_PATTERNS.some((pattern) => pattern.test(text));
}

// Checked until the two of you have met in person. Scammers don't meet;
// friends who have met can talk about money and phone numbers freely.
// Before 2026-10-10 only the first 20 messages were checked, so a longer
// chat never showed the note.
export const SCAM_CHECK_EARLY_MESSAGE_COUNT = 20;

export const SCAM_NOTE_COPY =
  'Limen will never ask you for money. Be careful with anyone who does, or who wants to move off the app quickly.';
