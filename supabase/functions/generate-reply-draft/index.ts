// Supabase Edge Function: generate-reply-draft (RETIRED 2026-10-03)
//
// This function used to write or rewrite message text for users ("draft"
// and "cleanup" modes). That violates Limen's core rule: every message,
// profile line, and goodbye must be the user's own words. It now refuses
// every request so no older client build can still get AI-written text.
//
// Its replacement is `reflection-coach`, which only asks questions and
// returns fact-only observations, never sendable text. See
// docs/LIMEN_V2_DECISIONS.md.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return new Response(
    JSON.stringify({
      error: 'Limen no longer writes or rewrites messages. Your own words are the point. Use Reflect or Check instead.',
      retired: true,
    }),
    { status: 410, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
  );
});
