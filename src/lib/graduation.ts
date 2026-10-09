import { supabase } from '@/lib/supabase';

// Graduation runs through the Friendship Journey's private, mutual
// graduation_checkpoint (PrimaryInterventionCard). This file keeps the one
// piece Inbox still uses: the optional 30/90-day "still talking after
// graduating" measurement.

// Optional 30/90-day continuation measurement (see the migration's own
// comment for why this is client-driven rather than a cron job in this
// app's specific architecture). Returns null when there's nothing to
// report (not yet due, or already recorded), or the real "did a message
// get sent after graduation" signal exactly once per checkpoint,
// idempotent against concurrent calls since the DB marks it checked in
// the same statement that computes the result.
export async function checkAndMarkGraduationContinuation(
  connectionId: string,
  days: 30 | 90
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('check_and_mark_graduation_continuation', {
    p_connection_id: connectionId,
    p_days: days,
  });
  if (error) return null;
  return data as boolean | null;
}
