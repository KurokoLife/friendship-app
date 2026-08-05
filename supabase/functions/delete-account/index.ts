// Supabase Edge Function: delete-account
//
// Deploy: supabase functions deploy delete-account
//
// Account deletion, confirmed genuinely unbuilt before this (grepped for
// any delete/admin.deleteUser reference anywhere in this repo, zero real
// matches). A user can only ever delete their OWN account: this function
// resolves the caller's identity from their own JWT (an anon-key client,
// never trusting a client-supplied user id), then uses a SEPARATE
// service-role client only for the one privileged call this needs,
// auth.admin.deleteUser, which is not reachable with just the anon key
// and has no client-side equivalent. Every row this project's own schema
// keys off auth.users.id (profiles, connections, messages, reports,
// blocks, remember_entries, and everything else added since) already
// has `on delete cascade` back to auth.users, confirmed by this
// project's own repeated prior use of that same cascade for deleted-
// account handling (F14/Saved, Report & Block), so this one admin call
// is genuinely sufficient, no manual per-table cleanup needed here.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await adminClient.auth.admin.deleteUser(user.id);
  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ success: true });
});
