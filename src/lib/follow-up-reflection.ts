import { supabase } from '@/lib/supabase';

export type FollowUpReflection = {
  id: string;
  connection_id: string;
  user_id: string;
  fired_at: string;
  dismissed_at: string | null;
  remind_at: string | null;
};

// F19: fetches every active (not dismissed, not snoozed past its
// remind_at) follow-up reflection prompt for the current user, across all
// their connections. Same shape as no-ghost's fetchActivePrompts.
export async function fetchActiveReflections(): Promise<FollowUpReflection[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('follow_up_reflections')
    .select('*')
    .is('dismissed_at', null)
    .or(`remind_at.is.null,remind_at.lte.${nowIso}`);
  return (data ?? []) as FollowUpReflection[];
}

export function reflectionByConnection(reflections: FollowUpReflection[]): Map<string, FollowUpReflection> {
  const byConnection = new Map<string, FollowUpReflection>();
  for (const r of reflections) byConnection.set(r.connection_id, r);
  return byConnection;
}

export function reflectionPrompt(otherName: string): string {
  return `Is there something from your recent conversation with ${otherName} you want to follow up on or celebrate with them?`;
}

// "I'll reach out my own way": the user has already decided what to do,
// this occurrence is fully resolved, not snoozed.
export async function dismissReflection(id: string) {
  await supabase.from('follow_up_reflections').update({ dismissed_at: new Date().toISOString() }).eq('id', id);
}

// "Dismiss": per the given spec, not repeated for 7 days. dismissed_at
// stays null (this is a snooze, not a resolution), matching no-ghost's
// own giveItMoreTime mechanic exactly.
export async function snoozeReflection(id: string) {
  await supabase
    .from('follow_up_reflections')
    .update({ remind_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    .eq('id', id);
}
