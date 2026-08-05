import { supabase } from '@/lib/supabase';

// Referral "active" tracking (2026-07-31 rebuild, see migration
// 20260808000000 for the full investigation this replaced last_sign_in_at
// with). record_active_day() is a SECURITY DEFINER RPC that inserts
// exactly one row for (caller, today's UTC date) into
// referral_signin_days, idempotently, the date itself is computed
// server-side so a client can never backdate or fast-forward its own
// distinct-day count. Safe to call as often as this function is called,
// a second call the same day is a harmless no-op (ON CONFLICT DO
// NOTHING).
export async function recordActiveDayIfSignedIn(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.rpc('record_active_day');
}
