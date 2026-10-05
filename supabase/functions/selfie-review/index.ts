// Selfie review (docs/DECISIONS.md section 3, item 5, option A).
//
// Admins only (users.is_admin, which a client can never set on itself,
// see migration 20261004000000). Two actions:
//   { action: 'list' }  -> pending checks with a short-lived signed URL for
//                          the selfie and the person's public profile photo
//   { action: 'decide', userId, approve } -> approve or reject, then delete
//                          the selfie file. Only "verified: yes/no" is kept.
//
// Selfies live in the private 'selfie-checks' bucket, in a folder named
// after the person's user id. Nothing in the app can read them back except
// this function.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'selfie-checks';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
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

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: me } = await admin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
  if (!me?.is_admin) {
    return jsonResponse({ error: 'Admins only' }, 403);
  }

  let body: { action?: string; userId?: string; approve?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (body.action === 'list') {
    const { data: checks, error } = await admin
      .from('selfie_checks')
      .select('user_id, pose, storage_path, submitted_at')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
      .limit(50);
    if (error) return jsonResponse({ error: error.message }, 500);

    const ids = (checks ?? []).map((c) => c.user_id);
    const { data: profiles } = ids.length
      ? await admin.from('profiles').select('user_id, display_name, photo_url').in('user_id', ids)
      : { data: [] as { user_id: string; display_name: string | null; photo_url: string | null }[] };

    const items = await Promise.all(
      (checks ?? []).map(async (c) => {
        let selfieUrl: string | null = null;
        if (c.storage_path) {
          const { data } = await admin.storage.from(BUCKET).createSignedUrl(c.storage_path, 60 * 30);
          selfieUrl = data?.signedUrl ?? null;
        }
        const profile = profiles?.find((p) => p.user_id === c.user_id);
        return {
          userId: c.user_id,
          displayName: profile?.display_name ?? null,
          profilePhotoUrl: profile?.photo_url ?? null,
          pose: c.pose,
          selfieUrl,
          submittedAt: c.submitted_at,
        };
      })
    );
    return jsonResponse({ items });
  }

  if (body.action === 'decide') {
    if (!body.userId || typeof body.approve !== 'boolean') {
      return jsonResponse({ error: 'userId and approve are required' }, 400);
    }

    const { data: check } = await admin
      .from('selfie_checks')
      .select('storage_path, status')
      .eq('user_id', body.userId)
      .maybeSingle();
    if (!check) return jsonResponse({ error: 'No selfie check for this person' }, 404);

    const now = new Date().toISOString();
    const { error: checkError } = await admin
      .from('selfie_checks')
      .update({ status: body.approve ? 'approved' : 'rejected', reviewed_at: now, storage_path: null })
      .eq('user_id', body.userId);
    if (checkError) return jsonResponse({ error: checkError.message }, 500);

    const { error: userError } = await admin
      .from('users')
      .update({ selfie_verified_at: body.approve ? now : null })
      .eq('id', body.userId);
    if (userError) return jsonResponse({ error: userError.message }, 500);

    // Delete every file in this person's folder, not only the latest, so a
    // resubmission never leaves an older selfie behind.
    const { data: files } = await admin.storage.from(BUCKET).list(body.userId);
    const paths = (files ?? []).map((f) => `${body.userId}/${f.name}`);
    if (paths.length > 0) {
      await admin.storage.from(BUCKET).remove(paths);
    }

    return jsonResponse({ success: true, deletedFiles: paths.length });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
