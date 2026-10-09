// Supabase Edge Function: plan-ideas
//
// Deploy: in the Supabase dashboard, Edge Functions, "Deploy a new
// function", name it plan-ideas, paste this file. Uses the existing
// ANTHROPIC_API_KEY secret.
//
// Writes the three starting ideas for a "Let's plan something" card (and
// each "Show new ideas" set, 10 per card). It never writes a message and
// never chooses for anyone: the two people mark ideas, pick a time and a
// place themselves. See migration 20261009000004_plan_together.sql.
//
// The three ideas:
//   easy       low effort, public, about an hour
//   both_like  something they both like; if nothing is shared, something
//              one of them likes, named honestly ("David likes golf")
//   new        something new to both of them
//
// Safety, checked twice (in the prompt, then by word filters below): never
// romantic, sexual or adult; nothing risky; nothing where drinking is the
// point (coffee and food are fine); public places, and a home only when
// both people said so for this friendship after their first meetup.
//
// If anything goes wrong (no key, a bad answer, an unsafe idea), the
// function answers { fallback: true } and the app adds three hand-written
// safe ideas instead (plan_add_fallback_ideas). The card always works.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-5';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

type Context = {
  board_id: string;
  refreshes_used: number;
  has_ideas: boolean;
  meetup_count: number;
  city: string | null;
  month: string;
  shared_interests: string[];
  my_interests: string[];
  their_interests: string[];
  budget: string | null;
  duration: string | null;
  travel_minutes: number | null;
  home_hosts: string[];
  me: string;
  other: string;
  my_name: string;
  their_name: string;
  avoid: string[];
};

type Idea = {
  slot: 'easy' | 'both_like' | 'new';
  title: string;
  description?: string;
  cost_label?: string;
  duration_label?: string;
  style?: 'talk' | 'side_by_side' | 'mix';
  first_meetup_ok?: boolean;
  interest_note?: string | null;
  home_of?: string | null;
};

const BUDGET_TEXT: Record<string, string> = {
  free: 'free only',
  under_15: 'under $15 per person',
  under_30: 'under $30 per person',
  flexible: 'flexible, but keep it modest',
};
const DURATION_TEXT: Record<string, string> = {
  hour: 'about an hour',
  two_hours: 'one to two hours',
  half_day: 'up to half a day',
};

const label = (key: string) => key.replace(/_/g, ' ');

// Words that are never allowed in an idea.
const NEVER = [
  /\bromantic\b/i, /\bdate night\b/i, /\bcandle ?lit\b/i, /\bcouples?\b/i, /\bflirt/i, /\bsexy\b/i,
  /\bspa\b/i, /\bmassage/i, /\bhot tub/i, /\bsauna/i, /\bstrip\b/i, /\bnude/i,
  /\bwine\b/i, /\bwinery\b/i, /\bvineyard/i, /\bcocktail/i, /\bbeer\b/i, /\bbrewer(y|ies)\b/i, /\bpub\b/i, /\bbars?\b/i,
  /\bhappy hour\b/i, /\bdrinks\b/i, /\bwhisk(e)?y\b/i, /\bsake\b/i, /\bshots?\b/i, /\btasting room/i, /\bbooze/i,
  /\bnight ?club/i, /\bclub night\b/i, /\bcasino/i, /\bgambl/i, /\bhookah/i, /\bcannabis/i, /\bweed\b/i, /\bvape/i,
  /\bgun\b/i, /\bshooting range/i, /\bskydiv/i, /\bbungee/i, /\bmotorcycle/i, /\bcliff/i, /\bhitchhik/i,
];
// Words that point to someone's home. Allowed only on an idea the server
// marked as at a host's home.
const HOME = [/\b(home|house|apartment)\b(?![- ]?made)/i, /\b(my|your|their|his|her)\s+place\b/i, /'s place\b/i, /\bbackyard\b/i];

function isSafe(idea: Idea, homeAllowed: boolean) {
  const text = `${idea.title} ${idea.description ?? ''}`;
  if (NEVER.some((r) => r.test(text))) return false;
  if (!homeAllowed && HOME.some((r) => r.test(text))) return false;
  return true;
}

function buildPrompt(ctx: Context) {
  const firstMeetup = ctx.meetup_count === 0;
  const hostNames = ctx.home_hosts.map((id) => (id === ctx.me ? ctx.my_name : ctx.their_name));
  return `You suggest meetup ideas for two adults becoming friends (strictly platonic) on a friendship app.
Person A is ${ctx.my_name || 'one person'}. Person B is ${ctx.their_name || 'the other person'}.
${firstMeetup ? 'They have not met in person yet. This would be their first meetup.' : `They have met in person ${ctx.meetup_count} time(s).`}
Where: ${ctx.city ?? 'unknown city'}. Month: ${ctx.month}. Make ideas suit the season and the area.
Interests both listed: ${ctx.shared_interests.map(label).join(', ') || 'none'}.
Only ${ctx.my_name || 'A'} listed: ${ctx.my_interests.map(label).join(', ') || 'none'}.
Only ${ctx.their_name || 'B'} listed: ${ctx.their_interests.map(label).join(', ') || 'none'}.
Budget: ${ctx.budget ? BUDGET_TEXT[ctx.budget] : 'keep it low cost'}. Length: ${ctx.duration ? DURATION_TEXT[ctx.duration] : 'about an hour or two'}. Travel: within about ${ctx.travel_minutes ?? 30} minutes.
Do not repeat or closely resemble any of these: ${ctx.avoid.join('; ') || 'nothing yet'}.

Write exactly three ideas:
1. slot "easy": low effort and relaxed, about an hour.
2. slot "both_like": built on one interest from the lists above, preferably one they both listed. Put that interest, copied exactly as written in the list, in "interest". The idea must be a plain, direct example of that interest itself (for golf: a driving range or mini golf; not a general fitness class). If no interest fits well, set "interest" to null.
3. slot "new": something likely new to both of them.

Rules, never break them:
- Strictly friendly. Nothing romantic, flirty, sexual or adult. No spas, massages or anything intimate.
- Nothing where drinking alcohol is the point (no bars, breweries, wine tastings, happy hours). Coffee, tea and food are fine.
- Nothing risky, dangerous or extreme. No gambling.
- Public places only${hostNames.length ? `, except: an idea may be at ${hostNames.join(' or ')}'s home if it fits well. Mark it with home_of set to "A" or "B".` : '. Never anyone\'s home.'}
- Generic kinds of places only (for example "a farmers market"), never invent a business name or event date.
- Plain, warm, short. No em dashes.

Answer with JSON only:
{"ideas":[{"slot":"easy","title":"max 60 chars","description":"one sentence, max 160 chars","cost_label":"like Free or About $10","duration_label":"like About 1 hour","style":"talk|side_by_side|mix","first_meetup_ok":true,"interest":null,"home_of":null}, ...]}
first_meetup_ok is true when the idea is easy, public and low pressure for people meeting for the first time.`;
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

// The heading on the "both like" idea is written here, never by the AI, so
// it can only name an interest one of them really listed.
function interestNote(ctx: Context, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const want = value.trim().toLowerCase().replace(/\s+/g, '_');
  const find = (list: string[]) => list.find((k) => k.toLowerCase() === want || label(k).toLowerCase() === value.trim().toLowerCase());
  const shared = find(ctx.shared_interests);
  if (shared) return `You both like ${label(shared)}`.slice(0, 80);
  const mine = find(ctx.my_interests);
  if (mine && ctx.my_name) return `${ctx.my_name} likes ${label(mine)}`.slice(0, 80);
  const theirs = find(ctx.their_interests);
  if (theirs && ctx.their_name) return `${ctx.their_name} likes ${label(theirs)}`.slice(0, 80);
  return null;
}

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/—|–/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let boardId = '';
  try {
    const body = await req.json();
    boardId = typeof body.boardId === 'string' ? body.boardId : '';
  } catch {
    // fall through
  }
  if (!boardId) return json({ error: 'Missing boardId' }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Also checks the caller is in this chat and the card is open.
  const { data: ctxData, error: ctxError } = await admin.rpc('plan_idea_context', {
    p_board_id: boardId,
    p_user_id: user.id,
  });
  if (ctxError || !ctxData) return json({ error: 'plan_closed' });
  const ctx = ctxData as Context;
  if (ctx.has_ideas && ctx.refreshes_used >= 10) return json({ error: 'refresh_limit' });

  if (!ANTHROPIC_API_KEY) return json({ fallback: true });

  const ideas: Idea[] = [];
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
        max_tokens: 3000,
        messages: [{ role: 'user', content: buildPrompt(ctx) }],
      }),
    });
    if (!response.ok) return json({ fallback: true });
    const data = await response.json();
    if (data?.stop_reason === 'max_tokens') return json({ fallback: true });
    const blocks = (data?.content ?? []) as { type?: string; text?: string }[];
    const parsed = parseJson((blocks.find((b) => b?.type === 'text')?.text ?? '').trim());
    const raw = Array.isArray(parsed?.ideas) ? (parsed!.ideas as Record<string, unknown>[]) : [];

    for (const slot of ['easy', 'both_like', 'new'] as const) {
      const r = raw.find((x) => x?.slot === slot);
      if (!r) continue;
      const homeOf = r.home_of === 'A' ? ctx.me : r.home_of === 'B' ? ctx.other : null;
      const homeAllowed = !!homeOf && ctx.home_hosts.includes(homeOf);
      const idea: Idea = {
        slot,
        title: clean(r.title, 80),
        description: clean(r.description, 240),
        cost_label: clean(r.cost_label, 30),
        duration_label: clean(r.duration_label, 30),
        style: r.style === 'talk' || r.style === 'side_by_side' || r.style === 'mix' ? r.style : 'mix',
        first_meetup_ok: r.first_meetup_ok === true && !homeAllowed,
        interest_note: slot === 'both_like' ? interestNote(ctx, r.interest) : null,
        home_of: homeAllowed ? homeOf : null,
      };
      if (!idea.title || !isSafe(idea, homeAllowed)) continue;
      if (ctx.avoid.some((a) => a.toLowerCase() === idea.title.toLowerCase())) continue;
      ideas.push(idea);
    }
  } catch {
    return json({ fallback: true });
  }

  // All three or none: a half set would look broken.
  if (ideas.length < 3) return json({ fallback: true });

  const { data: saved, error: saveError } = await admin.rpc('save_plan_ideas', {
    p_board_id: boardId,
    p_user_id: user.id,
    p_ideas: ideas,
    p_source: 'ai',
  });
  if (saveError) {
    if (/refresh_limit/.test(saveError.message)) return json({ error: 'refresh_limit' });
    return json({ fallback: true });
  }
  return json({ ok: true, count: saved });
});
