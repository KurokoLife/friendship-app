import { supabase } from '@/lib/supabase';

// "Let's plan something" in a chat: the first time it's used for a
// connection, a private first-meetup feeling check shows before the ideas.
// (The older date and check-in system that also lived here was replaced by
// the Friendship Journey meetups in August 2026 and removed in October.)

export type FirstMeetupFeeling = 'excited' | 'neutral' | 'nervous';

// Records use of "Let's plan something" and returns whether it was the
// first time for this connection.
export async function recordPlanActivity(connectionId: string): Promise<boolean> {
  const { data } = await supabase.rpc('record_plan_activity', { p_connection_id: connectionId });
  return Boolean(data);
}

export async function submitFirstMeetupFeeling(connectionId: string, userId: string, feeling: FirstMeetupFeeling) {
  await supabase
    .from('first_meetup_feelings')
    .upsert({ connection_id: connectionId, user_id: userId, feeling }, { onConflict: 'connection_id,user_id' });
}
