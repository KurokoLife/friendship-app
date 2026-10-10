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

export type InterestResult =
  | { status: 'waiting' }
  | { status: 'mutual'; connectionId: string }
  | { status: 'not_verified' }
  | { status: 'selfie_pending' }
  | { status: 'ended' }
  | { status: 'error'; message: string };

// Shown when someone says Interested while their selfie waits for review.
export const SELFIE_PENDING_COPY =
  "Your selfie is waiting for our review, usually less than a day. Once it's approved you can say Interested and send first messages.";

export async function expressInterest(otherId: string): Promise<InterestResult> {
  const { data, error } = await supabase.rpc('express_interest', { p_other_user_id: otherId });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('selfie_pending')) return { status: 'selfie_pending' };
    if (message.includes('not_verified')) return { status: 'not_verified' };
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
  const result = data as { mutual?: boolean; connection_id?: string } | null;
  if (result?.mutual && result.connection_id) return { status: 'mutual', connectionId: result.connection_id };
  return { status: 'waiting' };
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
const SCAM_PATTERNS: RegExp[] = [
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bcash\s?app\b/i,
  /\bpaypal\b/i,
  /\bgift\s?cards?\b/i,
  /\bcrypto(currency)?\b/i,
  /\bbitcoin\b/i,
  /\bwire\s+(me|transfer|the money)\b/i,
  /\bwestern union\b/i,
  /\bsend (me )?(some )?money\b/i,
  /\bborrow (some )?money\b/i,
  /\bwhats\s?app\b/i,
  /\btelegram\b/i,
  /\bsignal app\b/i,
  /\bkik\b/i,
  /\bgoogle hangouts\b/i,
];

export function containsScamSignal(text: string): boolean {
  return SCAM_PATTERNS.some((pattern) => pattern.test(text));
}

// How many of the conversation's first messages are checked.
export const SCAM_CHECK_EARLY_MESSAGE_COUNT = 20;

export const SCAM_NOTE_COPY =
  'Limen will never ask you for money. Be careful with anyone who does, or who wants to move off the app quickly.';
