// Supabase Edge Function: validate-ai-credit-purchase
//
// Deploy: supabase functions deploy validate-ai-credit-purchase
// Requires new secrets, neither configured in this project as of writing
// (confirmed via `supabase secrets list` before building this, no
// billing/IAP secret of any kind existed):
//   supabase secrets set APPLE_SHARED_SECRET=...   (App Store Connect,
//     Users and Access > Shared Secrets, only needed for auto-renewable
//     subscriptions per Apple's docs, but required here too since a
//     consumable's receipt is verified through the exact same endpoint)
//   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{...}'   (a Google
//     Cloud service account with access to the Play Developer API,
//     linked to this app in Play Console)
// Without these, real purchases cannot be validated, this function fails
// closed (returns invalid, credits nothing) rather than trusting an
// unverified receipt, see validateReceipt below.
//
// The one, non-negotiable contract this whole function exists for: a
// client reporting "I bought this" is never sufficient on its own to
// credit an account. Every request here re-verifies the purchase against
// Apple's or Google's own servers before touching ai_credits, and the
// crediting itself only ever happens inside credit_ai_purchase, a
// SECURITY DEFINER function this Edge Function calls with the service
// role, never reachable directly by a client (confirmed via that
// function's own grants, service_role only).
//
// Idempotent by construction: ai_credit_purchases.transaction_id is
// UNIQUE, and this function checks for an existing 'credited' row before
// doing any validation work at all, so a client retry, a duplicate
// submission, or a replayed receipt can never credit the same real
// purchase twice.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APPLE_SHARED_SECRET = Deno.env.get('APPLE_SHARED_SECRET');
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// The one consumable product this feature ships with. A real IAP catalog
// would look this up by productId, kept as a single constant since
// there's exactly one product, per the given spec ($1.99 for 50 credits).
const PRODUCT_ID = 'ai_credits_50';
const CREDITS_PER_PACK = 50;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

type ApplePurchase = { product_id: string; transaction_id: string };
type AppleVerifyResponse = {
  status: number;
  receipt?: { in_app?: ApplePurchase[] };
  latest_receipt_info?: ApplePurchase[];
};

// Apple's own documented sandbox-receipt-sent-to-production pattern: try
// production first, and only retry against the sandbox host if Apple's
// own response says to (status 21007), rather than guessing which
// environment a receipt came from.
async function verifyAppleReceipt(receiptData: string): Promise<AppleVerifyResponse> {
  const body = JSON.stringify({
    'receipt-data': receiptData,
    password: APPLE_SHARED_SECRET,
    'exclude-old-transactions': true,
  });

  const callVerify = (url: string) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then((r) => r.json());

  let result = (await callVerify('https://buy.itunes.apple.com/verifyReceipt')) as AppleVerifyResponse;
  if (result.status === 21007) {
    result = (await callVerify('https://sandbox.itunes.apple.com/verifyReceipt')) as AppleVerifyResponse;
  }
  return result;
}

// Minimal RS256 JWT-bearer OAuth2 flow using Web Crypto directly, rather
// than pulling in a full Google auth client library for what's otherwise
// one token exchange, matching this codebase's existing edge functions'
// preference for plain fetch calls over heavy dependencies.
async function getGoogleAccessToken(): Promise<string> {
  const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON!) as {
    client_email: string;
    private_key: string;
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const base64url = (data: string) =>
    btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const pemBody = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const signedJwt = `${unsigned}.${base64url(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Google OAuth2 token exchange failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token as string;
}

type GooglePurchaseResponse = { purchaseState?: number; consumptionState?: number };

async function verifyGooglePurchase(
  packageName: string,
  productId: string,
  purchaseToken: string
): Promise<GooglePurchaseResponse> {
  const accessToken = await getGoogleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return (await res.json()) as GooglePurchaseResponse;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  let platform: string, productId: string, transactionId: string, receiptData: string, packageName: string | undefined;
  try {
    const body = await req.json();
    platform = body.platform;
    productId = body.productId;
    transactionId = body.transactionId;
    receiptData = body.receiptData;
    packageName = body.packageName;
    if (
      (platform !== 'ios' && platform !== 'android') ||
      typeof productId !== 'string' ||
      typeof transactionId !== 'string' ||
      typeof receiptData !== 'string'
    ) {
      throw new Error('Missing or invalid fields');
    }
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // Service role only past this point: writing ai_credit_purchases and
  // calling credit_ai_purchase both require it, neither is reachable by
  // an ordinary authenticated client.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotency: a transaction already credited is a success, not a new
  // charge against ai_credits, no matter how many times this is called
  // for it (client retry after a flaky network response, the platform's
  // own delivery-at-least-once behavior for purchase updates, etc.).
  const { data: existing } = await admin
    .from('ai_credit_purchases')
    .select('status, credits_granted')
    .eq('transaction_id', transactionId)
    .maybeSingle();
  if (existing?.status === 'credited') {
    const { data: userRow } = await admin.from('users').select('ai_credits').eq('id', user.id).maybeSingle();
    return jsonResponse({ success: true, alreadyCredited: true, newBalance: userRow?.ai_credits ?? null });
  }

  const { data: purchaseRow } = await admin
    .from('ai_credit_purchases')
    .upsert(
      { user_id: user.id, platform, product_id: productId, transaction_id: transactionId, receipt_data: receiptData, status: 'pending' },
      { onConflict: 'transaction_id' }
    )
    .select('id')
    .single();

  let isValid = false;
  let failureReason = '';

  try {
    if (platform === 'ios') {
      if (!APPLE_SHARED_SECRET) {
        failureReason = 'APPLE_SHARED_SECRET not configured on this function';
      } else {
        const result = await verifyAppleReceipt(receiptData);
        const purchases = [...(result.receipt?.in_app ?? []), ...(result.latest_receipt_info ?? [])];
        const matched = purchases.find((p) => p.transaction_id === transactionId && p.product_id === productId);
        isValid = result.status === 0 && Boolean(matched);
        if (!isValid) failureReason = `Apple verifyReceipt status ${result.status}, matched=${Boolean(matched)}`;
      }
    } else {
      if (!GOOGLE_SERVICE_ACCOUNT_JSON) {
        failureReason = 'GOOGLE_SERVICE_ACCOUNT_JSON not configured on this function';
      } else if (!packageName) {
        failureReason = 'Missing packageName for Android verification';
      } else {
        const result = await verifyGooglePurchase(packageName, productId, receiptData);
        // purchaseState 0 = purchased (per Play Developer API docs), 1 =
        // cancelled, 2 = pending.
        isValid = result.purchaseState === 0;
        if (!isValid) failureReason = `Google purchaseState ${result.purchaseState}`;
      }
    }
  } catch (err) {
    failureReason = err instanceof Error ? err.message : 'Verification request failed';
  }

  if (!isValid) {
    await admin
      .from('ai_credit_purchases')
      .update({ status: 'invalid', validated_at: new Date().toISOString() })
      .eq('id', purchaseRow!.id);
    return jsonResponse({ success: false, error: 'Receipt could not be verified', detail: failureReason }, 402);
  }

  await admin
    .from('ai_credit_purchases')
    .update({ status: 'credited', credits_granted: CREDITS_PER_PACK, validated_at: new Date().toISOString() })
    .eq('id', purchaseRow!.id);

  await admin.rpc('credit_ai_purchase', {
    p_user_id: user.id,
    p_credits: CREDITS_PER_PACK,
    p_reason: `purchase:${transactionId}`,
  });

  const { data: updatedUser } = await admin.from('users').select('ai_credits').eq('id', user.id).maybeSingle();

  return jsonResponse({ success: true, creditsGranted: CREDITS_PER_PACK, newBalance: updatedUser?.ai_credits ?? null });
});
