// Supabase Edge Function: organize-remember-entry
//
// Deploy: supabase functions deploy organize-remember-entry
// (Uses the same ANTHROPIC_API_KEY secret already set for
// generate-reply-draft and generate-match-suggestions.)
//
// Remember, Add Entry: the user writes a raw, private note about a
// friend after spending time with them, in their own words first. This
// function only ever runs on a request the user has already typed and
// explicitly asked to organize (the "Organize with AI" choice, not
// forced, see the composer component), same AI-articulates-never-
// fabricates anchor as generate-reply-draft. It returns two things: a
// short organized summary and, only if genuinely present in what the
// user wrote, one short follow-up reminder for next time. The client
// shows both back to the user, editable, and only saves the entry once
// they explicitly approve, this function never writes to the database
// itself.
//
// Same input-scaled max_tokens / truncation-as-failure fix generate-
// reply-draft's Clean Up mode already established (2026-07-26): a
// Remember entry is short (30-90 seconds of writing or dictation), so a
// fixed generous budget is used rather than scaling per input length,
// but the same "a response that stopped at max_tokens is a failure, not
// a truncated result" rule still applies.

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

// Same defensive ceiling and reasoning as generate-reply-draft: well
// beyond anything a real 30-90 second entry would reach.
const HARD_INPUT_CHAR_LIMIT = 12000;
const TOO_LONG_MESSAGE = 'That entry is too long to organize. Try shortening it, or save it as written.';

const THINKING_BUFFER_TOKENS = 1500;
const SUMMARY_MAX_TOKENS = 900 + THINKING_BUFFER_TOKENS;

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
// function, premium draws from the shared monthly dollar pool. See
// generate-reply-draft's own header comment for the full rationale, the
// pattern is identical here: gate BEFORE the Anthropic call, record after
// any real completed response regardless of whether it parsed cleanly.
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

function buildPrompt(rawText: string, otherName: string): string {
  return `You are helping someone organize a private note about a friend named ${otherName}, on a friendship app for adults building platonic friendships. This note is private and will never be shown to ${otherName} or used for anything except this person's own memory of the friendship.

Here is exactly what they wrote, in their own words, after spending time with ${otherName}:

"${rawText}"

Do two things, following these rules exactly:
1. Write a short, clear summary of what they wrote. Only reorganize and clarify, never add a detail, feeling, plan, or fact they didn't mention. Never invent names, events, or plans that aren't in the text. Keep their own voice and level of detail. Usually 1 to 3 sentences.
2. If, and only if, they mentioned something worth following up on next time (an open topic, something ${otherName} is going through, a question they want to ask, a plan that came up), write one short sentence capturing that as a gentle reminder for their next conversation. If there is nothing like that in the text, write exactly NONE. Do not invent a follow-up that isn't there.

Never use em dashes. Output only in exactly this format, nothing else, no preamble, no explanation:

SUMMARY:
<the summary>
FOLLOW_UP:
<the follow-up sentence, or NONE>`;
}

function parseResponse(text: string): { summary: string; followUp: string | null } | null {
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)\s*FOLLOW_UP:/i);
  const followUpMatch = text.match(/FOLLOW_UP:\s*([\s\S]*)$/i);
  if (!summaryMatch || !followUpMatch) return null;
  const summary = summaryMatch[1].trim();
  const followUpRaw = followUpMatch[1].trim();
  if (!summary) return null;
  const followUp = followUpRaw && followUpRaw.toUpperCase() !== 'NONE' ? followUpRaw : null;
  return { summary, followUp };
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
    p_function_name: 'organize-remember-entry',
  });
  if (gate && gate.allowed === false) {
    return blockedResponse(gate);
  }

  let rawText = '';
  let otherName = 'this friend';
  try {
    const body = await req.json();
    rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
    if (typeof body.otherName === 'string' && body.otherName.trim()) {
      otherName = body.otherName.trim();
    }
    if (!rawText) throw new Error('Missing rawText');
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (rawText.length > HARD_INPUT_CHAR_LIMIT) {
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
      messages: [{ role: 'user', content: buildPrompt(rawText, otherName) }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return jsonResponse({ error: 'Anthropic API request failed', detail }, 502);
  }

  const data = await response.json();

  // Recorded immediately after any real, completed Anthropic response
  // (response.ok already confirmed), regardless of what happens below,
  // same reasoning as generate-reply-draft.
  await supabase.rpc('record_ai_usage', {
    p_user_id: user.id,
    p_function_name: 'organize-remember-entry',
    p_cost_usd: sonnetCostUsd(data?.usage),
  });

  if (data?.stop_reason === 'max_tokens') {
    return jsonResponse({ error: "Couldn't finish organizing that entry. Try again, or save it as written." });
  }

  const rawResult = extractText(data);
  if (!rawResult) {
    return jsonResponse({ error: 'No summary in response' }, 502);
  }

  const parsed = parseResponse(rawResult);
  if (!parsed) {
    return jsonResponse({ error: "Couldn't organize that entry right now. Try again, or save it as written." });
  }

  const summary = parsed.summary.replace(/\s*—\s*/g, ', ');
  const followUp = parsed.followUp ? parsed.followUp.replace(/\s*—\s*/g, ', ') : null;

  return jsonResponse({ summary, followUp });
});
