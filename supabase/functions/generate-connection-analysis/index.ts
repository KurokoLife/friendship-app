// Supabase Edge Function: generate-connection-analysis
//
// Deploy: supabase functions deploy generate-connection-analysis
// (Uses the same ANTHROPIC_API_KEY secret already set for the other
// Anthropic-backed functions in this app.)
//
// F13: "Why might we connect?" on-demand analysis, tapped from a Browse
// (F12) card. Unlike F11's generate-match-suggestions, which ranks and
// explains a whole daily batch, this is a single, on-demand look at one
// specific pair, called only when the user actually asks for it.
//
// Same security shape as generate-match-suggestions: forwards the
// caller's own JWT to a client built with the anon key, so every read
// here is subject to the same RLS the app itself would hit, and
// explicitly verifies a real signed-in user via auth.getUser() before
// ever calling Anthropic (the platform's own verify_jwt check alone is
// satisfied by the anon key too, confirmed directly during F18's build).
// The candidate's data is read through discovery_profiles specifically,
// not the raw profiles table, so the same mutual gender-compatibility and
// F9 pause exclusion this whole app already relies on for who's even
// visible to whom applies here too, there is no separate access check to
// get right or get wrong.
//
// AI PHILOSOPHY (AGENTS.md): honest, not just flattering. The prompt
// below explicitly asks for real friction points grounded in the actual
// data, not just shared-interest flattery, and forbids inventing a trait,
// value, or mismatch that isn't actually present in either profile.
//
// Rebuilt per explicit instruction alongside generate-match-suggestions:
// life_transitions is now an array (up to 3 per person, see
// 20260713000005_life_transitions_array.sql), and sharedTraits now
// follows a fixed sub-order (shared life transitions, then shared
// activities with specific details or an honest zero-overlap statement,
// then shared values), matching the same 5-part structure (the other two
// parts, rhythm compatibility and friction, are already their own
// sections, compatibleRhythms and frictionPoints).
//
// Real bug found and fixed while verifying this rebuild live, not
// something this instruction asked for but too serious to leave: this
// model (claude-sonnet-5) can return more than one content block, a
// "thinking" block ahead of the actual "text" block. The old code read
// content[0].text unconditionally, which silently returned an empty
// string whenever a thinking block came first, this function then fell
// through to its own non-AI fallback every single time without ever
// surfacing an error, confirmed live via a temporary diagnostic response
// (removed again below) that dumped the real Anthropic payload and showed
// content[0] was a thinking block, content[1] was the real text.
// extractText() below finds the first block whose type is actually
// "text" instead of assuming position 0. The exact same latent bug exists
// in generate-match-suggestions, generate-reply-draft, and
// generate-personality-narrative, all four are fixed together.

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

// Claude can return multiple content blocks (for example a "thinking"
// block before the real "text" block), the actual answer is not
// guaranteed to be at index 0. Finds the first block that actually is
// text, rather than assuming position.
// AI usage caps/pool (2026-07-29 session): free tier gets 1/week on this
// function, premium draws from the shared monthly dollar pool. Gate is
// checked BEFORE the Anthropic call; usage is recorded only when a real
// call actually happened (response.ok inside the try block below), never
// when the non-AI fallback below is the only thing that ran (no real
// Anthropic cost was incurred in that case, correctly $0 either way).
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

function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const textBlock = blocks.find((b) => b?.type === 'text');
  return (textBlock?.text ?? '').trim();
}

type ActivityInterests = {
  categories?: string[];
  details?: Record<string, Record<string, string[] | string>>;
  other?: string;
};

type ProfileSnapshot = {
  display_name: string | null;
  life_transitions: string[] | null;
  values: string[] | null;
  activity_interests: ActivityInterests | null;
  hangout_people_preference: string | null;
  meeting_freq: string | null;
  communication_freq: string | null;
  response_time: string | null;
  personal_statement: string | null;
};

type Analysis = {
  sharedTraits: string[];
  compatibleRhythms: string[];
  frictionPoints: string[];
};

function stripEmDashes(items: string[]): string[] {
  return items.map((s) => s.replace(/\s*—\s*/g, ', '));
}

// Non-AI safety net, follows the same fixed sub-order and the same
// only-claim-what's-actually-shared rule the AI prompt below is given,
// grounded only in real overlaps and real differences between the two
// actual profiles, never invents anything.
function fallbackAnalysis(viewer: ProfileSnapshot, candidate: ProfileSnapshot, candidateName: string): Analysis {
  const sharedTraits: string[] = [];

  // 1. Shared life transitions.
  const viewerTransitions = new Set(viewer.life_transitions ?? []);
  const sharedTransitions = (candidate.life_transitions ?? []).filter((t) => viewerTransitions.has(t));
  if (sharedTransitions.length > 0) {
    sharedTraits.push(
      `You're both navigating ${sharedTransitions.map((t) => t.toLowerCase()).join(' and ')} right now.`
    );
  }

  // 2. Shared activity interests with specific details, or an honest
  // statement if there's genuinely no overlap, never a vague positive
  // claim in that case.
  const viewerCategories = new Set(viewer.activity_interests?.categories ?? []);
  const sharedCategories = (candidate.activity_interests?.categories ?? []).filter((c) =>
    viewerCategories.has(c)
  );
  if (sharedCategories.length > 0) {
    for (const c of sharedCategories.slice(0, 3)) {
      const detail = candidate.activity_interests?.details?.[c];
      const detailValue = detail ? Object.values(detail)[0] : undefined;
      const detailText = Array.isArray(detailValue) ? detailValue.join(', ') : detailValue;
      const label = c.replace(/_/g, ' ');
      sharedTraits.push(
        detailText
          ? `You both selected ${label}, and ${candidateName} listed ${detailText}.`
          : `You both selected ${label}.`
      );
    }
  } else {
    sharedTraits.push(
      'You have different activity interests, but compatible rhythms and values can still make for a strong connection.'
    );
  }

  // 3. Shared values, named specifically, only if the exact word appears
  // in both arrays.
  const sharedValues = (candidate.values ?? []).filter((v) => (viewer.values ?? []).includes(v));
  for (const v of sharedValues.slice(0, 3)) sharedTraits.push(`You both value ${v.toLowerCase()}.`);

  // 4. Rhythm compatibility.
  const compatibleRhythms: string[] = [];
  if (viewer.meeting_freq && viewer.meeting_freq === candidate.meeting_freq) {
    compatibleRhythms.push(`You both tend to want to meet up ${candidate.meeting_freq.toLowerCase()}.`);
  }
  if (viewer.response_time && viewer.response_time === candidate.response_time) {
    compatibleRhythms.push(`You both tend to reply at a similar pace.`);
  }
  if (viewer.hangout_people_preference && viewer.hangout_people_preference === candidate.hangout_people_preference) {
    compatibleRhythms.push(`You both prefer ${candidate.hangout_people_preference.toLowerCase()} hangouts.`);
  }

  // 5. Worth talking through, honest friction grounded in a real
  // difference.
  const frictionPoints: string[] = [];
  if (viewer.communication_freq && candidate.communication_freq && viewer.communication_freq !== candidate.communication_freq) {
    frictionPoints.push(
      `${candidateName} tends to message ${candidate.communication_freq.toLowerCase()}, which may be more or less often than you've indicated, worth discussing if you connect.`
    );
  }
  if (viewer.meeting_freq && candidate.meeting_freq && viewer.meeting_freq !== candidate.meeting_freq) {
    frictionPoints.push(
      `${candidateName} tends to want to meet up ${candidate.meeting_freq.toLowerCase()}, a different rhythm than what you've indicated, worth discussing if you connect.`
    );
  }
  if (
    viewer.hangout_people_preference &&
    candidate.hangout_people_preference &&
    viewer.hangout_people_preference !== candidate.hangout_people_preference
  ) {
    frictionPoints.push(
      `${candidateName} prefers ${candidate.hangout_people_preference.toLowerCase()} hangouts, different from what you've indicated, worth discussing if you connect.`
    );
  }

  return { sharedTraits, compatibleRhythms, frictionPoints };
}

function buildPrompt(viewer: ProfileSnapshot, candidate: ProfileSnapshot, candidateName: string): string {
  const viewerSummary = JSON.stringify({
    life_transitions: viewer.life_transitions,
    values: viewer.values,
    activity_interests: viewer.activity_interests,
    hangout_people_preference: viewer.hangout_people_preference,
    meeting_freq: viewer.meeting_freq,
    communication_freq: viewer.communication_freq,
    response_time: viewer.response_time,
    personal_statement: viewer.personal_statement,
  });

  const candidateSummary = JSON.stringify({
    display_name: candidateName,
    life_transitions: candidate.life_transitions,
    values: candidate.values,
    activity_interests: candidate.activity_interests,
    hangout_people_preference: candidate.hangout_people_preference,
    meeting_freq: candidate.meeting_freq,
    communication_freq: candidate.communication_freq,
    response_time: candidate.response_time,
    personal_statement: candidate.personal_statement,
  });

  return `You are writing an honest compatibility analysis for a friendship-matching app for adults navigating life transitions (divorce, relocation, bereavement, career change, empty nesting, and others). Not a dating app, no romantic framing ever. Someone can be navigating up to 3 life transitions at once, life_transitions is an array on both sides.

The viewer's profile:
${viewerSummary}

${candidateName}'s profile:
${candidateSummary}

Write three lists, based only on what's actually in the two profiles above:

1. "sharedTraits": written in this order, skipping any part that has nothing real to say. First, shared life transitions, if the two life_transitions arrays share any value, name it specifically ("You're both navigating a career change", not "you have similar life experiences"). Second, shared activity interests, if activity_interests.categories overlap, name the specific shared category, and if either person's nested detail for that category is available, name it too (for example "You both enjoy pickleball and listed yourselves as intermediate level" or "You both selected craft beer and cocktails"). If there is zero overlap in activity_interests.categories, say so honestly instead of forcing a claim: "You have different activity interests, but compatible rhythms and values can still make for a strong connection." Third, shared values, named specifically, only if that exact value string appears in both people's values arrays. Never write "you both value X" unless X is actually present in both arrays.

2. "compatibleRhythms": ways their rhythms actually line up, matching meeting frequency, matching response time, matching hangout style. Only include ones the data actually supports.

3. "frictionPoints": honest, specific potential friction, grounded in a real difference in the data (different communication frequency, different meeting frequency, different hangout style, or a real tension suggested by their personal statements). Write each one the way a caring, direct friend would, for example: "${candidateName} prefers more frequent contact than you've indicated, worth discussing if you connect." Do not soften a real mismatch into vagueness, and do not invent a friction point that isn't actually evidenced by the data, an empty array is correct if there's no real mismatch to name.

Strict rules, reject any temptation to do otherwise:
- Require at least one concrete shared data point before making any positive compatibility claim. A generic sentence that could apply to any two people ("you both value purpose", "you share an interest in connection") is not acceptable unless that exact word or category is verifiably present in both profiles above.
- Never state a positive claim in "sharedTraits" when zero genuine overlap exists for that category, use the honest activity-interests statement given above instead, and don't stretch for a match elsewhere either.
- Every item is one short sentence.
- Warm but direct, not clinical, not a dating-app bio.
- Never use em dashes. Use commas, periods, or restructure the sentence instead.
- Never mention personality trait names, scores, or psychological labels.

Respond with ONLY a JSON object, no prose before or after, no markdown code fences: {"sharedTraits": ["..."], "compatibleRhythms": ["..."], "frictionPoints": ["..."]}`;
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
    p_function_name: 'generate-connection-analysis',
  });
  if (gate && gate.allowed === false) {
    return blockedResponse(gate);
  }

  let candidateId: string;
  try {
    const body = await req.json();
    candidateId = body.candidateId;
    if (!candidateId || typeof candidateId !== 'string') throw new Error('Missing candidateId');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }

  const [{ data: viewerRow }, { data: candidateRow }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'display_name, life_transitions, values, activity_interests, hangout_people_preference, meeting_freq, communication_freq, response_time, personal_statement'
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('discovery_profiles')
      .select(
        'display_name, life_transitions, values, activity_interests, hangout_people_preference, meeting_freq, communication_freq, response_time, personal_statement'
      )
      .eq('user_id', candidateId)
      .maybeSingle(),
  ]);

  if (!candidateRow) {
    return new Response(
      JSON.stringify({ error: 'This profile is not available anymore' }),
      { status: 404, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
    );
  }

  const viewer: ProfileSnapshot = viewerRow ?? {
    display_name: null,
    life_transitions: null,
    values: null,
    activity_interests: null,
    hangout_people_preference: null,
    meeting_freq: null,
    communication_freq: null,
    response_time: null,
    personal_statement: null,
  };
  const candidate = candidateRow as ProfileSnapshot;
  const candidateName = candidate.display_name ?? 'This person';

  if (ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1200,
          messages: [{ role: 'user', content: buildPrompt(viewer, candidate, candidateName) }],
        }),
      });

      if (response.ok) {
        const data = await response.json();

        // Recorded here, not after a successful parse below: a real,
        // billed Anthropic call happened the moment response.ok was
        // true, regardless of whether the JSON parses into a usable
        // analysis (the non-AI fallback further down only ever runs when
        // NO real call happened at all, or this one genuinely failed to
        // parse, correctly recording $0/no occurrence in that case since
        // this record call is scoped to the response.ok branch only).
        await supabase.rpc('record_ai_usage', {
          p_user_id: user.id,
          p_function_name: 'generate-connection-analysis',
          p_cost_usd: sonnetCostUsd(data?.usage),
        });

        const raw = extractText(data);
        const jsonText = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(jsonText) as Partial<Analysis>;
        if (
          Array.isArray(parsed.sharedTraits) &&
          Array.isArray(parsed.compatibleRhythms) &&
          Array.isArray(parsed.frictionPoints)
        ) {
          const analysis: Analysis = {
            sharedTraits: stripEmDashes(parsed.sharedTraits),
            compatibleRhythms: stripEmDashes(parsed.compatibleRhythms),
            frictionPoints: stripEmDashes(parsed.frictionPoints),
          };
          return new Response(JSON.stringify({ analysis, candidateName }), {
            headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
          });
        }
      }
    } catch {
      // Fall through to the non-AI fallback below.
    }
  }

  const analysis = fallbackAnalysis(viewer, candidate, candidateName);
  return new Response(JSON.stringify({ analysis, candidateName }), {
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
});
