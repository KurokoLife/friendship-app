import { supabase } from '@/lib/supabase';

// F16 update: detects a real behavioral mismatch (one participant replying
// much faster than the other) purely from actual message timestamps, not
// from either person's stated response_time preference. The note text
// itself then quotes the SLOWER person's stated preference, response time
// is for expectation-setting only, never for matching or filtering, this
// keeps that boundary intact: the trigger is behavior, the copy is a
// stated preference.
type MinimalMessage = { sender_id: string; created_at: string };

const MIN_SAMPLE = 3;

function avg(nums: number[]): number {
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

// Returns true if the viewer (myId) is replying substantially faster than
// the other participant, across enough real reply pairs to mean
// something. A "reply" is any message whose sender differs from the
// message immediately before it, the gap between them is attributed to
// whoever sent the later one. Requires at least 3 real replies from each
// side and the slower side averaging over 6 hours, so a single slow
// reply during a busy day doesn't trigger this.
export function isReplyingMuchFaster(messages: MinimalMessage[], myId: string): boolean {
  const myGaps: number[] = [];
  const theirGaps: number[] = [];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.sender_id === curr.sender_id) continue;
    const gapHours =
      (new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime()) / (60 * 60 * 1000);
    if (curr.sender_id === myId) myGaps.push(gapHours);
    else theirGaps.push(gapHours);
  }

  if (myGaps.length < MIN_SAMPLE || theirGaps.length < MIN_SAMPLE) return false;

  const myAvg = avg(myGaps);
  const theirAvg = avg(theirGaps);
  return theirAvg > 6 && myAvg < theirAvg / 3;
}

// Short, natural phrase for "tends to take ___ to reply", keyed to
// profile-build.tsx's closed RESPONSE_TIME set. Deliberately not the same
// map as thread/[id].tsx's own RESPONSE_TIME_PHRASES (which reads
// "typically replies within ___"), this one needs to read naturally after
// "tends to take".
const REPLY_DURATION_PHRASE: Record<string, string> = {
  'Within hours': 'a few hours',
  'Same day': 'a day',
  '1-2 days': 'a day or two',
  'A few days': 'a few days',
};

export function rhythmMismatchNote(otherName: string, otherResponseTime: string | null): string | null {
  const duration = otherResponseTime ? REPLY_DURATION_PHRASE[otherResponseTime] : null;
  if (!duration) return null;
  return `${otherName} tends to take ${duration} to reply, that is just their rhythm, not a signal about you.`;
}

export async function hasDismissedRhythmMismatch(connectionId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('rhythm_mismatch_dismissals')
    .select('connection_id')
    .eq('connection_id', connectionId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

export async function dismissRhythmMismatch(connectionId: string, userId: string) {
  await supabase.from('rhythm_mismatch_dismissals').insert({ connection_id: connectionId, user_id: userId });
}
