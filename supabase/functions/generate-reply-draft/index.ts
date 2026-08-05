// Supabase Edge Function: generate-reply-draft
//
// Deploy: supabase functions deploy generate-reply-draft
// (Uses the same ANTHROPIC_API_KEY secret already set for
// generate-personality-narrative and generate-match-suggestions.)
//
// F18: AI message assistance. Takes the user's own raw, honest description
// of the situation and what they want to say, plus the last few messages
// of the actual thread for context, and asks Claude to turn that into a
// warm, natural draft reply. This function does no other DB access, the
// client already has the conversation via its own RLS-scoped read and
// sends the relevant slice directly, so there's nothing else to look up,
// but it still explicitly verifies the caller is a real signed-in user
// (not just holding the public anon key) before ever calling Anthropic,
// same pattern as generate-match-suggestions. The platform's own
// verify_jwt check is NOT sufficient on its own for that, it's satisfied
// by the anon key alone, confirmed directly: a call with only the anon key
// reached this function and would have hit the paid Anthropic API before
// this check was added, an unauthenticated-cost exposure worth closing
// rather than leaving open.
//
// AI PHILOSOPHY (AGENTS.md): the app articulates what the user actually
// said, it never fabricates what they didn't say. The prompt below is
// built specifically to enforce that, everything the draft says has to
// trace back to the user's own raw input.
//
// Universal text box (2026-07-17): added a second mode, "cleanup", for
// the box's State 2 ("Clean up" / "Cancel", shown once a field already
// has user-typed content). Cleanup only improves grammar and clarity, it
// is explicitly forbidden from adding any claim, feeling, or fact the
// user didn't already write, same AI-articulates-never-fabricates anchor
// as draft mode, just applied to editing instead of generating. Draft
// mode (the original, default when `mode` is omitted, every existing
// caller keeps working unchanged) still requires the user's own
// "rawInput" first, never fabricates a follow-up from conversation
// history alone.
//
// Long-input truncation bug fix (2026-07-26): Clean Up on a 500+ word
// message was returning a single stray word instead of a cleaned version
// of the full text. Reproduced live and confirmed via the raw Anthropic
// response: max_tokens was a flat 600 for every call, and this model's
// "thinking" content block draws from that same budget before the real
// text block starts, at an unpredictable size (documented elsewhere in
// this file's history as 429 tokens for one short call, 47 for another).
// Cleanup's required output scales with the input ("keep it roughly the
// same length"), unlike draft's, so a fixed 600-token ceiling that also
// has to absorb a variable, sometimes-large thinking block is nowhere
// near enough for a long message, confirmed live: a 586-word input hit
// stop_reason "max_tokens" at exactly 600 output tokens, cut off
// mid-sentence. On an unluckier run where thinking alone eats most of the
// budget, the leftover text block can be a single truncated word, which
// is exactly the reported bug. Fixed by sizing max_tokens to the actual
// input for cleanup (with a generous thinking-token buffer on top), and
// by treating any response that stops at max_tokens as a failure rather
// than a valid result, never showing a truncated fragment as if it were
// a real, complete draft.

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

// AI usage caps/pool (2026-07-29 session): free tier gets 3/day on this
// function (draft and cleanup share one cap, not split by mode), premium
// draws from the shared monthly dollar pool instead. Checked BEFORE the
// Anthropic call (a blocked request never spends real API cost) via
// get_ai_gate_status, recorded via record_ai_usage after any real,
// completed response (response.ok, regardless of whether the output was
// usable, since Anthropic already billed for it, a truncated max_tokens
// result still cost real tokens). Real cost from Anthropic's own usage
// tokens at Claude Sonnet 5's standard rate (not the temporary intro rate,
// which expires 2026-08-31): $3.00 / 1M input, $15.00 / 1M output.
const SONNET_5_INPUT_PER_TOKEN = 3.0 / 1_000_000;
const SONNET_5_OUTPUT_PER_TOKEN = 15.0 / 1_000_000;

function sonnetCostUsd(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) * SONNET_5_INPUT_PER_TOKEN + (usage.output_tokens ?? 0) * SONNET_5_OUTPUT_PER_TOKEN;
}

// Deliberately HTTP 200, a known handled outcome not a server error,
// matching this function's own existing convention for the too-long-input
// and truncation cases. Calm, non-punitive copy, no shaming, no
// aggressive upsell.
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
    : "You've reached today's free limit for this, and you're out of extra credits too. It resets tomorrow, or you can buy 50 credits for $1.99, or upgrade to Premium for more room.";
  return new Response(
    JSON.stringify({
      blocked: true,
      reason: gate.reason ?? null,
      tier: gate.tier ?? null,
      resetsAt: gate.resets_at ?? null,
      poolSpentUsd: gate.pool_spent_usd ?? null,
      poolCapUsd: gate.pool_cap_usd ?? null,
      message,
    }),
    { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
  );
}

// Defensive ceiling on input size, well beyond anything a real typed or
// dictated message would reach (roughly 2000-2500 words). Below this,
// max_tokens scaling (below) should always leave enough room; above it,
// fail immediately and clearly rather than spend an API call finding out.
const HARD_INPUT_CHAR_LIMIT = 12000;
const TOO_LONG_MESSAGE = 'Message too long to clean up. Try sending it as is or shortening it first.';

// Claude can return multiple content blocks (for example a "thinking"
// block before the real "text" block), the actual answer is not
// guaranteed to be at index 0. Finds the first block that actually is
// text, rather than assuming position.
function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const textBlock = blocks.find((b) => b?.type === 'text');
  return (textBlock?.text ?? '').trim();
}

// Thinking tokens draw from the same max_tokens budget as the real text,
// at a size that varies per call and isn't knowable in advance, so every
// budget here carries a fixed buffer on top of what the visible output
// itself needs, not just enough for the text alone.
const THINKING_BUFFER_TOKENS = 1500;
const MAX_TOKENS_CEILING = 8000;

// Draft output is deliberately short ("usually 1 to 4 sentences") no
// matter how long the situation description is, so a fixed generous
// budget covers it, just with headroom for the same thinking-token
// variability that broke cleanup.
const DRAFT_MAX_TOKENS = 1200 + THINKING_BUFFER_TOKENS;

// Cleanup has to reproduce close to the full length of what the user
// wrote ("keep it roughly the same length"), so unlike draft, its budget
// has to scale with the input. A conservative chars-per-token estimate
// (English text averages closer to 4) so this over-, not under-, budgets.
function cleanupMaxTokens(inputCharLength: number): number {
  const estimatedOutputTokens = Math.ceil(inputCharLength / 3);
  return Math.min(MAX_TOKENS_CEILING, Math.max(600, estimatedOutputTokens + THINKING_BUFFER_TOKENS));
}

type ContextMessage = { sender: 'me' | 'them'; content: string };

// `purpose` overrides the default "drafting a reply in a message thread"
// framing for contexts that aren't a message at all (profile fields like
// About You or Dealbreakers). Universal text box (Part 4) reuses this one
// function everywhere rather than a separate function per field type,
// this is the one piece of framing that genuinely needs to vary.
function buildDraftPrompt(rawInput: string, recentMessages: ContextMessage[], purpose?: string): string {
  const conversation = recentMessages.length
    ? recentMessages
        .map((m) => `${m.sender === 'me' ? 'The user we are helping' : 'The other person'}: ${m.content}`)
        .join('\n')
    : null;

  const framing = purpose
    ? `You are helping someone ${purpose}, on a friendship app for adults building platonic friendships, not a dating app.`
    : 'You are helping someone draft a reply in a message thread on a friendship app for adults building platonic friendships, not a dating app.';

  const conversationBlock = conversation
    ? `\n\nHere is the recent conversation for context:\n\n${conversation}`
    : '';

  return `${framing}${conversationBlock}

Here is what the user told you, in their own words, about the situation and what they want to say:

"${rawInput}"

Write a draft for them, ready to use as-is, following these rules exactly:
- Only organize, clarify, and improve the flow of what the user actually said above. Never add a new feeling, question, promise, excuse, expression of affection, or any other information the user didn't provide.
- Preserve their original meaning, their natural tone, their level of interest, the specific details they chose to include, and the way they'd normally communicate. You are not speaking for them, you are helping them say what they already said more clearly.
- Write in first person, as the user's own words.
- Warm, natural, direct tone. Not formal, not clinical, not a form letter.
- Match the length to what's appropriate, usually 1 to 4 sentences.
- Never use em dashes (—). Use commas, periods, or restructure the sentence instead.
- Output only the text itself. No quotation marks, no labels, no preamble, no explanation.

Write the draft now.`;
}

function buildCleanupPrompt(text: string): string {
  return `You are cleaning up a message someone wrote themselves, before they send it, on a friendship app for adults building platonic friendships.

Here is exactly what they wrote:

"${text}"

Rewrite it following these rules exactly:
- Only fix grammar, remove filler words, reduce repetition, and improve sentence order. Never change what it means, and never add a new feeling, question, promise, excuse, expression of affection, or any other information that isn't already there.
- Keep their own voice and tone, don't make it more formal or more polished than a real text to a friend should be.
- Keep it roughly the same length as the original, however long that is. Do not summarize, shorten, or cut off any part of it.
- Never use em dashes (—). Use commas, periods, or restructure the sentence instead.
- Output only the cleaned-up text itself. No quotation marks, no labels, no preamble, no explanation.

Write the cleaned-up version now.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured on this function' }),
      { status: 500, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
    );
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const { data: gate } = await supabase.rpc('get_ai_gate_status', {
    p_user_id: user.id,
    p_function_name: 'generate-reply-draft',
  });
  if (gate && gate.allowed === false) {
    return blockedResponse(gate);
  }

  let mode: 'draft' | 'cleanup' = 'draft';
  let rawInput = '';
  let recentMessages: ContextMessage[] = [];
  let purpose: string | undefined;
  let cleanupText = '';
  try {
    const body = await req.json();
    mode = body.mode === 'cleanup' ? 'cleanup' : 'draft';
    if (mode === 'cleanup') {
      cleanupText = typeof body.text === 'string' ? body.text.trim() : '';
      if (!cleanupText) throw new Error('Missing text');
    } else {
      rawInput = typeof body.rawInput === 'string' ? body.rawInput.trim() : '';
      recentMessages = Array.isArray(body.recentMessages) ? body.recentMessages : [];
      purpose = typeof body.purpose === 'string' ? body.purpose : undefined;
      if (!rawInput) throw new Error('Missing rawInput');
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const sourceLength = mode === 'cleanup' ? cleanupText.length : rawInput.length;
  if (sourceLength > HARD_INPUT_CHAR_LIMIT) {
    // Clear, visible failure rather than spending an API call to find out
    // it was never going to fit, per the standing rule that a real limit
    // must fail loudly, not silently return something broken.
    return new Response(JSON.stringify({ error: TOO_LONG_MESSAGE }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const prompt = mode === 'cleanup' ? buildCleanupPrompt(cleanupText) : buildDraftPrompt(rawInput, recentMessages, purpose);
  const maxTokens = mode === 'cleanup' ? cleanupMaxTokens(cleanupText.length) : DRAFT_MAX_TOKENS;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return new Response(JSON.stringify({ error: 'Anthropic API request failed', detail }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const data = await response.json();

  // Recorded here, not after a successful draft is produced: a real,
  // billed Anthropic call happened the moment response.ok was true,
  // regardless of whether the result truncated or failed to parse below.
  // Not recording this would let a free user retry indefinitely at zero
  // cost to their own cap while genuinely costing (or, on premium,
  // genuinely spending against the pool) real tokens either way.
  await supabase.rpc('record_ai_usage', {
    p_user_id: user.id,
    p_function_name: 'generate-reply-draft',
    p_cost_usd: sonnetCostUsd(data?.usage),
  });

  // The real bug this session fixed: a response that stopped because it
  // ran out of max_tokens is an incomplete, truncated fragment, not a
  // valid draft, even though the API call itself succeeded (HTTP 200) and
  // extractText would happily return whatever partial text made it
  // through. Must be treated as a failure, not displayed as a result.
  if (data?.stop_reason === 'max_tokens') {
    const message =
      mode === 'cleanup'
        ? "Couldn't finish cleaning that up, the message may be too long. Try again, or send it as is."
        : "Couldn't finish drafting that right now. Try again, or write your own.";
    return new Response(JSON.stringify({ error: message }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const rawResult = extractText(data) || null;

  if (!rawResult) {
    return new Response(JSON.stringify({ error: 'No draft in response' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  // Belt and suspenders: the prompt tells Claude not to use em dashes, but
  // models don't always follow style instructions reliably, so strip any
  // that slip through rather than trust the instruction alone.
  const draft = rawResult.replace(/\s*—\s*/g, ', ');

  return new Response(JSON.stringify({ draft }), {
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
});
