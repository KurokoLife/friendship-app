// Supabase Edge Function: summarize-remember-timeline
//
// Deploy: supabase functions deploy summarize-remember-timeline
// (Uses the same ANTHROPIC_API_KEY secret already set for
// generate-reply-draft, generate-match-suggestions, and
// organize-remember-entry.)
//
// Remember's Timeline, "Summarize for me": an explicit, user-tapped
// button, never ambient or auto-triggered, same as "Organize with AI" on
// a single entry. Reads every remember_entries row for this connection
// for the caller (RLS-scoped via the caller's own JWT, exactly the
// access-control pattern organize-remember-entry and every other
// user-scoped function in this app already uses, no separate
// participant check needed since remember_entries' own SELECT policy is
// already `auth.uid() = user_id`), and summarizes ONLY raw_text, never
// organized_text. This is deliberate, not an oversight: organized_text is
// already Claude's own prior paraphrase of an entry, feeding a
// paraphrase back into a second summarization pass would compound
// drift away from the user's actual words across regenerations, which
// this app's own anchor ("Claude articulates what the user wrote, never
// what an AI previously wrote about what the user wrote") doesn't allow.
//
// The content rules below are enforced via the Anthropic `system`
// parameter, a genuine addition to this app's existing edge-function
// pattern (every other function here inlines instructions into the user
// message instead), specifically because this feature's rules are
// unusually strict and non-negotiable (no added facts, no inferred tone,
// no softened or removed stated emotion, no speculation, no padding),
// and keeping them in `system` keeps them structurally separate from the
// user's actual entry content in the request.
//
// Regenerated fresh on every tap, nothing is cached or written back to
// the database. Simpler than caching (no invalidation to get right when
// an entry is added, edited via a later approve-and-save, or deleted),
// and this isn't a performance-critical path, a Timeline realistically
// has a handful of entries, not hundreds.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Same defensive ceiling and reasoning as organize-remember-entry and
// generate-reply-draft, applied to the combined length of every entry
// rather than a single one, since this function reads all of them.
const HARD_INPUT_CHAR_LIMIT = 12000;
const TOO_LONG_MESSAGE =
  "There's too much written here to summarize in one go. Try deleting older entries you no longer need, or read the Timeline directly.";
const NOTHING_TO_SUMMARIZE_MESSAGE = 'Nothing written yet for this person.';

// Same thinking-token-budget lesson as every other AI-assist function in
// this app (2026-07-25/26 truncation fixes): a fixed generous budget,
// not scaled to input length like Clean Up's cleanup mode, because the
// output here is meant to stay short regardless of how many entries
// exist (the sparse-input rule below is the same idea in the other
// direction: a short summary is a correct summary, not a truncated one).
const THINKING_BUFFER_TOKENS = 1500;
const SUMMARY_MAX_TOKENS = 1200 + THINKING_BUFFER_TOKENS;

const SYSTEM_PROMPT = `You summarize a person's own private notes about a friend, on a friendship app for adults building platonic friendships. These notes are private, written by the user themself, and this summary will only ever be shown back to the user, never to the friend or anyone else.

Follow these rules exactly, without exception:
1. Summarize ONLY what is explicitly written in the notes. Never add a fact, detail, or piece of context the user did not write.
2. Never infer or add an emotional tone, sentiment, or feeling that is not explicitly stated in the text.
3. If the notes explicitly state an emotion or feeling, preserve it faithfully. Never remove, soften, or hedge emotional content that is genuinely there.
4. Never speculate about the friendship, the friend as a person, or future plans beyond what is explicitly written.
5. If the notes are sparse or say very little, the summary must be correspondingly short. Do not pad, embellish, or add filler to make it sound more complete than it is.

Never use em dashes. Output only the summary itself, 1 to 4 sentences depending on how much is actually there, nothing else, no preamble, no heading, no explanation of what you did.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const textBlock = blocks.find((b) => b?.type === 'text');
  return (textBlock?.text ?? '').trim();
}

// AI usage caps/pool (2026-07-29 session): free tier gets 2/week on this
// function, premium draws from the shared monthly dollar pool. Same
// pattern as generate-reply-draft/organize-remember-entry: gate BEFORE the
// Anthropic call, record after any real completed response.
const SONNET_5_INPUT_PER_TOKEN = 3.0 / 1_000_000;
const SONNET_5_OUTPUT_PER_TOKEN = 15.0 / 1_000_000;

function sonnetCostUsd(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) * SONNET_5_INPUT_PER_TOKEN + (usage.output_tokens ?? 0) * SONNET_5_OUTPUT_PER_TOKEN;
}

function blockedResponse(gate: {
  reason?: string;
  tier?: string;
  resets_at?: string;
  pool_spent_usd?: number;
  pool_cap_usd?: number;
}) {
  const isPremium = gate.tier === 'premium';
  const message = isPremium
    ? "You've used this month's shared AI credit for this, and you're out of extra credits too. It refreshes next cycle, or you can buy 50 more credits for $1.99."
    : "You've reached this week's free limit for this, and you're out of extra credits too. It resets soon, or you can buy 50 credits for $1.99, or upgrade to Premium for more room.";
  return jsonResponse({
    blocked: true,
    reason: gate.reason ?? null,
    tier: gate.tier ?? null,
    resetsAt: gate.resets_at ?? null,
    poolSpentUsd: gate.pool_spent_usd ?? null,
    poolCapUsd: gate.pool_cap_usd ?? null,
    message,
  });
}

// Chronological, oldest first, same ordering the Timeline itself renders
// in (meetup number, then created_at as a tiebreaker), so the summary
// reads in the same order the user experiences their own history.
function buildUserMessage(entries: { raw_text: string; meetup_number_at_entry: number }[]): string {
  const blocks = entries.map((e, i) => {
    const label = e.meetup_number_at_entry > 0 ? `After meetup ${e.meetup_number_at_entry}` : 'Before the first meetup';
    return `Note ${i + 1} (${label}):\n"${e.raw_text}"`;
  });
  return `Here are this person's own private notes, in their own words, in the order they wrote them:\n\n${blocks.join('\n\n')}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY is not configured on this function' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const { data: gate } = await supabase.rpc('get_ai_gate_status', {
    p_user_id: user.id,
    p_function_name: 'summarize-remember-timeline',
  });
  if (gate && gate.allowed === false) {
    return blockedResponse(gate);
  }

  let connectionId = '';
  try {
    const body = await req.json();
    connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : '';
    if (!connectionId) throw new Error('Missing connectionId');
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // RLS ("auth.uid() = user_id") is the real access control here, same
  // as every other read this codebase does through the caller's own
  // JWT, this query can never return another user's entries regardless
  // of what connectionId is passed. Only raw_text, deliberately never
  // organized_text, see the header comment.
  const { data: entries, error: fetchError } = await supabase
    .from('remember_entries')
    .select('raw_text, meetup_number_at_entry')
    .eq('connection_id', connectionId)
    .order('meetup_number_at_entry', { ascending: true })
    .order('created_at', { ascending: true });

  if (fetchError) {
    return jsonResponse({ error: 'Could not load entries' }, 500);
  }
  if (!entries || entries.length === 0) {
    return jsonResponse({ error: NOTHING_TO_SUMMARIZE_MESSAGE });
  }

  const userMessage = buildUserMessage(entries);
  if (userMessage.length > HARD_INPUT_CHAR_LIMIT) {
    return jsonResponse({ error: TOO_LONG_MESSAGE });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: SUMMARY_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return jsonResponse({ error: 'Anthropic API request failed', detail }, 502);
  }

  const data = await response.json();

  // Recorded immediately after any real, completed Anthropic response
  // (response.ok already confirmed), same reasoning as the other
  // AI-assist functions this session touched.
  await supabase.rpc('record_ai_usage', {
    p_user_id: user.id,
    p_function_name: 'summarize-remember-timeline',
    p_cost_usd: sonnetCostUsd(data?.usage),
  });

  // Same "a truncated response is a failure, not a result" rule as
  // every other AI-assist function in this app since the 2026-07-25/26
  // Clean Up truncation fix.
  if (data?.stop_reason === 'max_tokens') {
    return jsonResponse({ error: "Couldn't finish summarizing right now. Try again." });
  }

  const summary = extractText(data);
  if (!summary) {
    return jsonResponse({ error: 'No summary in response' }, 502);
  }

  return jsonResponse({ summary: summary.replace(/\s*—\s*/g, ', ') });
});
