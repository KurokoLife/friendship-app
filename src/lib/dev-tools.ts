
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
// 2026-10-07: the shared secret is gone from the app. dev-create-session
// now checks on the server that the caller is signed in as an admin or as
// a test account (see src/lib/test-mode.ts).

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
  // Lazy import avoids a circular import (test-mode imports this file).
  const { actAsTestAccount } = await import('@/lib/test-mode');
  const { error } = await actAsTestAccount(phone);
  return { error: error ? { message: error } : null };
}
