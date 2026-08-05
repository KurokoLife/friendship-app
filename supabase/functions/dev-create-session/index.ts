// Supabase Edge Function: dev-create-session
//
// Deploy: supabase functions deploy dev-create-session
// (DEV_SESSION_SECRET is set as a project secret, see PROGRESS.md.)
//
// Dev-only session minting for the 8 seeded test accounts
// (seed-test-profiles.sql). Built as a last resort after extensive,
// evidence-based debugging (see PROGRESS.md's "Dev tab real fix" and
// follow-up rows) ruled out the password itself: signInWithPassword
// consistently returns invalid_credentials for these accounts even after
// (a) confirming the stored hash byte-matches the password via Postgres's
// own crypt(), and (b) resetting the password through GoTrue's own admin
// endpoint (a hash GoTrue generated itself) and immediately retrying,
// which still failed identically. The account state itself (confirmed,
// correct role/aud, linked identity, no MFA/captcha/rate-limit blocks in
// the project's Auth config) all checks out. The real root cause needs
// live GoTrue server logs this environment can't reach, so this works
// around it using Supabase's own officially supported magic-link
// mechanism (admin.generateLink + client-side verifyOtp) instead of
// password grant, rather than hand-rolling JWT signing.
//
// SECURITY, read before touching this file:
// - Hardcoded allowlist of the 8 known fake seed phone numbers only, no
//   arbitrary phone/user_id is ever accepted, this can never mint a
//   session for a real user.
// - Deployed with the platform's default JWT check, which is satisfied by
//   the public anon key alone, not a signed-in user, this function is
//   reachable by anyone who has the app's anon key (compiled into every
//   client bundle). The phone allowlist is the real boundary, not the JWT
//   check.
// - DEV_SESSION_SECRET is an additional required header, checked below.
//   This is NOT a hard security boundary either: the client has to send
//   it, so it necessarily exists in the client bundle too
//   (src/lib/dev-tools.ts). It's real protection only as long as that
//   stays true to its __DEV__ gating (stripped from production bundles by
//   Metro's dead-code elimination, same as the rest of the Dev tab). The
//   server-side function itself remains deployed and reachable regardless
//   of any client-side build flag, there is no separate dev/prod Supabase
//   project here to isolate this in. Treat this as raising the bar against
//   casual discovery, not as equivalent to real environment isolation.
// - Worst case if all of the above is bypassed: someone signs in as one
//   of 8 fake, fictional test personas and can message real users as
//   that persona. Not a real-account takeover, not a data breach.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEV_SESSION_SECRET = Deno.env.get('DEV_SESSION_SECRET');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dev-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_SEED_PHONES = new Set([
  '+15555500101',
  '+15555500102',
  '+15555500103',
  '+15555500104',
  '+15555500105',
  '+15555500106',
  '+15555500107',
  '+15555500108',
  '+15555500109',
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// Real, confirmed bug (found while investigating the reported broken-session
// issue, not theoretical): every admin.auth.admin.* call below intermittently
// fails, roughly a third of the time in live testing, with "invalid JWT:
// unable to parse or verify signature ... unrecognized JWT kid <nil> for
// algorithm ES256". Reproduced directly against listUsers and generateLink
// alike (isolated by tagging each call's error separately and hammering the
// deployed function), always this exact message, always transient, a
// same-input retry a moment later succeeds. This is GoTrue's own admin API
// intermittently failing to verify the service role key's signature, not
// anything wrong with the key, the account, or this function's own logic,
// this environment has no access to GoTrue's server logs to root-cause it
// any further than that. Since every failure so far has cleared on the very
// next attempt, retrying a bounded number of times here is the correct fix
// for a confirmed-transient upstream error, not a symptom mask.
async function withAdminRetry<T>(fn: () => Promise<{ data: T; error: { message: string } | null }>) {
  // 4 attempts still left roughly 1 in 20 calls failing in live testing
  // (per-attempt failure rate is high enough, around a third, that 4
  // consecutive failures isn't rare). Raised to 8, which at that same
  // per-attempt rate pushes the odds of exhausting every attempt below
  // 1 in 1000, while the backoff stays short enough that a full retry
  // run is still under two seconds.
  const maxAttempts = 8;
  let lastError: { message: string } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await fn();
    if (!result.error) return result;
    lastError = result.error;
    const transient = result.error.message.includes('unrecognized JWT kid');
    if (!transient || attempt === maxAttempts) return result;
    await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
  return { data: null as T, error: lastError };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!DEV_SESSION_SECRET || req.headers.get('x-dev-secret') !== DEV_SESSION_SECRET) {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  let body: { phone?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.phone || !ALLOWED_SEED_PHONES.has(body.phone)) {
    return jsonResponse({ error: 'This phone number is not a recognized seed test account' }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userList, error: lookupError } = await withAdminRetry(() => admin.auth.admin.listUsers());
  if (lookupError) {
    return jsonResponse({ error: lookupError.message }, 500);
  }
  const targetUser = userList.users.find((u) => u.phone === body.phone);
  if (!targetUser) {
    return jsonResponse({ error: 'Seed account not found' }, 404);
  }

  // magiclink requires an email identity, these accounts are phone-only,
  // so a stable, clearly-fake, per-account dev email is set once (idempotent,
  // only updated if not already set) purely to unlock the officially
  // supported generateLink mechanism. Never used for anything else.
  const devEmail = `${body.phone.replace('+', '')}@seed.dev.local`;
  if (targetUser.email !== devEmail) {
    const { error: updateError } = await withAdminRetry(() =>
      admin.auth.admin.updateUserById(targetUser.id, { email: devEmail, email_confirm: true })
    );
    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500);
    }
  }

  const { data: linkData, error: linkError } = await withAdminRetry(() =>
    admin.auth.admin.generateLink({ type: 'magiclink', email: devEmail })
  );

  if (linkError || !linkData?.properties?.hashed_token) {
    return jsonResponse({ error: linkError?.message ?? 'Could not generate session token' }, 500);
  }

  return jsonResponse({ email: devEmail, tokenHash: linkData.properties.hashed_token });
});
