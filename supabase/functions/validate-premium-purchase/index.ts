// Supabase Edge Function: validate-premium-purchase
//
// Deploy: supabase functions deploy validate-premium-purchase
// Reuses the same APPLE_SHARED_SECRET / GOOGLE_SERVICE_ACCOUNT_JSON
// secrets as validate-ai-credit-purchase (neither configured in this
// project as of writing, confirmed via `supabase secrets list`, same as
// that function). Without them this fails closed, same contract.
//
// Same non-negotiable rule as validate-ai-credit-purchase: a client
// reporting "I bought this" is never sufficient on its own. Every
// request re-verifies against Apple's or Google's own servers before
// ever calling credit_premium_purchase (service role only, grants via
// the existing grant_premium_days, see migration 20260810000003).
//
// Apple's receipt-verification endpoint is genuinely identical for a
// one-time consumable and an auto-renewable subscription (Apple's own
// documented behavior, already relied on correctly by
// validate-ai-credit-purchase), so that half of this function is a
// direct reuse of the same logic, not a guess. Google's side is
// different: subscriptions are verified through the Android Publisher
// API's own `purchases.subscriptions` endpoint
// (`.../purchases/subscriptions/{subscriptionId}/tokens/{token}`), not
// the `purchases.products` endpoint the consumable-credits function
// uses, checked here via `expiryTimeMillis` being in the future (a
// direct, real activity signal, not inferring from paymentState's
// several documented edge cases). This is structurally correct per
// Google's own published API shape, but genuinely NOT exercised against
// Google's real servers in this environment (no configured service
// account, no real Android purchase to test with), flagged honestly
// rather than claimed proven.
//
// Real, disclosed gap: no App Store Server Notifications / Play RTDN
// webhook receiver exists, so a renewal that happens while the user
// never reopens the app won't be recorded here. src/lib/premium.ts's
// restorePremiumPurchase re-validates on app open specifically to
// mitigate this, not to fully solve it, see that file's own comment.

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

// The one subscription this feature ships with, $5.99/month, price set
// in App Store Connect / Play Console against this product id, never
// hardcoded here.
const PRODUCT_ID = 'premium_monthly';
const GRANT_DAYS = 30;

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

// Identical to validate-ai-credit-purchase's own Google OAuth2 exchange,
// duplicated rather than shared (this codebase has no `_shared` import
// directory between functions, a deliberate existing convention, small
// helpers are kept in sync by hand).
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

  const base64url = (data: string) => btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

type GoogleSubscriptionResponse = { expiryTimeMillis?: string; paymentState?: number };

async function verifyGoogleSubscription(
  packageName: string,
  subscriptionId: string,
  purchaseToken: string
): Promise<GoogleSubscriptionResponse> {
  const accessToken = await getGoogleAccessToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return (await res.json()) as GoogleSubscriptionResponse;
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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin
    .from('premium_purchases')
    .select('status')
    .eq('transaction_id', transactionId)
    .maybeSingle();
  if (existing?.status === 'credited') {
    const { data: userRow } = await admin
      .from('users')
      .select('is_premium, premium_until')
      .eq('id', user.id)
      .maybeSingle();
    return jsonResponse({
      success: true,
      alreadyCredited: true,
      isPremium: userRow?.is_premium ?? null,
      premiumUntil: userRow?.premium_until ?? null,
    });
  }

  const { data: purchaseRow } = await admin
    .from('premium_purchases')
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
        const result = await verifyGoogleSubscription(packageName, productId, receiptData);
        const expiry = result.expiryTimeMillis ? Number(result.expiryTimeMillis) : 0;
        isValid = expiry > Date.now();
        if (!isValid) failureReason = `Google subscription expiryTimeMillis ${result.expiryTimeMillis ?? 'missing'}`;
      }
    }
  } catch (err) {
    failureReason = err instanceof Error ? err.message : 'Verification request failed';
  }

  if (!isValid) {
    await admin
      .from('premium_purchases')
      .update({ status: 'invalid', validated_at: new Date().toISOString() })
      .eq('id', purchaseRow!.id);
    return jsonResponse({ success: false, error: 'Receipt could not be verified', detail: failureReason }, 402);
  }

  await admin
    .from('premium_purchases')
    .update({ status: 'credited', validated_at: new Date().toISOString() })
    .eq('id', purchaseRow!.id);

  await admin.rpc('credit_premium_purchase', { p_user_id: user.id, p_days: GRANT_DAYS });

  const { data: updatedUser } = await admin
    .from('users')
    .select('is_premium, premium_until')
    .eq('id', user.id)
    .maybeSingle();

  return jsonResponse({
    success: true,
    isPremium: updatedUser?.is_premium ?? null,
    premiumUntil: updatedUser?.premium_until ?? null,
  });
});
