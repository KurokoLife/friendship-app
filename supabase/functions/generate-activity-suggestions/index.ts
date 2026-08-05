// Supabase Edge Function: generate-activity-suggestions
//
// Deploy: supabase functions deploy generate-activity-suggestions
//
// F23: activity suggestions, fired from F22's "Let's plan something."
// Three always-shown categories, never filtered by friendship_type, never
// gated on isFirstMeetup (see the prior rebuild's own flagged conflict
// with AGENTS.md's "before first meetup = planned only" note, unchanged
// by this pass):
//   1. low_effort: a small, low-commitment default (coffee, a walk).
//   2. interest_based: one specific idea grounded in a real interest.
//   3. link_out: a genuinely different second idea or resource pointer,
//      from a different activity bucket than category 2 whenever
//      possible, open ended only when there's truly nothing else to draw
//      from.
//
// REDESIGN 2026-07-28, two related problems fixed together:
//
// (a) AI-generated wording, not fixed templates. Every slot used to be a
// single hardcoded string tied to its category (CATEGORY_ACTIVITY_MAP),
// so refreshing produced the exact same text every time. Now one Claude
// call generates the specific idea, description, and message for all
// three slots together, grounded in the real chosen category (or
// explicitly ungrounded for low_effort and the open-ended link_out
// fallback), with recent suggestions already shown to this connection
// (activity_suggestion_history, new table) passed in as "do not repeat
// these." CATEGORY_ACTIVITY_MAP's static content is kept, not deleted,
// it's still what grounds the AI prompt (as a reference example, not a
// script to repeat) and is the fallback if the API call fails or the
// key isn't configured. One combined call, not one call per slot,
// specifically to avoid adding latency, see the verification notes for
// this session for the actual measured time.
//
// (b) Widened interest pool. A pair with thin shared interests (the
// Maria/Aisha case, sharing only the active_outdoors bucket) used to
// fall straight to the fully generic "Explore together" framing for
// category 3 once no second shared bucket existed. Now the pool tried
// for both category 2 and category 3 is: shared interests first, then
// either person's individual (non-shared) interests, then the open-ended
// framing only as the true last resort. Individual interests are always
// clearly attributed (via ChosenCategory.source and interestNote below),
// this app's AI philosophy anchor forbids ever implying two people share
// something that was only ever confirmed for one of them.
//
// LIVE EVENT API STATUS (checked 2026-07-26, unchanged): neither
// TICKETMASTER_API_KEY nor EVENTBRITE_API_KEY is configured, confirmed
// via `supabase secrets list`. The live-fetch functions below still run
// first for category 2 and upgrade automatically the moment a real key
// is set, no code change needed, but today they always return null and
// category 2 falls through to the AI-generated (or static fallback)
// path.
//
// Bar exclusion (unchanged rule, now applied across a wider pool): a
// bar-related category (wine_cocktails_beer, nightlife) is excluded from
// the usable pool entirely, whether it would have come from shared or
// either person's individual interests, whenever either participant's
// bar_preference is "I don't drink".

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const TICKETMASTER_API_KEY = Deno.env.get('TICKETMASTER_API_KEY');
const EVENTBRITE_API_KEY = Deno.env.get('EVENTBRITE_API_KEY');
const MODEL = 'claude-sonnet-5';

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

// AI usage caps/pool (2026-07-29 session): free-tier per-function caps and
// the premium shared monthly dollar pool are enforced via
// get_ai_gate_status (checked BEFORE any real Anthropic call so a blocked
// request never spends real API cost) and record_ai_usage (called only
// after a genuinely completed Anthropic response, so a network failure
// never counts against either). Real cost is computed from Anthropic's own
// returned usage tokens at Claude Sonnet 5's standard per-token rate, not
// the temporary intro rate (expires 2026-08-31, would make a permanent
// quota's math wrong within weeks): $3.00 / 1M input, $15.00 / 1M output.
const SONNET_5_INPUT_PER_TOKEN = 3.0 / 1_000_000;
const SONNET_5_OUTPUT_PER_TOKEN = 15.0 / 1_000_000;

function sonnetCostUsd(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) * SONNET_5_INPUT_PER_TOKEN + (usage.output_tokens ?? 0) * SONNET_5_OUTPUT_PER_TOKEN;
}

// Deliberately HTTP 200, a known, handled outcome, not a server error,
// matching this app's own established convention (generate-reply-draft's
// too-long-input and truncation cases) for a clean client-side branch
// rather than a generic error. Copy is calm and non-punitive, no shaming,
// no aggressive upsell, matching the Capacity System's own established
// tone ("show remaining capacity calmly").
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
    : gate.reason === 'daily_cap_reached'
      ? "You've reached today's free limit for this, and you're out of extra credits too. It resets tomorrow, or you can buy 50 credits for $1.99, or upgrade to Premium for more room."
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

// Same "don't trust content[0]" fix already applied everywhere else in
// this app that calls Claude.
function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const textBlock = blocks.find((b) => b?.type === 'text');
  return (textBlock?.text ?? '').trim();
}

const BAR_KEYWORDS = ['bar', 'brewery', 'pub', 'cocktail', 'wine', 'nightclub', 'winery', 'taproom', 'distillery'];

function mentionsBar(text: string): boolean {
  const lower = text.toLowerCase();
  return BAR_KEYWORDS.some((kw) => lower.includes(kw));
}

type SuggestionCategory = 'low_effort' | 'interest_based' | 'link_out';

type Suggestion = {
  category: SuggestionCategory;
  label: string;
  description: string;
  isFree: boolean;
  freeAlternative: string | null;
  source: 'ticketmaster' | 'eventbrite' | 'curated' | 'link_out';
  // Replaces the old sharedInterest field: always attributed correctly
  // (both people, just the writer, or just the recipient), never implies
  // sharing that was never confirmed.
  interestNote?: string;
  message: string;
};

const LOW_EFFORT_IDEAS: { label: string; description: string; isFree: boolean; freeAlternative: string | null }[] = [
  {
    label: 'Grab coffee',
    description: 'A short, low-pressure catch-up over coffee.',
    isFree: false,
    freeAlternative: 'Or meet at a park instead, no cost either way.',
  },
  {
    label: 'Take a walk',
    description: 'A walk somewhere easy to talk, no reservation needed.',
    isFree: true,
    freeAlternative: null,
  },
];

// Curated fallback and AI-grounding reference for every one of the 40
// real activity_interests categories (src/lib/filter-options.ts's
// ACTIVITY_CATEGORY_OPTIONS). activityLabel/activityDescription are no
// longer shown directly, they're the example idea given to Claude (so it
// stays grounded in something real and recognizable) and the static
// fallback if the API call fails. linkOutSource is deliberately never a
// specific named place or event, Yelp/Google Maps for anything
// place-based, Eventbrite for anything time-bound.
type CategoryMapping = {
  activityLabel: string;
  activityDescription: string;
  isFree: boolean;
  freeAlternative: string | null;
  linkOutSource: 'yelp_maps' | 'eventbrite';
  linkOutQuery: string;
  isBarRelated?: boolean;
};

const CATEGORY_ACTIVITY_MAP: Record<string, CategoryMapping> = {
  movies: {
    activityLabel: 'Catch a movie',
    activityDescription: 'See something new together, no pressure to talk the whole time.',
    isFree: false,
    freeAlternative: 'Or watch something at home instead, no ticket needed.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'movie theaters',
  },
  music: {
    activityLabel: 'Find a music spot',
    activityDescription: 'A place with live or recorded music you both enjoy.',
    isFree: false,
    freeAlternative: 'Or make a shared playlist and listen together over coffee instead.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'music events',
  },
  food: {
    activityLabel: 'Try a new restaurant together',
    activityDescription: 'Pick a place neither of you has been and split something.',
    isFree: false,
    freeAlternative: 'Or cook something at home together instead, no reservation needed.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'restaurants',
  },
  sports: {
    activityLabel: 'Catch a game together',
    activityDescription: 'Watch a local team play, in person or wherever it is on.',
    isFree: false,
    freeAlternative: 'Or watch from somewhere free instead of buying tickets.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'sports events',
  },
  fitness: {
    activityLabel: 'Work out together',
    activityDescription: 'Hit the gym or try a fitness class side by side.',
    isFree: false,
    freeAlternative: 'Or do a free outdoor workout or run instead.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'gyms or fitness studios',
  },
  travel: {
    activityLabel: 'Plan a day trip',
    activityDescription: 'Pick somewhere neither of you has explored, even just a nearby town.',
    isFree: false,
    freeAlternative: 'Or explore a new neighborhood in your own city for free.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'day trip spots nearby',
  },
  arts_culture: {
    activityLabel: 'Visit a museum or gallery',
    activityDescription: 'See a current exhibit and talk about what you each notice.',
    isFree: false,
    freeAlternative: 'Many museums have a free day or free hours, worth checking first.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'museum and gallery events',
  },
  games: {
    activityLabel: 'Game night',
    activityDescription: "Board games, cards, or a game bar, whatever you're both into.",
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'game bars or board game cafes',
  },
  outdoors: {
    activityLabel: 'Check out a new trail',
    activityDescription: 'Find a trail or park neither of you has explored yet.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'hiking trails or parks',
  },
  reading: {
    activityLabel: 'Browse a bookstore together',
    activityDescription: 'Wander a local bookstore and swap recommendations.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'bookstores',
  },
  cooking: {
    activityLabel: 'Cook something together',
    activityDescription: 'Pick a recipe neither of you has made and cook it side by side.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'cooking classes',
  },
  volunteering: {
    activityLabel: 'Volunteer together',
    activityDescription: 'Find a local cause you both care about and pitch in for an afternoon.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'volunteer events',
  },
  nightlife: {
    activityLabel: 'Check out a bar or lounge',
    activityDescription: 'Find a spot with a good atmosphere for catching up.',
    isFree: false,
    freeAlternative: 'Or meet somewhere free first and decide from there.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'bars or lounges',
    isBarRelated: true,
  },
  pets: {
    activityLabel: 'Dog park meetup',
    activityDescription: 'Bring your pets along, or just visit a dog park together.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'dog parks or pet friendly spots',
  },
  technology: {
    activityLabel: 'Check out a tech meetup',
    activityDescription: "Find a local meetup or expo around something you're both curious about.",
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'tech meetups',
  },
  fashion: {
    activityLabel: 'Browse a pop-up or market',
    activityDescription: 'Check out a local market or pop-up shop together.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'fashion pop-ups or markets',
  },
  photography: {
    activityLabel: 'Go on a photo walk',
    activityDescription: 'Pick a scenic spot and wander with your phones or cameras.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'scenic photo spots',
  },
  dancing: {
    activityLabel: 'Try a dance class or social',
    activityDescription: 'Find a beginner class or social dance night, no experience needed.',
    isFree: false,
    freeAlternative: 'Some studios offer a free first class, worth checking.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'dance classes or socials',
  },
  yoga_pilates: {
    activityLabel: 'Take a class together',
    activityDescription: 'Try a yoga or pilates class neither of you has been to.',
    isFree: false,
    freeAlternative: 'Or do a free session together at home or in a park.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'yoga or pilates studios',
  },
  wellness_mindfulness: {
    activityLabel: 'Try a wellness activity',
    activityDescription: 'A meditation session, sound bath, or something similarly low-key.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'wellness or meditation events',
  },
  running_cycling: {
    activityLabel: 'Go for a run or ride',
    activityDescription: 'Pick a route neither of you has done and go at an easy pace.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'running or cycling routes',
  },
  tennis_pickleball: {
    activityLabel: 'Play a match',
    activityDescription: 'Book a court and play a casual game.',
    isFree: false,
    freeAlternative: 'Some public courts are free, worth checking before booking.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'tennis or pickleball courts',
  },
  golf: {
    activityLabel: 'Hit the driving range or a round',
    activityDescription: 'A relaxed round or just the driving range works either way.',
    isFree: false,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'golf courses or driving ranges',
  },
  martial_arts: {
    activityLabel: 'Try a class together',
    activityDescription: 'Drop into a beginner-friendly martial arts class.',
    isFree: false,
    freeAlternative: 'Some studios offer a free trial class, worth checking.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'martial arts studios',
  },
  wine_cocktails_beer: {
    activityLabel: 'Wine or cocktail tasting',
    activityDescription: 'Find a tasting or a new spot to try something neither of you has had.',
    isFree: false,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'wine bars or breweries',
    isBarRelated: true,
  },
  coffee_culture: {
    activityLabel: 'Try a new coffee spot',
    activityDescription: 'Find a coffee shop neither of you has been to yet.',
    isFree: false,
    freeAlternative: 'Or make coffee at home and meet there instead.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'coffee shops',
  },
  bbq_grilling: {
    activityLabel: 'Have a cookout',
    activityDescription: 'Grill something together, even a small backyard setup works.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'bbq spots or grilling supply stores',
  },
  writing_journaling: {
    activityLabel: 'Write together',
    activityDescription: 'Meet at a quiet spot and write side by side, then share if you want.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'quiet cafes for writing',
  },
  crafts: {
    activityLabel: 'Try a craft workshop',
    activityDescription: 'Pottery, painting, or another hands-on class neither of you has tried.',
    isFree: false,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'craft workshops',
  },
  collecting: {
    activityLabel: 'Browse a market or shop',
    activityDescription: 'Check out a flea market, record shop, or specialty store together.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'markets or specialty shops',
  },
  live_music: {
    activityLabel: 'Catch a live show',
    activityDescription: 'Look for a show or open mic happening this week.',
    isFree: false,
    freeAlternative: 'Many venues have free open mic nights, worth checking first.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'live music shows',
  },
  theater_performing_arts: {
    activityLabel: 'See a show',
    activityDescription: 'A play, a local production, or a performance neither of you has seen.',
    isFree: false,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'theater shows',
  },
  podcasts_audiobooks: {
    activityLabel: 'Swap recommendations',
    activityDescription: 'Trade a favorite episode or audiobook over coffee and talk about it.',
    isFree: false,
    freeAlternative: 'Or meet at a park instead of a coffee shop, no cost either way.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'coffee shops',
  },
  history_learning: {
    activityLabel: 'Take a local history tour',
    activityDescription: 'A walking tour or historic site neither of you has visited.',
    isFree: false,
    freeAlternative: 'Some historic sites and walking tours are free, worth checking first.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'history tours or talks',
  },
  spirituality_faith: {
    activityLabel: 'Attend a community gathering',
    activityDescription: "A service, talk, or community event that fits what you're both drawn to.",
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'community or faith events',
  },
  gardening_plants: {
    activityLabel: 'Visit a garden or plant shop',
    activityDescription: "A botanical garden or local plant nursery, whatever's nearby.",
    isFree: false,
    freeAlternative: 'Many botanical gardens have a free day, worth checking first.',
    linkOutSource: 'yelp_maps',
    linkOutQuery: 'botanical gardens or plant shops',
  },
  environmental_activism: {
    activityLabel: 'Join a cleanup or planting event',
    activityDescription: 'Find a local environmental event and pitch in together.',
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'environmental volunteer events',
  },
  self_improvement: {
    activityLabel: 'Attend a workshop together',
    activityDescription: "A talk or workshop on something you're both working on.",
    isFree: false,
    freeAlternative: 'Some workshops are free or donation based, worth checking first.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'personal development workshops',
  },
  entrepreneurship: {
    activityLabel: 'Check out a meetup',
    activityDescription: "A local networking event or founder meetup you're both curious about.",
    isFree: true,
    freeAlternative: null,
    linkOutSource: 'eventbrite',
    linkOutQuery: 'entrepreneur meetups',
  },
  comedy_live_shows: {
    activityLabel: 'Catch a comedy show',
    activityDescription: 'Find an open mic or a show happening nearby.',
    isFree: false,
    freeAlternative: 'Open mic nights are often free or very cheap, worth checking first.',
    linkOutSource: 'eventbrite',
    linkOutQuery: 'comedy shows',
  },
};

// Broad activity-type buckets, one per real key in
// ACTIVITY_CATEGORY_OPTIONS (src/lib/filter-options.ts), used to force
// genuine variety between category 2 and category 3 instead of two
// specific interests that are really the same type of activity restated.
// Judgment calls worth flagging: travel went to active_outdoors, games
// and reading went to entertainment_culture, nightlife went to
// creative_other rather than food_drink (atmosphere and socializing, not
// the food or drink itself).
type ActivityBucket = 'food_drink' | 'active_outdoors' | 'entertainment_culture' | 'creative_other';

const CATEGORY_BUCKET_MAP: Record<string, ActivityBucket> = {
  food: 'food_drink',
  cooking: 'food_drink',
  coffee_culture: 'food_drink',
  wine_cocktails_beer: 'food_drink',
  bbq_grilling: 'food_drink',

  sports: 'active_outdoors',
  fitness: 'active_outdoors',
  outdoors: 'active_outdoors',
  running_cycling: 'active_outdoors',
  tennis_pickleball: 'active_outdoors',
  golf: 'active_outdoors',
  martial_arts: 'active_outdoors',
  dancing: 'active_outdoors',
  yoga_pilates: 'active_outdoors',
  wellness_mindfulness: 'active_outdoors',
  travel: 'active_outdoors',

  movies: 'entertainment_culture',
  music: 'entertainment_culture',
  arts_culture: 'entertainment_culture',
  reading: 'entertainment_culture',
  games: 'entertainment_culture',
  live_music: 'entertainment_culture',
  theater_performing_arts: 'entertainment_culture',
  podcasts_audiobooks: 'entertainment_culture',
  history_learning: 'entertainment_culture',
  comedy_live_shows: 'entertainment_culture',

  volunteering: 'creative_other',
  nightlife: 'creative_other',
  pets: 'creative_other',
  technology: 'creative_other',
  fashion: 'creative_other',
  photography: 'creative_other',
  writing_journaling: 'creative_other',
  crafts: 'creative_other',
  collecting: 'creative_other',
  spirituality_faith: 'creative_other',
  gardening_plants: 'creative_other',
  environmental_activism: 'creative_other',
  self_improvement: 'creative_other',
  entrepreneurship: 'creative_other',
};

type ActivityInterests = { categories?: string[] };

async function fetchTicketmasterEvent(
  lat: number,
  lng: number,
  keyword: string,
  excludeBars: boolean,
  otherName: string | null
): Promise<Suggestion | null> {
  if (!TICKETMASTER_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      apikey: TICKETMASTER_API_KEY,
      latlong: `${lat},${lng}`,
      radius: '25',
      unit: 'miles',
      keyword,
      sort: 'date,asc',
      size: '5',
    });
    const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json();
    const events = data?._embedded?.events as
      | { name: string; url: string; priceRanges?: { min: number }[]; classifications?: { segment?: { name?: string } }[] }[]
      | undefined;
    if (!events?.length) return null;

    const candidate = events.find((e) => !excludeBars || !mentionsBar(e.name));
    if (!candidate) return null;

    const price = candidate.priceRanges?.[0]?.min;
    return {
      category: 'interest_based',
      label: candidate.name,
      description: 'A real local event, matched to what you both like.',
      isFree: price === undefined || price === 0,
      freeAlternative: price ? 'Or catch up at a nearby coffee shop instead, no ticket needed.' : null,
      source: 'ticketmaster',
      message: `Hey ${otherName ?? 'there'}, want to check out "${candidate.name}"? No pressure either way.`,
    };
  } catch {
    return null;
  }
}

async function fetchEventbriteEvent(
  lat: number,
  lng: number,
  keyword: string,
  excludeBars: boolean,
  otherName: string | null
): Promise<Suggestion | null> {
  if (!EVENTBRITE_API_KEY) return null;
  try {
    const params = new URLSearchParams({
      'location.latitude': String(lat),
      'location.longitude': String(lng),
      'location.within': '25mi',
      q: keyword,
      'sort_by': 'date',
    });
    const response = await fetch(`https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`, {
      headers: { Authorization: `Bearer ${EVENTBRITE_API_KEY}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const events = data?.events as { name?: { text?: string }; is_free?: boolean }[] | undefined;
    if (!events?.length) return null;

    const candidate = events.find((e) => !excludeBars || !mentionsBar(e.name?.text ?? ''));
    if (!candidate?.name?.text) return null;

    return {
      category: 'interest_based',
      label: candidate.name.text,
      description: 'A real local event, matched to what you both like.',
      isFree: Boolean(candidate.is_free),
      freeAlternative: candidate.is_free ? null : 'Or catch up at a nearby coffee shop instead, no ticket needed.',
      source: 'eventbrite',
      message: `Hey ${otherName ?? 'there'}, want to check out "${candidate.name.text}"? No pressure either way.`,
    };
  } catch {
    return null;
  }
}

type CategorySource = 'shared' | 'viewer_individual' | 'other_individual';
type ChosenCategory = { key: string; source: CategorySource };

// Unified pool: shared interests first (highest priority, exactly like
// before), then the viewer's own individual interests, then the other
// person's individual interests, each bar-filtered the same way. Primary
// is simply the pool's first entry, which naturally prefers a real
// shared interest whenever one exists, only reaching into individual
// interests when there's truly no overlap. Secondary is the first
// remaining pool entry (searching the WHOLE pool, shared and individual
// alike) whose bucket differs from the primary's, so category 3 gets
// genuine variety even when the pair's only shared interests are all one
// bucket (the Maria/Aisha case) by reaching into either person's
// individual interests before giving up and falling to the open-ended
// framing.
function pickInterestCategories(
  viewerCategories: string[],
  otherCategories: string[],
  excludeBars: boolean
): { primary: ChosenCategory | null; secondary: ChosenCategory | null } {
  const isUsable = (key: string) => {
    const mapping = CATEGORY_ACTIVITY_MAP[key];
    if (!mapping) return false;
    if (excludeBars && mapping.isBarRelated) return false;
    return true;
  };

  const shared = viewerCategories.filter((c) => otherCategories.includes(c)).filter(isUsable);
  const viewerOnly = viewerCategories.filter((c) => !otherCategories.includes(c)).filter(isUsable);
  const otherOnly = otherCategories.filter((c) => !viewerCategories.includes(c)).filter(isUsable);

  const pool: ChosenCategory[] = [
    ...shared.map((key) => ({ key, source: 'shared' as const })),
    ...viewerOnly.map((key) => ({ key, source: 'viewer_individual' as const })),
    ...otherOnly.map((key) => ({ key, source: 'other_individual' as const })),
  ];

  if (pool.length === 0) return { primary: null, secondary: null };

  const primary = pool[0];
  const primaryBucket = CATEGORY_BUCKET_MAP[primary.key];
  const secondary = pool.slice(1).find((c) => CATEGORY_BUCKET_MAP[c.key] !== primaryBucket) ?? null;

  return { primary, secondary };
}

// Always attributed honestly: "you both like X" only when genuinely
// shared, "you like X" or "{name} likes X" when it's one person's own
// interest being introduced to the other, never implying sharing that
// was never confirmed.
function interestNoteFor(chosen: ChosenCategory | null, otherName: string | null): string | undefined {
  if (!chosen) return undefined;
  const label = chosen.key.replace(/_/g, ' ');
  if (chosen.source === 'shared') return `you both like ${label}`;
  if (chosen.source === 'viewer_individual') return `you like ${label}`;
  return otherName ? `${otherName} likes ${label}` : `they like ${label}`;
}

// Reads history from the pool table's own consumed rows: a consumed row
// is, by definition, a suggestion that was actually shown to this
// connection, exactly what the no-repeat prompt needs, no separate
// history table required.
async function fetchRecentSuggestionTexts(
  supabase: ReturnType<typeof createClient>,
  connectionId: string
): Promise<Record<SuggestionCategory, string[]>> {
  const result: Record<SuggestionCategory, string[]> = { low_effort: [], interest_based: [], link_out: [] };
  const { data } = await supabase
    .from('activity_suggestion_pool')
    .select('category, label')
    .eq('connection_id', connectionId)
    .eq('consumed', true)
    .order('created_at', { ascending: false })
    .limit(30);

  for (const row of (data ?? []) as { category: SuggestionCategory; label: string }[]) {
    if (result[row.category] && result[row.category].length < 5) {
      result[row.category].push(row.label);
    }
  }
  return result;
}

type SlotResult = {
  category: SuggestionCategory;
  label: string;
  description: string;
  message: string;
  isFree: boolean;
  freeAlternative: string | null;
};

// Generates SET_COUNT full sets (each a low_effort, interest_based, and
// link_out slot) in one Claude call, not one call per tap. Live-tested
// before this redesign: a single set per call took 7 to 17 seconds,
// genuinely too slow for a tap-and-wait UI. Generating a small batch
// ahead of time means only the tap that empties the reserve pays that
// cost, the other SET_COUNT - 1 taps read an already-generated set
// straight from the pool table, no Claude call at all. The prompt
// explicitly requires the sets to be mutually distinct from each other,
// not just from prior history, so the reserve itself has real variety.
// Measured directly, not guessed: SET_COUNT=2 and SET_COUNT=3 both cost
// roughly the same wall-clock time per generation call (20 to 30
// seconds either way, most of it appears to be fixed overhead, not
// linear with the number of items requested), so 3 wins on typical
// experience for the same worst case, only 1 in 3 taps pays the
// generation cost instead of 1 in 2.
const SET_COUNT = 3;

type GenerationResult = {
  sets: SlotResult[][] | null;
  // Real usage tokens from this call, null whenever no real Anthropic call
  // was made (no key, or fetch failed before a response body existed).
  // Threaded back to the caller so the caps/pool session (2026-07-29) can
  // record real cost, not a flat per-call estimate.
  usage: { input_tokens: number; output_tokens: number } | null;
};

async function generateVariedSuggestionBatches(
  primary: ChosenCategory | null,
  secondary: ChosenCategory | null,
  excludeBars: boolean,
  otherName: string | null,
  recentTexts: Record<SuggestionCategory, string[]>
): Promise<GenerationResult> {
  if (!ANTHROPIC_API_KEY) return { sets: null, usage: null };

  const other = otherName ?? 'them';

  function groundingFor(chosen: ChosenCategory | null, role: 'the main activity idea' | 'a resource to point them toward'): string {
    if (!chosen) {
      return role === 'a resource to point them toward'
        ? 'No specific interest applies here, keep this fully open ended: suggest pulling up Yelp or Google Maps together and seeing what looks interesting nearby, not tied to any particular interest.'
        : 'No specific shared or individual interest was found for this pair. Suggest something new and open to try together, without claiming any specific shared interest.';
    }
    const interestLabel = chosen.key.replace(/_/g, ' ');
    const example = CATEGORY_ACTIVITY_MAP[chosen.key]?.activityLabel ?? interestLabel;
    if (chosen.source === 'shared') {
      return `Ground this as ${role} in "${interestLabel}", a real interest BOTH people share, confirmed from their profiles. One example idea in this space is "${example}". Come up with your own specific angle or variation, do not just reuse that exact wording every time.`;
    }
    if (chosen.source === 'viewer_individual') {
      return `Ground this as ${role} in "${interestLabel}", a real interest of the person WRITING this message (call them "you" in the message), not confirmed to be shared by ${other}. Frame it as introducing your own interest and inviting ${other} to try it with you, never claim ${other} already likes this too. One example idea in this space is "${example}", vary the specific angle.`;
    }
    return `Ground this as ${role} in "${interestLabel}", a real interest of ${other} specifically, confirmed from their profile, not confirmed to be shared by the person writing this message. Frame it as inviting ${other} to do something around their own interest, something like "Since you're into ${interestLabel}...", never claim the writer shares this interest too. One example idea in this space is "${example}", vary the specific angle.`;
  }

  const recentBlock = (cat: SuggestionCategory) => (recentTexts[cat].length ? recentTexts[cat].join('; ') : 'none yet');

  const barRule = excludeBars
    ? '\n- Never suggest anything involving alcohol, a bar, brewery, winery, or similar, one or both people do not drink.'
    : '';

  const prompt = `You are generating varied activity suggestions for two people on a friendship app who are chatting and considering meeting up, across three slots. Generate ${SET_COUNT} DIFFERENT full sets (each set has all three slots), so a person refreshing multiple times in a row sees genuine variety. The ${SET_COUNT} sets must be mutually distinct from each other, not just cosmetically different wording of the same idea, in addition to not repeating anything already used (listed below). The message recipient's name is ${other}.

Slot 1 (low_effort), for every set: Not tied to any specific interest, just a small, low commitment, no-pressure default, in the spirit of grabbing coffee or going for a walk, but a genuinely different specific idea in each of the ${SET_COUNT} sets.
Already used for this pair recently, do not repeat any of these: ${recentBlock('low_effort')}

Slot 2 (interest_based), for every set: ${groundingFor(primary, 'the main activity idea')}
Already used for this pair recently, do not repeat any of these: ${recentBlock('interest_based')}

Slot 3 (link_out), for every set: ${groundingFor(secondary, 'a resource to point them toward')}
Already used for this pair recently, do not repeat any of these: ${recentBlock('link_out')}

Rules that apply to every slot in every set:
- Never invent, assume, or add an interest, activity, or fact that isn't explicitly given to you above. If a slot is grounded in a specific interest, stay within that interest, only vary the specific idea or wording.
- Each message is short (1 to 3 sentences), first person, warm and casual, never romantic in tone, never presumptuous about booking anything, nothing is booked yet, this is a proposal or a suggestion to look together.
- isFree should be true only if the specific idea you propose genuinely costs nothing. If isFree is false, freeAlternative must be a real, different free option, never null.
- Never use em dashes. Use commas, periods, or restructure the sentence instead.${barRule}

Respond with ONLY a JSON array of exactly ${SET_COUNT * 3} elements, no prose before or after, no markdown code fences. Each element exactly: {"set": 0 to ${SET_COUNT - 1}, "slot": "low_effort" or "interest_based" or "link_out", "label": "...", "description": "...", "message": "...", "isFree": true or false, "freeAlternative": "..." or null}`;

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
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return { sets: null, usage: null };

    const data = await response.json();
    const raw = extractText(data);
    const jsonText = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(jsonText) as {
      set: number;
      slot: string;
      label: string;
      description: string;
      message: string;
      isFree: boolean;
      freeAlternative: string | null;
    }[];

    const bySet = new Map<number, SlotResult[]>();
    for (const entry of parsed) {
      if (entry?.set === undefined || !entry?.slot || !entry?.label || !entry?.message) continue;
      const list = bySet.get(entry.set) ?? [];
      list.push({
        category: entry.slot as SuggestionCategory,
        label: entry.label.replace(/\s*—\s*/g, ', '),
        description: (entry.description ?? '').replace(/\s*—\s*/g, ', '),
        message: entry.message.replace(/\s*—\s*/g, ', '),
        isFree: Boolean(entry.isFree),
        freeAlternative: entry.freeAlternative ? entry.freeAlternative.replace(/\s*—\s*/g, ', ') : null,
      });
      bySet.set(entry.set, list);
    }

    const sets: SlotResult[][] = [];
    for (let i = 0; i < SET_COUNT; i++) {
      const set = bySet.get(i);
      if (!set || set.length !== 3) continue;
      sets.push(set);
    }
    return { sets: sets.length > 0 ? sets : null, usage: data.usage ?? null };
  } catch {
    return { sets: null, usage: null };
  }
}

// Static fallback if the API call fails entirely or the key isn't
// configured, same content the curated map already provided before this
// redesign, still correctly attributed via interestNote.
function staticFallback(
  category: SuggestionCategory,
  chosen: ChosenCategory | null,
  otherName: string | null
): Suggestion {
  const name = otherName ?? 'there';
  if (category === 'low_effort') {
    const idea = LOW_EFFORT_IDEAS[Math.floor(Math.random() * LOW_EFFORT_IDEAS.length)];
    return {
      category,
      label: idea.label,
      description: idea.description,
      isFree: idea.isFree,
      freeAlternative: idea.freeAlternative,
      source: 'curated',
      message: `Hey ${name}, want to ${idea.label.toLowerCase()}? No pressure either way.`,
    };
  }
  if (category === 'interest_based') {
    if (!chosen) {
      return {
        category,
        label: 'Try something new together',
        description: 'Pick something neither of you has done before and give it a shot.',
        isFree: true,
        freeAlternative: null,
        source: 'curated',
        message: `Hey ${name}, want to try something neither of us has done before? No pressure either way.`,
      };
    }
    const mapping = CATEGORY_ACTIVITY_MAP[chosen.key];
    return {
      category,
      label: mapping.activityLabel,
      description: mapping.activityDescription,
      isFree: mapping.isFree,
      freeAlternative: mapping.freeAlternative,
      source: 'curated',
      interestNote: interestNoteFor(chosen, otherName),
      message: `Hey ${name}, want to ${mapping.activityLabel.toLowerCase()}? No pressure either way.`,
    };
  }
  // link_out
  if (!chosen) {
    return {
      category,
      label: 'Explore together',
      description: 'Pull up Yelp or Google Maps and see what looks interesting nearby.',
      isFree: true,
      freeAlternative: null,
      source: 'link_out',
      message: `Hey ${name}, want to pull up Yelp or Google Maps together and see what looks interesting nearby? No pressure either way.`,
    };
  }
  const mapping = CATEGORY_ACTIVITY_MAP[chosen.key];
  const description =
    mapping.linkOutSource === 'eventbrite'
      ? `Check Eventbrite for ${mapping.linkOutQuery} happening near you this week.`
      : `Check Yelp or Google Maps for ${mapping.linkOutQuery} near you.`;
  return {
    category,
    label: mapping.linkOutSource === 'eventbrite' ? 'Check Eventbrite together' : 'Check Yelp or Google Maps together',
    description,
    isFree: true,
    freeAlternative: null,
    source: 'link_out',
    interestNote: interestNoteFor(chosen, otherName),
    message: `Hey ${name}, want to ${description.toLowerCase()}? No pressure either way.`,
  };
}

type PoolRow = {
  id: string;
  batch_id: string;
  category: SuggestionCategory;
  label: string;
  description: string;
  message: string;
  is_free: boolean;
  free_alternative: string | null;
  interest_note: string | null;
  source: string;
};

function poolRowToSuggestion(row: PoolRow): Suggestion {
  return {
    category: row.category,
    label: row.label,
    description: row.description,
    isFree: row.is_free,
    freeAlternative: row.free_alternative,
    source: row.source as Suggestion['source'],
    interestNote: row.interest_note ?? undefined,
    message: row.message,
  };
}

// The fast path: look for an already-generated, not-yet-shown batch (one
// full set of 3, one per category, sharing a batch_id) sitting in the
// pool. Oldest first, so batches get used in the order they were made.
// Returns null when the pool is empty or the connection has never had a
// batch generated (both mean the same thing to the caller: go generate
// one now).
async function fetchReadyBatch(
  supabase: ReturnType<typeof createClient>,
  connectionId: string
): Promise<PoolRow[] | null> {
  const { data } = await supabase
    .from('activity_suggestion_pool')
    .select('id, batch_id, category, label, description, message, is_free, free_alternative, interest_note, source')
    .eq('connection_id', connectionId)
    .eq('consumed', false)
    .order('created_at', { ascending: true })
    .limit(30);

  const rows = (data ?? []) as PoolRow[];
  if (rows.length === 0) return null;

  const byBatch = new Map<string, PoolRow[]>();
  for (const row of rows) {
    const list = byBatch.get(row.batch_id) ?? [];
    list.push(row);
    byBatch.set(row.batch_id, list);
  }
  for (const list of byBatch.values()) {
    if (list.length === 3 && new Set(list.map((r) => r.category)).size === 3) {
      return list;
    }
  }
  return null;
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

  let body: { connectionId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.connectionId) {
    return jsonResponse({ error: 'connectionId is required' }, 400);
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

  const { data: connection } = await supabase
    .from('connections')
    .select('user_a_id, user_b_id')
    .eq('id', body.connectionId)
    .maybeSingle();

  if (!connection || (connection.user_a_id !== user.id && connection.user_b_id !== user.id)) {
    return jsonResponse({ error: 'Not a participant of this connection' }, 403);
  }

  const otherId = connection.user_a_id === user.id ? connection.user_b_id : connection.user_a_id;

  // Caps/pool gating (2026-07-29): free tier's 1/week cap gates the whole
  // feature, checked before even the fast path, since a free user "used"
  // the feature this week regardless of which path serves it (matches the
  // given spec literally). Premium's pool protects real dollar cost only,
  // so it is deliberately NOT checked here, a premium account with an
  // exhausted pool must still get an instant, zero-cost reserved batch if
  // one exists, gating that would repeat the exact "spend for zero
  // deliverable value" bug already caught and fixed once in this codebase
  // (generate-match-suggestions, 2026-07-29). The premium gate is checked
  // later, only immediately before the real Claude call.
  const { data: userRow } = await supabase.from('users').select('is_premium').eq('id', user.id).maybeSingle();
  const isPremiumUser = Boolean(userRow?.is_premium);

  if (!isPremiumUser) {
    const { data: gate } = await supabase.rpc('get_ai_gate_status', {
      p_user_id: user.id,
      p_function_name: 'generate-activity-suggestions',
    });
    if (gate && gate.allowed === false) {
      return blockedResponse(gate);
    }
  }

  // Fast path first: a reserved batch means an instant read, no profile
  // fetch, no Claude call, nothing that could take seconds. This is what
  // makes two out of every three refreshes near-instant instead of
  // repeating the 7 to 17 second live-generation cost every single time.
  const readyBatch = await fetchReadyBatch(supabase, body.connectionId);
  if (readyBatch) {
    await supabase
      .from('activity_suggestion_pool')
      .update({ consumed: true })
      .in('id', readyBatch.map((r) => r.id));
    if (!isPremiumUser) {
      await supabase.rpc('record_ai_usage', { p_user_id: user.id, p_function_name: 'generate-activity-suggestions' });
    }
    return jsonResponse({ suggestions: readyBatch.map(poolRowToSuggestion) });
  }

  // No reserve left (or this connection has never had a batch generated
  // yet), fall through to a real generation pass.
  //
  // The other participant's own profiles row is unreadable here: that
  // table's SELECT RLS is scoped to auth.uid() = user_id only. discovery_
  // profiles is this app's own, deliberate, gender/pause-compatibility-
  // gated view for exactly this: reading a real match's profile fields.
  const [{ data: viewerProfile }, { data: otherProfile }, recentTexts] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, activity_interests, bar_preference, location_lat, location_lng')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('discovery_profiles')
      .select('display_name, activity_interests, bar_preference')
      .eq('user_id', otherId)
      .maybeSingle(),
    fetchRecentSuggestionTexts(supabase, body.connectionId),
  ]);

  const excludeBars =
    viewerProfile?.bar_preference === "I don't drink" || otherProfile?.bar_preference === "I don't drink";
  const otherName = otherProfile?.display_name ?? null;

  const viewerCategories = (viewerProfile?.activity_interests as ActivityInterests | null)?.categories ?? [];
  const otherCategories = (otherProfile?.activity_interests as ActivityInterests | null)?.categories ?? [];
  const { primary, secondary } = pickInterestCategories(viewerCategories, otherCategories, excludeBars);

  // Category 2 still tries a real live event first when a key is
  // configured (none are today, see the file header), keyed to the
  // primary category. If found, it's used as-is for the first (served
  // immediately) set only, the reserve sets still use AI-generated or
  // static content, a real event result isn't something to duplicate
  // across a batch since "the same real event" showing up 3 times would
  // be an odd, repetitive reserve.
  let liveEvent: Suggestion | null = null;
  if (primary && viewerProfile?.location_lat && viewerProfile?.location_lng) {
    const keywordForSearch = primary.key.replace(/_/g, ' ');
    liveEvent = await fetchTicketmasterEvent(viewerProfile.location_lat, viewerProfile.location_lng, keywordForSearch, excludeBars, otherName);
    if (!liveEvent) {
      liveEvent = await fetchEventbriteEvent(viewerProfile.location_lat, viewerProfile.location_lng, keywordForSearch, excludeBars, otherName);
    }
    if (liveEvent) liveEvent.interestNote = interestNoteFor(primary, otherName);
  }

  // Premium pool gate, checked only here, immediately before the one real
  // Claude call this function ever makes. Free tier already passed its own
  // gate above (before the fast path); premium's gate protects real dollar
  // cost specifically, so it only matters once a real generation is about
  // to happen, never for an instant, zero-cost reserved-batch read.
  if (isPremiumUser) {
    const { data: gate } = await supabase.rpc('get_ai_gate_status', {
      p_user_id: user.id,
      p_function_name: 'generate-activity-suggestions',
    });
    if (gate && gate.allowed === false) {
      return blockedResponse(gate);
    }
  }

  const { sets: batches, usage: generationUsage } = await generateVariedSuggestionBatches(
    primary,
    secondary,
    excludeBars,
    otherName,
    recentTexts
  );

  if (isPremiumUser) {
    await supabase.rpc('record_ai_usage', {
      p_user_id: user.id,
      p_function_name: 'generate-activity-suggestions',
      p_cost_usd: sonnetCostUsd(generationUsage),
    });
  } else {
    await supabase.rpc('record_ai_usage', { p_user_id: user.id, p_function_name: 'generate-activity-suggestions' });
  }

  function buildSet(setIndex: number): Suggestion[] {
    const set = batches?.[setIndex];
    return (['low_effort', 'interest_based', 'link_out'] as SuggestionCategory[]).map((category) => {
      if (setIndex === 0 && category === 'interest_based' && liveEvent) return liveEvent;
      const slot = set?.find((r) => r.category === category);
      const chosen = category === 'interest_based' ? primary : category === 'link_out' ? secondary : null;
      if (!slot) return staticFallback(category, chosen, otherName);
      return {
        category,
        label: slot.label,
        description: slot.description,
        isFree: slot.isFree,
        freeAlternative: slot.freeAlternative,
        source: category === 'link_out' ? 'link_out' : 'curated',
        interestNote: category === 'low_effort' ? undefined : interestNoteFor(chosen, otherName),
        message: slot.message,
      };
    });
  }

  const setCount = batches ? Math.max(batches.length, 1) : 1;
  const allSets: Suggestion[][] = [];
  for (let i = 0; i < setCount; i++) allSets.push(buildSet(i));

  const rows = allSets.flatMap((set, setIndex) => {
    const batchId = crypto.randomUUID();
    return set.map((s) => ({
      connection_id: body.connectionId,
      batch_id: batchId,
      category: s.category,
      label: s.label,
      description: s.description,
      message: s.message,
      is_free: s.isFree,
      free_alternative: s.freeAlternative,
      interest_note: s.interestNote ?? null,
      source: s.source,
      // The first set is being served right now, mark it consumed
      // immediately so it also counts as history for the next
      // no-repeat check. The rest are the reserve, left unconsumed.
      consumed: setIndex === 0,
    }));
  });

  // Awaited, not fire-and-forget: the edge runtime can terminate
  // execution shortly after the response is sent, a background insert
  // risks silently never landing, which would both break the no-repeat
  // check (no history logged) and throw away the whole point of this
  // redesign (no reserve left for the next two taps to read instantly).
  // A write failure here still shouldn't fail the whole request, the
  // suggestions being served right now are already computed either way.
  try {
    await supabase.from('activity_suggestion_pool').insert(rows);
  } catch {
    // Non-fatal, see comment above.
  }

  return jsonResponse({ suggestions: allSets[0] });
});
