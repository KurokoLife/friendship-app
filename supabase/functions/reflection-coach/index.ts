// Supabase Edge Function: reflection-coach (RETIRED 2026-10-13)
//
// It used to do two things: "Check" (looked at a draft and recent chat
// messages) and "Another way to see it" (offered possible readings of the
// other person). Both are removed. The app never looks at a chat, and it
// never interprets the other person: when something is unclear, the person
// asks them. "Reflect first" in the chat is static tips, with no server
// call. This function now refuses every request, so no older client build
// can still use it.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return new Response(
    JSON.stringify({ error: "This is no longer available. If something is unclear, ask them what they meant.", retired: true }),
    { status: 410, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
  );
});
