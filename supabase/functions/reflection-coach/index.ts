// Supabase Edge Function: reflection-coach
//
// Deploy: supabase functions deploy reflection-coach
// (Uses the same ANTHROPIC_API_KEY secret as the other Anthropic-backed
// functions in this app.)
//
// 2026-10-03, Limen v2 (see docs/LIMEN_V2_DECISIONS.md). Replaces
// generate-reply-draft. That function wrote or rewrote message text
// ("Write a draft for them, ready to use as-is"), which violates the
// founder's Principle 5: every message must be the user's own words.
//
// THE HARD RULE THIS FUNCTION EXISTS TO ENFORCE:
// This function never returns text a user could send. It never drafts,
// rewrites, polishes, completes, or suggests wording. Structurally, the
// model is only allowed to return category codes plus very short topic
// labels (a few words naming something the other person mentioned). Every
// human-readable sentence the user sees is composed here, server-side,
// from fixed templates, so even a model that ignores its instructions
// cannot hand the user a ready-made message.
//
// Two modes:
//   - "check":  fact-only observations about a message the user already
//               wrote (missed point, no question, boomerasking, only
//               questions with nothing of their own, a big jump in depth).
//               Never comments on tone, warmth, or "empathy": the user's
//               own character is theirs to keep.
//   - "mirror": "Another way to see it." Three short possible readings of
//               an ambiguous moment (their circumstances, how they might
//               see you, your own fear), always ending with "you won't know
//               until you ask." Never a verdict, never sides with the user,
//               never states the other person's feelings as fact. If the
//               user describes feeling unsafe, it skips "both sides" and
//               points to Report / Block instead.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-5';
const FUNCTION_NAME = 'reflection-coach';
const HARD_INPUT_CHAR_LIMIT = 6000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

type ContextMessage = { sender: 'me' | 'them'; content: string };

// ---------------------------------------------------------------------
// check mode
// ---------------------------------------------------------------------

const CHECK_CODES = ['missed_point', 'no_question', 'boomerask', 'nothing_of_yours', 'depth_jump'] as const;
type CheckCode = (typeof CHECK_CODES)[number];

// Fixed, server-owned wording. The model never writes these sentences.
function observationText(code: CheckCode, topic: string | null): string {
  switch (code) {
    case 'missed_point':
      return topic
        ? `They mentioned "${topic}". Did you want to respond to that?`
        : 'They mentioned something you haven\'t responded to yet. Did you want to?';
    case 'no_question':
      return "There's no question in this. Is there something you're curious about?";
    case 'boomerask':
      return 'You ask a question and then answer it yourself. Would you rather leave room for their answer first?';
    case 'nothing_of_yours':
      return "This is all questions. Is there something of your own you'd like to share too?";
    case 'depth_jump':
      return "This goes deeper than either of you has shared so far. Want to share something of yours first?";
  }
}

function buildCheckPrompt(text: string, recent: ContextMessage[]): string {
  const convo = recent.length
    ? recent.map((m) => `${m.sender === 'me' ? 'USER' : 'OTHER'}: ${m.content}`).join('\n')
    : '(no earlier messages)';
  return `You review a message a person wrote themselves on a platonic friendship app. You never rewrite, suggest wording, or comment on tone or warmth. You only detect these specific, factual patterns:

- missed_point: OTHER's most recent message(s) mention something specific and personal that USER's draft does not acknowledge at all. Give "topic": 2 to 6 words naming that thing, copied or nearly copied from OTHER's words (for example "your sister's surgery"). Never more than 6 words.
- no_question: the draft contains no question at all (only flag if the conversation is ongoing and a question would be natural).
- boomerask: the draft asks OTHER a question and then answers that same question about USER in the same message.
- nothing_of_yours: the draft is only questions and shares nothing about USER.
- depth_jump: the draft asks something far more personal than anything either person has shared so far.

Earlier conversation:
${convo}

USER's draft (do not repeat or rewrite it):
"""${text}"""

Respond with JSON only, no prose: {"observations":[{"code":"<one of the codes>","topic":"<only for missed_point, else null>"}]}. Return at most 3 observations. Return {"observations":[]} if none apply. Do not invent other codes.`;
}

// ---------------------------------------------------------------------
// mirror mode
// ---------------------------------------------------------------------

const MIRROR_CLOSING = "You won't know until you ask. What would you want to ask them?";
const MIRROR_SAFETY =
  "What you're describing sounds like it may not be safe or respectful. You don't need to see their side of that. You can use Report or Block at any time, and Limen's safety team will review it.";

// Phrases that turn a reading into a verdict or a fact about the other
// person. Any reading containing one is dropped rather than shown.
const VERDICT_PATTERNS = [
  /you'?re right/i,
  /you are right/i,
  /they'?re wrong/i,
  /they are wrong/i,
  /(he|she|they) (definitely|clearly|obviously)/i,
  /(doesn'?t|does not|don'?t|do not) (like|care about|want) you/i,
  /you should (end|stop|ghost|block)/i,
];

function cleanReading(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s*—\s*/g, ', ');
  if (!t || t.length > 220) return null;
  if (VERDICT_PATTERNS.some((p) => p.test(t))) return null;
  return t;
}

function buildMirrorPrompt(situation: string): string {
  return `A person on a platonic friendship app is unsure how to read a moment with someone they are getting to know. Help them see it from more than one angle. You must not take their side, issue a verdict, or state what the other person feels or intends as fact. Use "might" or "could".

Their description:
"""${situation}"""

First decide "unsafe": true only if they describe threats, pressure, harassment, stalking, sexual or romantic pressure, or feeling physically unsafe.

Then write exactly three short readings, each one sentence, max 25 words, in second person ("you"), about the situation (never a message to send):
- "circumstances": a plausible reading based on the other person's own circumstances, unrelated to the user.
- "how_they_see_you": a plausible reading of how the other person might be experiencing the user (for example also waiting to see if the user is interested), drawing on the fact that people usually underestimate how much others like them.
- "your_fear": one gentle question about what the user may be afraid this means.

Respond with JSON only: {"unsafe":false,"circumstances":"...","how_they_see_you":"...","your_fear":"..."}`;
}

// ---------------------------------------------------------------------

async function callModel(prompt: string, maxTokens: number) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!response.ok) return { ok: false as const, detail: await response.text() };
  const data = await response.json();
  const blocks = (data?.content ?? []) as { type?: string; text?: string }[];
  const text = (blocks.find((b) => b?.type === 'text')?.text ?? '').trim();
  return { ok: true as const, text, usage: data?.usage };
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY is not configured on this function' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let mode: 'check' | 'mirror';
  let text = '';
  let recent: ContextMessage[] = [];
  try {
    const body = await req.json();
    if (body.mode !== 'check' && body.mode !== 'mirror') throw new Error('bad mode');
    mode = body.mode;
    text = typeof body.text === 'string' ? body.text.trim() : '';
    recent = Array.isArray(body.recentMessages)
      ? (body.recentMessages as ContextMessage[])
          .filter((m) => m && (m.sender === 'me' || m.sender === 'them') && typeof m.content === 'string')
          .slice(-6)
      : [];
    if (!text) throw new Error('Missing text');
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (text.length > HARD_INPUT_CHAR_LIMIT) {
    return json({ error: 'That is too long to look at in one go. Try a shorter piece.' });
  }

  // One flat daily cap for everyone (cost control only, never sold).
  const { data: gate } = await supabase.rpc('get_ai_gate_status', {
    p_user_id: user.id,
    p_function_name: FUNCTION_NAME,
  });
  if (gate && gate.allowed === false) {
    return json({
      blocked: true,
      message: "You've used today's reflection checks. Your own words are always enough, and this resets tomorrow.",
    });
  }

  const result = await callModel(mode === 'check' ? buildCheckPrompt(text, recent) : buildMirrorPrompt(text), 600);
  if (!result.ok) return json({ error: 'AI request failed', detail: result.detail }, 502);

  await supabase.rpc('record_ai_usage', { p_user_id: user.id, p_function_name: FUNCTION_NAME, p_cost_usd: null });

  const parsed = parseJson(result.text);
  if (!parsed) return json({ error: "Couldn't do that right now. Try again in a moment." });

  if (mode === 'check') {
    const raw = Array.isArray(parsed.observations) ? parsed.observations : [];
    const seen = new Set<string>();
    const observations: { code: CheckCode; text: string }[] = [];
    for (const o of raw as { code?: string; topic?: unknown }[]) {
      if (!o || !CHECK_CODES.includes(o.code as CheckCode) || seen.has(o.code as string)) continue;
      seen.add(o.code as string);
      let topic: string | null = null;
      if (o.code === 'missed_point' && typeof o.topic === 'string') {
        const words = o.topic.trim().replace(/["\n]/g, '').split(/\s+/).filter(Boolean);
        topic = words.length > 0 && words.length <= 6 ? words.join(' ') : null;
      }
      observations.push({ code: o.code as CheckCode, text: observationText(o.code as CheckCode, topic) });
      if (observations.length >= 3) break;
    }
    return json({ observations });
  }

  if (parsed.unsafe === true) {
    return json({ unsafe: true, safetyMessage: MIRROR_SAFETY });
  }
  const readings = [
    { key: 'circumstances', label: 'Their circumstances', text: cleanReading(parsed.circumstances) },
    { key: 'how_they_see_you', label: 'How they might see you', text: cleanReading(parsed.how_they_see_you) },
    { key: 'your_fear', label: 'Your own worry', text: cleanReading(parsed.your_fear) },
  ].filter((r) => r.text);
  if (readings.length === 0) return json({ error: "Couldn't do that right now. Try again in a moment." });
  return json({ unsafe: false, readings, closing: MIRROR_CLOSING });
});
