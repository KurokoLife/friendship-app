import { supabase } from '@/lib/supabase';

// Dev-only account switcher (src/app/(tabs)/dev.tsx). Signs in as one of
// the accounts from supabase/seed/seed-test-profiles.sql, plus Elena
// Torres (supabase/seed/add-ninth-seed-profile.sql), added to give Maria
// Santos a second real compatible match without repurposing any of the
// original 8 characters' identities.
//
// Does NOT use supabase.auth.signInWithPassword(). See PROGRESS.md's "Dev
// tab real fix" and follow-up rows for the full debugging trail: phone
// password grant consistently returned invalid_credentials for these
// accounts even after confirming the stored hash byte-matches the
// password (Postgres crypt()) and even after resetting it through
// GoTrue's own admin endpoint and retrying immediately, which still
// failed identically, ruling out the password/hash as the cause. Instead
// this calls the dev-create-session Edge Function (service role,
// hardcoded to these 8 seed phone numbers only, requires
// DEV_SESSION_SECRET, see that function's own file for the full security
// writeup) to get a one-time token via Supabase's officially supported
// magic-link mechanism, then exchanges it here with verifyOtp, exactly
// the same client-side call a real magic-link flow would make.
const DEV_SESSION_SECRET = '2c1cc374d7a5291b9c7e564eb867850fcfbaef8845c87a90';

export const DEV_SEED_USERS = [
  { phone: '+15555500101', displayName: 'Maria Santos' },
  { phone: '+15555500102', displayName: 'David Chen' },
  { phone: '+15555500103', displayName: 'Aisha Bello' },
  { phone: '+15555500104', displayName: 'Robert Kim' },
  { phone: '+15555500105', displayName: 'Priya Nair' },
  { phone: '+15555500106', displayName: 'Marcus Alvarez' },
  { phone: '+15555500107', displayName: 'Jordan Blake' },
  { phone: '+15555500108', displayName: 'Sam Rivera' },
  { phone: '+15555500109', displayName: 'Elena Torres' },
];

export async function devSignInAs(phone: string): Promise<{ error: { message: string } | null }> {
  await supabase.auth.signOut();

  const { data, error: fnError } = await supabase.functions.invoke('dev-create-session', {
    body: { phone },
    headers: { 'x-dev-secret': DEV_SESSION_SECRET },
  });

  if (fnError) {
    return { error: { message: fnError.message ?? 'Could not reach dev-create-session.' } };
  }
  if (!data?.tokenHash) {
    return { error: { message: data?.error ?? 'dev-create-session did not return a session token.' } };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: data.tokenHash,
  });

  if (verifyError) {
    return { error: { message: verifyError.message } };
  }
  return { error: null };
}
