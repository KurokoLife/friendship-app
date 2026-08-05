// Supabase Edge Function: generate-personality-narrative
//
// Deploy (requires the Supabase CLI, logged in and linked to this project):
//   supabase functions deploy generate-personality-narrative
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Three-section update (2026-07-26): the reflection page ("A little about
// how you connect") combines three input groups, none of which replaces
// the others:
//   1. Existing profile selections (fetched here, server-side, from the
//      caller's own `profiles` row via their own JWT, RLS-scoped, the
//      client sends nothing new for this).
//   2. The 10 existing reflection/personality answers (F6), sent by the
//      client exactly as before.
//   3. The five new private "Your experience with new friendship"
//      answers, sent by the client for fresh onboarding only, omitted
//      entirely for Profile-tab retakes.
//
// Three sections are returned: "How you tend to connect" (from groups 1
// and 2 only), "What has helped before" (from the single growthFactors
// answer only), "When things feel uncertain" (from the other four
// friendship-experience fields only). Each is validated server-side
// against both a real-id check AND a source-category check (a section
// can only be grounded in the specific input group it's supposed to draw
// from), so a stray reference can't leak evidence from the wrong group
// into a section, before ever falling back to neutral copy. The evidence
// mapping itself is never shown to the user, and the client's response
// shape (`{connectionStyle, whatHelped, whenUncertain}`, plain strings)
// is the only thing that leaves this function.
//
// No trait names, scores, personality types, attachment labels, fixed
// "you are X" typing, or the word AI are ever generated or returned.
// Requires a valid Supabase JWT (verify_jwt defaults to true for Edge
// Functions), so this can't be hit anonymously to run up the Anthropic
// bill.
//
// The Anthropic API key lives only as a server-side secret here. It is
// never sent to, or bundled into, the client app.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-5';

// Browser calls (the app's web preview, and eventually any web build) send a
// CORS preflight OPTIONS request before the real POST. Without these
// headers the preflight comes back 405 with no Access-Control-Allow-Origin,
// so the browser blocks the actual request before it ever reaches this
// function, curl and native app calls skip preflight entirely so this was
// invisible to direct testing.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Claude can return multiple content blocks (for example a "thinking"
// block before the real "text" block), the actual answer is not
// guaranteed to be at index 0. Finds the first block that actually is
// text, rather than assuming position. Real bug found and fixed while
// verifying the F13/F14 Edge Function rebuilds: this function's old
// content[0].text?.trim() silently returned undefined whenever a thinking
// block came first, confirmed live via a temporary diagnostic on
// generate-connection-analysis (identical code shape) that dumped the
// real Anthropic payload and found content[0] was a thinking block,
// content[1] the real text.
function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const textBlock = blocks.find((b) => b?.type === 'text');
  return (textBlock?.text ?? '').trim();
}

// AI usage caps/pool (2026-07-29 session): the ONE onboarding call is
// unlimited (never gated, never recorded against any cap), the Profile-tab
// retake path is capped at 1/day for BOTH free and premium accounts,
// deliberately separate from the premium pool (no real reason to make
// unlimited regeneration free just because someone is premium). The
// client tells this function which case it is via body.context
// ('onboarding' | 'retake'); a missing or unrecognized value defaults to
// 'retake', the safe, fail-closed choice, matching this app's own
// established pattern (validate-ai-credit-purchase fails closed with no
// configured secret rather than assuming success).
const SONNET_5_INPUT_PER_TOKEN = 3.0 / 1_000_000;
const SONNET_5_OUTPUT_PER_TOKEN = 15.0 / 1_000_000;

function sonnetCostUsd(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) * SONNET_5_INPUT_PER_TOKEN + (usage.output_tokens ?? 0) * SONNET_5_OUTPUT_PER_TOKEN;
}

function blockedResponse(gate: { reason?: string; tier?: string; resets_at?: string }) {
  return new Response(
    JSON.stringify({
      blocked: true,
      reason: gate.reason ?? null,
      tier: gate.tier ?? null,
      resetsAt: gate.resets_at ?? null,
      message: "You've already viewed your reflection today, and you're out of extra credits too. It'll be ready again tomorrow, or you can buy 50 credits for $1.99.",
    }),
    { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
  );
}

type AnswerPair = { question: string; answer: string };

type FriendshipExperience = {
  growthFactors?: string[];
  lostMomentumReasons?: string[];
  awkwardnessInterpretation?: string | null;
  afterPositiveMeetupBehavior?: string | null;
  hardestCurrentStep?: string | null;
};

// Mirrors src/app/big-five-assessment.tsx's EXPERIENCE_QUESTIONS prompts
// and option lists exactly, so a selected option can be resolved back to a
// stable id (questionKey_optionIndex, based on the option's fixed position
// in its own closed list). Duplicated here rather than shared, this Deno
// function has no access to the app's own TS module tree.
const EXPERIENCE_PROMPTS: Record<keyof FriendshipExperience, string> = {
  growthFactors: 'Think about a friendship that grew well. What helped it grow?',
  lostMomentumReasons: 'When a promising new connection faded, what usually happened?',
  awkwardnessInterpretation:
    'When a first conversation or meetup feels awkward, what are you most likely to think?',
  afterPositiveMeetupBehavior: 'After a good first meetup, what are you most likely to do?',
  hardestCurrentStep: 'Which part of building a new friendship feels hardest right now?',
};

const EXPERIENCE_OPTIONS: Record<keyof FriendshipExperience, string[]> = {
  growthFactors: [
    'We saw each other regularly',
    'We had something we enjoyed doing together',
    'One of us reached out and the other responded',
    'We could be honest, even when something felt awkward',
    'We followed through on plans',
    'It grew slowly over time',
    "I'm not sure",
  ],
  lostMomentumReasons: [
    'The conversation became one-sided',
    'We talked but never made plans',
    'We met once and neither of us followed up',
    'Scheduling or distance got in the way',
    'Someone canceled and it never restarted',
    'One of us stopped responding',
    "I'm not sure",
    "I haven't had this experience",
  ],
  awkwardnessInterpretation: [
    'We probably do not click',
    'I probably said something wrong',
    'They probably were not interested',
    'We may both just need more time',
    'Awkwardness is normal when people are new to each other',
    'It depends',
  ],
  afterPositiveMeetupBehavior: [
    'Reach out soon',
    'Want to reach out, but wait',
    'Wait to see whether they contact me',
    'Worry that reaching out too soon may feel like too much',
    'It depends',
  ],
  hardestCurrentStep: [
    'Starting the conversation',
    'Suggesting a meetup',
    'Getting through the first meetup',
    'Following up afterward',
    'Suggesting another activity',
    'Knowing whether the interest is mutual',
    'Making time consistently',
    "I'm not sure",
  ],
};

// The subset of `profiles` used for the reflection: closed-option fields
// that describe how someone approaches connection, communication, and
// reliability, not open free-text fields (personal_statement,
// dealbreakers), which aren't a good fit for id-tagged evidence atoms.
type ProfileSelections = {
  life_transitions: string[] | null;
  values: string[] | null;
  communication_freq: string | null;
  meeting_freq: string | null;
  response_time: string | null;
  hangout_people_preference: string | null;
  hangout_type_preference: string[] | null;
  friendship_type: string | null;
  communication_style_openness: string | null;
};

// One tagged, citable unit of evidence. Everything Claude is allowed to
// draw from is enumerated here first, with a stable id, so its own
// supportedBy claims can be checked against a known-real list rather than
// trusted at face value. `category` gates which section is allowed to
// cite it: a real, valid id from the wrong input group still fails
// validation for a section it doesn't belong to.
type Category = 'connection' | 'helped' | 'uncertain';
type AnswerAtom = { id: string; text: string; category: Category };

function profileAtoms(p: ProfileSelections | null): AnswerAtom[] {
  if (!p) return [];
  const atoms: AnswerAtom[] = [];
  const addArray = (field: string, label: string, values: string[] | null) => {
    (values ?? []).forEach((v, i) => {
      atoms.push({ id: `profile_${field}_${i}`, text: `Q: ${label}\nA: ${v}`, category: 'connection' });
    });
  };
  const addSingle = (field: string, label: string, value: string | null) => {
    if (value) atoms.push({ id: `profile_${field}`, text: `Q: ${label}\nA: ${value}`, category: 'connection' });
  };
  addArray('life_transitions', 'What brought them to this app', p.life_transitions);
  addArray('values', 'A value they selected as important to them', p.values);
  addSingle('communication_freq', 'How often they like to check in with a new friend', p.communication_freq);
  addSingle('meeting_freq', 'How often they like to meet up with a new friend', p.meeting_freq);
  addSingle('response_time', 'How quickly they typically reply to messages', p.response_time);
  addSingle(
    'hangout_people_preference',
    'How they prefer to hang out with a new friend',
    p.hangout_people_preference
  );
  addArray('hangout_type_preference', 'A way they like to hang out with a new friend', p.hangout_type_preference);
  addSingle('friendship_type', 'What kind of friendship they are hoping to build', p.friendship_type);
  addSingle(
    'communication_style_openness',
    'When they tend to open up and share personal things with a new friend',
    p.communication_style_openness
  );
  return atoms;
}

// The 10 reflection answers arrive as a plain, already-ordered
// {question, answer}[] (QUESTIONS.map in big-five-assessment.tsx always
// sends all 10, in the same fixed order, only once every question is
// answered), so position in that array is a reliable, stable id source
// without needing the client to send explicit ids of its own.
function bigFiveAtoms(answers: AnswerPair[]): AnswerAtom[] {
  return answers.map((a, i) => ({
    id: `bigfive_${i + 1}`,
    text: `Q: ${a.question}\nA: ${a.answer}`,
    category: 'connection' as const,
  }));
}

// growthFactors is its own category (only "What has helped before" may
// cite it); the other four friendship-experience fields share the
// "uncertain" category (only "When things feel uncertain" may cite them).
function experienceAtoms(fe: FriendshipExperience): AnswerAtom[] {
  const atoms: AnswerAtom[] = [];
  const addSelected = (key: keyof FriendshipExperience, selected: string, category: Category) => {
    const optionIndex = EXPERIENCE_OPTIONS[key].indexOf(selected);
    // A value that doesn't match any known option for its own question is
    // not real evidence, skip it rather than fabricate an id for it. This
    // shouldn't happen from the app's own UI (a closed option list), only
    // guards against a malformed or hand-crafted request body.
    if (optionIndex === -1) return;
    atoms.push({ id: `${key}_${optionIndex}`, text: `Q: ${EXPERIENCE_PROMPTS[key]}\nA: ${selected}`, category });
  };
  for (const selected of fe.growthFactors ?? []) addSelected('growthFactors', selected, 'helped');
  for (const selected of fe.lostMomentumReasons ?? []) addSelected('lostMomentumReasons', selected, 'uncertain');
  if (fe.awkwardnessInterpretation) addSelected('awkwardnessInterpretation', fe.awkwardnessInterpretation, 'uncertain');
  if (fe.afterPositiveMeetupBehavior)
    addSelected('afterPositiveMeetupBehavior', fe.afterPositiveMeetupBehavior, 'uncertain');
  if (fe.hardestCurrentStep) addSelected('hardestCurrentStep', fe.hardestCurrentStep, 'uncertain');
  return atoms;
}

const SYSTEM_INSTRUCTION = `You are creating a brief reflection for a friendship app based on three sources: the user's profile selections, ten existing reflection answers, and (when present) five friendship-experience answers.

The friendship-experience answers supplement the existing personality and profile reflection. They must not replace it.

Each answer below has an id and belongs to one of three groups: connection (profile selections and the ten reflection answers), helped (the single "what helped a friendship grow" answer), or uncertain (the other friendship-experience answers). Every displayed sentence you write must be directly supported by one or more ids from the matching group for that section, and you must return which ids support each section.

Do not infer traits, motivations, emotional needs, life circumstances, relationship history, or behavioral causes that the user did not explicitly provide. Do not connect two answers into a causal explanation unless that relationship is already explicit in the answers themselves. Do not present a prediction about how the user will behave. Do not describe the user as a fixed type.

You may only:
1. Restate or lightly paraphrase information directly contained in the answers.
2. Identify a simple pattern when at least two answers clearly support the same pattern.
3. Use tentative language when summarizing a pattern.
4. Acknowledge uncertainty when the answers do not support a clear conclusion.

Write three sections:

1. "How you tend to connect"
Use only the profile selections and the ten existing reflection answers (the "connection" group) to describe two or three supported qualities about how the user may approach connection, communication, reliability, or familiarity. This should not become a generic flattering personality description, only include a quality when it is clearly supported.

2. "What has helped before"
Use only the "helped" group, the user's answer to what helped a friendship grow. Lightly paraphrase it. Do not add causes, outcomes, or personality conclusions.

3. "When things feel uncertain"
Use only the "uncertain" group. Reflect one or two explicitly selected interpretations, hesitations, or difficult steps. Do not state that the user caused a friendship to fail, and do not state a negative consequence unless the user explicitly reported it.

Use tentative, respectful language. This is a reflection, not a diagnosis. Prefer phrases such as "You shared that...", "You indicated that...", "You may...", "You seem to value...", "Your answers suggest that...".

Do not use phrases such as "You are an introvert", "You are avoidant", "You are emotionally guarded", "You have an attachment style", "You always", "You never", "It sounds like you are...", "You tend to be...", "Deep down...", "This suggests that your personality...", "This causes promising connections to fade", "This is why your friendships fail", "You sabotage connections", "You need to fix this", "You are afraid of rejection".

Do not diagnose, judge, prescribe, praise excessively, or explain the user to themselves. Do not introduce details that did not appear in their answers. Do not identify weaknesses. Do not use clinical language, therapy language, attachment labels, scores, behavioral labels, or the words experiment, challenge, training, habit, fix, failure, or sabotage. Never mention AI. Never use em dashes, use commas or periods instead.

Keep the complete displayed reflection between approximately 100 and 150 words.`;

function buildPrompt(atoms: AnswerAtom[]): string {
  const byCategory = (c: Category) => atoms.filter((a) => a.category === c);
  const section = (label: string, list: AnswerAtom[]) =>
    list.length
      ? `${label} group:\n${list.map((a) => `[${a.id}]\n${a.text}`).join('\n\n')}`
      : `${label} group: (none provided)`;

  const atomText = [
    section('connection', byCategory('connection')),
    section('helped', byCategory('helped')),
    section('uncertain', byCategory('uncertain')),
  ].join('\n\n');

  return `${SYSTEM_INSTRUCTION}

Their answers, grouped and each tagged with an id:

${atomText}

Respond with ONLY a JSON object, no markdown fences, no other text, in exactly this shape:
{"connectionStyle": {"text": "...", "supportedBy": ["id1", "id2"]}, "whatHelped": {"text": "...", "supportedBy": ["id1"]}, "whenUncertain": {"text": "...", "supportedBy": ["id1", "id2"]}}

Every id in supportedBy must be one of the exact ids shown above in brackets, from the matching group for that section. Do not invent ids. If a group has no answers, use an empty supportedBy array for that section, and keep that section's text to a few words, for example "Not enough information yet.", it will not be shown to the user when there is no supporting evidence, so it does not need to explain itself.`;
}

type ParsedSection = { text: string; supportedBy: string[] };
type ParsedSections = { connectionStyle: ParsedSection; whatHelped: ParsedSection; whenUncertain: ParsedSection };

// Claude reliably follows a "JSON only" instruction almost all the time,
// but not always wraps it in exactly the requested shape (an occasional
// stray code fence, or leading/trailing prose). Strips a fence if present
// and parses defensively rather than trusting the raw string.
function parseSections(raw: string): ParsedSections | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const isSection = (s: unknown): s is ParsedSection =>
      typeof (s as ParsedSection)?.text === 'string' && Array.isArray((s as ParsedSection)?.supportedBy);
    if (isSection(parsed?.connectionStyle) && isSection(parsed?.whatHelped) && isSection(parsed?.whenUncertain)) {
      return {
        connectionStyle: { text: parsed.connectionStyle.text.trim(), supportedBy: parsed.connectionStyle.supportedBy },
        whatHelped: { text: parsed.whatHelped.text.trim(), supportedBy: parsed.whatHelped.supportedBy },
        whenUncertain: { text: parsed.whenUncertain.text.trim(), supportedBy: parsed.whenUncertain.supportedBy },
      };
    }
  } catch {
    // fall through
  }
  return null;
}

// Phrases and words the prompt explicitly forbids because they cross from
// "restating an answer" into diagnosing, typing, or blaming the user. A
// model instruction is not a guarantee, checked the same way the em-dash
// instruction is checked below rather than trusted alone.
const FORBIDDEN_PHRASES = [
  'it sounds like you are',
  "it sounds like you're",
  'you tend to be',
  'deep down',
  'this suggests that your personality',
  'this causes promising connections to fade',
  'this is why your friendships fail',
  'this may cause friendships to fail',
  'you sabotage',
  'you need to',
  'you are afraid of rejection',
  'you are an introvert',
  'you are avoidant',
  'emotionally guarded',
  'attachment style',
  'you always',
  'you never',
  'experiment',
  'challenge',
  'habit',
  'fix',
  'training',
  'failure',
  'sabotage',
  'introvert',
  'avoidant',
];

function containsForbiddenPhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return FORBIDDEN_PHRASES.some((phrase) => lower.includes(phrase));
}

// A section only reaches the user when every cited id is real (came from
// the atom list actually sent this call) AND belongs to that section's own
// allowed category (evidence from one group can't leak into a section it
// doesn't belong to), and at least one id was cited, and the text itself
// doesn't contain a forbidden phrase. Anything else falls back to neutral
// copy rather than displaying an ungrounded, mis-sourced, or overreaching
// sentence.
function isValidSection(section: ParsedSection, category: Category, atomsById: Map<string, AnswerAtom>): boolean {
  if (!section.supportedBy.length) return false;
  if (!section.supportedBy.every((id) => atomsById.get(id)?.category === category)) return false;
  if (containsForbiddenPhrase(section.text)) return false;
  return true;
}

const FALLBACK_CONNECTION_STYLE =
  'You may not have one consistent pattern in how you connect with others yet. That is okay, this reflection may become clearer over time.';
const FALLBACK_WHAT_HELPED =
  'You may not yet see one consistent pattern in how your friendships have grown. Different relationships may have developed in different ways.';
const FALLBACK_WHEN_UNCERTAIN =
  'You may not have one consistent response when a new connection feels uncertain. That is okay, different situations can call for different choices.';

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

  let answers: AnswerPair[];
  let friendshipExperience: FriendshipExperience | undefined;
  let context: 'onboarding' | 'retake' = 'retake';
  try {
    const body = await req.json();
    answers = body.answers;
    friendshipExperience = body.friendshipExperience;
    context = body.context === 'onboarding' ? 'onboarding' : 'retake';
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new Error('Missing answers');
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  // The one-time onboarding call is deliberately never gated or recorded
  // against any cap, see the header comment above. Only the retake path
  // (Profile tab, or ?from=profile) is checked.
  if (context === 'retake') {
    const { data: gate } = await supabase.rpc('get_ai_gate_status', {
      p_user_id: user.id,
      p_function_name: 'generate-personality-narrative',
    });
    if (gate && gate.allowed === false) {
      return blockedResponse(gate);
    }
  }

  // Own-row read, scoped by the caller's own JWT (the same RLS policy
  // profile-build.tsx itself relies on), never another user's data.
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'life_transitions, values, communication_freq, meeting_freq, response_time, hangout_people_preference, hangout_type_preference, friendship_type, communication_style_openness'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  const atoms = [
    ...profileAtoms(profile as ProfileSelections | null),
    ...bigFiveAtoms(answers),
    ...(friendshipExperience ? experienceAtoms(friendshipExperience) : []),
  ];
  const atomsById = new Map(atoms.map((a) => [a.id, a]));

  // 2026-07-28 fix: the earlier 2000-token budget was only ever verified
  // against the empty-evidence-group case (Profile-tab retake, no
  // friendshipExperience, short output by design), never against a fully-
  // populated fresh-onboarding submission (all 10 Big Five answers, all 5
  // friendship-experience answers, a full profile), which asks the model
  // to write a longer connectionStyle section citing many more ids across
  // two source groups. Confirmed live: with all evidence groups fully
  // populated, 2000 tokens truncated roughly half the time (thinking
  // tokens draw from the same budget as the real output, and that
  // overhead varies call to call, the same class of issue this codebase
  // already fixed once for generate-reply-draft's Clean Up mode). Doubled
  // to 4000, real headroom for the fully-populated case specifically, not
  // just a small bump on the number that was already shown insufficient.
  const MAX_TOKENS = 4000;

  async function callAnthropic(): Promise<Response> {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(atoms) }],
      }),
    });
  }

  // A bigger budget lowers truncation risk but Claude's own output length
  // has real variance regardless of budget (confirmed live: identical
  // input produced wildly different generation times across repeated
  // calls), so the token number alone isn't relied on to fully solve
  // this. One retry on a genuine max_tokens truncation before giving up:
  // non-determinism means a second attempt has a real, independent chance
  // of finishing within budget even if the first one didn't.
  let response = await callAnthropic();

  if (!response.ok) {
    const detail = await response.text();
    return new Response(JSON.stringify({ error: 'Anthropic API request failed', detail }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  let data = await response.json();
  // Real cost from BOTH attempts if a truncation retry happens below,
  // Anthropic bills each call independently, a retry is a second real
  // charge, not a replacement of the first.
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  const addUsage = (u: { input_tokens?: number; output_tokens?: number } | undefined) => {
    totalUsage = {
      input_tokens: totalUsage.input_tokens + (u?.input_tokens ?? 0),
      output_tokens: totalUsage.output_tokens + (u?.output_tokens ?? 0),
    };
  };
  addUsage((data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage);

  if ((data as { stop_reason?: string })?.stop_reason === 'max_tokens') {
    response = await callAnthropic();
    if (!response.ok) {
      const detail = await response.text();
      return new Response(JSON.stringify({ error: 'Anthropic API request failed', detail }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }
    data = await response.json();
    addUsage((data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage);
  }

  // Recorded here, only for the retake path (onboarding is never gated or
  // recorded, see the header comment): a real, billed call happened
  // regardless of what the truncation/parse checks below find.
  if (context === 'retake') {
    await supabase.rpc('record_ai_usage', {
      p_user_id: user.id,
      p_function_name: 'generate-personality-narrative',
      p_cost_usd: sonnetCostUsd(totalUsage),
    });
  }

  // Explicit truncation check rather than relying only on the JSON parse
  // failing below: a clearer signal if max_tokens is ever too tight
  // again, instead of an opaque "No reflection in response". Reached only
  // if the retry above also truncated.
  if ((data as { stop_reason?: string })?.stop_reason === 'max_tokens') {
    return new Response(JSON.stringify({ error: 'Response was truncated before completion' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const rawText = extractText(data);
  const sections = rawText ? parseSections(rawText) : null;

  if (!sections) {
    return new Response(JSON.stringify({ error: 'No reflection in response' }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  // Belt and suspenders: the prompt tells Claude not to use em dashes, but
  // models don't always follow style instructions reliably, so strip any
  // that slip through rather than trust the instruction alone.
  const stripEmDash = (t: string) => t.replace(/\s*—\s*/g, ', ');

  const connectionStyle = isValidSection(sections.connectionStyle, 'connection', atomsById)
    ? stripEmDash(sections.connectionStyle.text)
    : FALLBACK_CONNECTION_STYLE;
  const whatHelped = isValidSection(sections.whatHelped, 'helped', atomsById)
    ? stripEmDash(sections.whatHelped.text)
    : FALLBACK_WHAT_HELPED;
  const whenUncertain = isValidSection(sections.whenUncertain, 'uncertain', atomsById)
    ? stripEmDash(sections.whenUncertain.text)
    : FALLBACK_WHEN_UNCERTAIN;

  return new Response(JSON.stringify({ connectionStyle, whatHelped, whenUncertain }), {
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
});
