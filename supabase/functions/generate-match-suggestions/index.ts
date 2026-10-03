// Supabase Edge Function: generate-match-suggestions
//
// Deploy: supabase functions deploy generate-match-suggestions
// (ANTHROPIC_API_KEY is already set as a project secret, from F6.)
//
// F11: returns 3-5 daily AI match suggestions for the calling user, each
// with reasoning grounded in real profile overlap, never invented, plus a
// one-sentence human_detail grounded in the candidate's own
// personal_statement or activity_interests. No photo_url is ever included
// here, "no photo until the user taps to see the full profile" is a
// data-shape decision, not just a UI one, the client fetches photo_url
// separately (via discovery_profiles) only once someone actually opens a
// candidate's full profile.
//
// Deliberately does NOT use the service role key for the normal per-user
// path. This function runs every query as the calling user (their JWT is
// forwarded to a client built with the anon key), so normal RLS applies
// throughout, including the discovery_profiles view's own auth.uid()-based
// mutual-compatibility filter. That view already decides who's a valid
// candidate; this function never needs to re-implement or override that
// check.
//
// Fix 7 (2026-07-16), pre-computation architecture: home.tsx no longer
// calls this function on every page load, it reads match_suggestions
// directly (a plain, instant query) and only calls this function when that
// cache is empty or older than 24 hours. A pg_cron job (schedule_match_
// suggestions_refresh, 20260716000007) instead calls this same function
// every 6 hours in a new BATCH mode, gated by a shared secret header
// (x-batch-secret, matching MATCH_REFRESH_SECRET, the same pattern
// dev-create-session already uses), which iterates every real user and
// regenerates their cache using a service-role client. Batch mode is the
// one place this function does use the service role, a deliberate,
// narrow exception: it can't forward any individual user's JWT since it's
// refreshing everyone at once, and unlike a per-request endpoint it isn't
// reachable by an ordinary client at all, only by the secret-gated cron
// call. Since discovery_profiles' WHERE clause is built around auth.uid(),
// which is null under a service-role connection, batch mode reads
// candidates via the new compatible_candidates_for(user_id) function
// instead, the same gender/pause compatibility check, parameterized.
//
// Rebuilt 2026-07-16 around an explicit weighted scoring model (see
// weightedScore below). Only three hard filters exclude a candidate before
// scoring: gender/pause compatibility (discovery_profiles itself), and a
// basic keyword-based dealbreaker check (dealbreakerConflict). Every other
// field is a scoring weight, never a hard filter, matching the given spec's
// "not excluded, just no bonus" framing throughout.
//
// Real bug found and fixed while verifying this rebuild live: this model
// (claude-sonnet-5) can return more than one content block, a "thinking"
// block ahead of the actual "text" block. The old code read
// content[0].text unconditionally, which silently returned an empty
// string whenever a thinking block came first, so this function fell
// through to its own non-AI fallback every time without ever surfacing an
// error, confirmed live via a temporary diagnostic on
// generate-connection-analysis (identical code shape) that dumped the
// real Anthropic payload. extractText() below finds the first block whose
// type is actually "text" instead of assuming position 0.
//
// Fix #3 (2026-07-21), daily suggestion cap (blueprint Sections 8/9/25,
// locked decision): 2/day free, 5/day premium (users.is_premium).
// generateAndCacheSuggestions no longer deletes and replaces this user's
// whole cache on every call, suggested_date is now the real cap
// boundary, today's rows only ever get added to, never wiped, until the
// calendar date changes. MAX_SUGGESTIONS still bounds a single Claude
// call's batch size, it's no longer the effective per-day limit.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MATCH_REFRESH_SECRET = Deno.env.get('MATCH_REFRESH_SECRET');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = 'claude-sonnet-5';
const MAX_SUGGESTIONS = 5;
// Rolling window, not a calendar day: match_suggestions rows older than
// this are treated as stale and regenerated. This still governs display
// freshness/cache-hit speed only, a deliberate, separate axis from the
// daily cap above (suggested_date), left as Fix 7 designed it; a user
// near a midnight boundary may occasionally see a cached suggestion
// linger briefly into a new calendar day before this window expires,
// a pre-existing, minor timing quirk this fix doesn't change.
// Limen v2: suggestions are weekly, so a batch stays fresh for 7 days.
const CACHE_FRESHNESS_HOURS = 7 * 24;

// Limen v2: suggestions per rolling week, same for everyone.
const SUGGESTIONS_PER_WEEK = 3;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Claude can return multiple content blocks (for example a "thinking"
// block before the real "text" block), the actual answer is not
// guaranteed to be at index 0. Finds the first block that actually is
// text, rather than assuming position.
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

type Candidate = {
  user_id: string;
  display_name: string | null;
  age_band: string | null;
  life_transitions: string[] | null;
  values: string[] | null;
  activity_interests: ActivityInterests | null;
  hangout_people_preference: string | null;
  hangout_type_preference: string[] | null;
  meeting_freq: string | null;
  communication_freq: string | null;
  personal_statement: string | null;
  languages: string[] | null;
  friendship_type: string | null;
  communication_style_openness: string | null;
  location_city: string | null;
  distance_miles: number | null;
};

type Viewer = {
  display_name: string | null;
  life_transitions: string[] | null;
  values: string[] | null;
  activity_interests: ActivityInterests | null;
  hangout_people_preference: string | null;
  hangout_type_preference: string[] | null;
  meeting_freq: string | null;
  communication_freq: string | null;
  personal_statement: string | null;
  dealbreakers: string | null;
  languages: string[] | null;
  friendship_type: string | null;
  communication_style_openness: string | null;
}

function sharedLifeTransitions(viewer: Viewer, candidate: Candidate): string[] {
  const viewerSet = new Set(viewer.life_transitions ?? []);
  return (candidate.life_transitions ?? []).filter((t) => viewerSet.has(t));
}

function sharedValues(viewer: Viewer, candidate: Candidate): string[] {
  const viewerSet = new Set(viewer.values ?? []);
  return (candidate.values ?? []).filter((v) => viewerSet.has(v));
}

function sharedActivityCategories(viewer: Viewer, candidate: Candidate): string[] {
  const viewerSet = new Set(viewer.activity_interests?.categories ?? []);
  return (candidate.activity_interests?.categories ?? []).filter((c) => viewerSet.has(c));
}

// Ordered, small to large / frequent to infrequent, matching
// filter-options.ts's own HANGOUT_PEOPLE and MEETING_FREQ exactly. Deno
// edge functions can't import from src/lib, duplicated here rather than
// shared, kept in sync by hand.
const HANGOUT_PEOPLE_ORDER = ['1-on-1', 'Small group (3-5)', 'Big group (6+)'];
const MEETING_FREQ_ORDER = ['Weekly', 'A few times a week', 'Every 2 weeks', 'Monthly', 'Every few months'];
// hangout_type_preference's selection cap was removed entirely (2026-07-16,
// see filter-options.ts's HANGOUT_TYPES), so the scaling below is now
// against the total number of real options (5), not a per-person
// selection cap that no longer exists.
const TOTAL_HANGOUT_TYPES = 5;

// --- Weighted scoring (0-100 scale, Fix 3's revised model), all nine
// components are additive bonuses, never hard filters. A missing field on
// either side simply contributes 0 for that component, "not excluded,
// just no bonus", exactly as specified. Hard filters (gender, pause,
// radius) all live in discovery_profiles/compatible_candidates_for
// itself, not here, plus the dealbreaker keyword check below.

// 1. Life transitions overlap, 25 points max (was 30, rescaled
// proportionally: 25, 17, 8, 0 keeps the same relative tier shape).
function lifeTransitionsScore(viewer: Viewer, candidate: Candidate): number {
  const n = sharedLifeTransitions(viewer, candidate).length;
  if (n >= 3) return 25;
  if (n === 2) return 17;
  if (n === 1) return 8;
  return 0;
}

// 2. Values overlap, 20 points max (was 25, rescaled: 20, 14, 8, 0). Both
// arrays are preset-only as of 20260716000000 (free-text additions live
// in values_other and are never scored).
function valuesScore(viewer: Viewer, candidate: Candidate): number {
  const n = sharedValues(viewer, candidate).length;
  if (n >= 5) return 20;
  if (n >= 3) return 14;
  if (n >= 1) return 8;
  return 0;
}

// 4. Hangout style compatibility, 10 points max (was 15, split evenly
// 5/5 between people preference and type overlap instead of 8/7).
function hangoutScore(viewer: Viewer, candidate: Candidate): number {
  let score = 0;
  if (viewer.hangout_people_preference && candidate.hangout_people_preference) {
    const vi = HANGOUT_PEOPLE_ORDER.indexOf(viewer.hangout_people_preference);
    const ci = HANGOUT_PEOPLE_ORDER.indexOf(candidate.hangout_people_preference);
    if (vi >= 0 && ci >= 0) {
      const dist = Math.abs(vi - ci);
      score += dist === 0 ? 5 : dist === 1 ? 2.5 : 0;
    }
  }
  const viewerTypes = new Set(viewer.hangout_type_preference ?? []);
  const sharedTypes = (candidate.hangout_type_preference ?? []).filter((t) => viewerTypes.has(t));
  score += Math.min(5, sharedTypes.length * (5 / TOTAL_HANGOUT_TYPES));
  return score;
}

// 5 (new). Friendship type compatibility, 10 points max: exact match = 10,
// "compatible" (not identical) pairing = 5, mismatched = 0 but never
// excluded. Compatibility groups are a judgment call, not given
// explicitly: "Open to whatever forms naturally" is flexible enough to
// pair reasonably with anything; "Deep 1-on-1 connection" and "Someone to
// navigate this life stage with" both point at a close, ongoing individual
// connection; "Activity partner" and "A social circle" are both lower-
// commitment/more group-oriented. Worth revisiting if it feels off in
// practice, same caveat this app already applies to its other hand-picked
// heuristics.
const FRIENDSHIP_TYPE_COMPATIBLE_GROUPS: string[][] = [
  ['Deep 1-on-1 connection', 'Someone to navigate this life stage with'],
  ['Activity partner', 'A social circle'],
];

function friendshipTypeScore(viewer: Viewer, candidate: Candidate): number {
  if (!viewer.friendship_type || !candidate.friendship_type) return 0;
  if (viewer.friendship_type === candidate.friendship_type) return 10;
  if (viewer.friendship_type === 'Open to whatever forms naturally' || candidate.friendship_type === 'Open to whatever forms naturally') {
    return 5;
  }
  const compatible = FRIENDSHIP_TYPE_COMPATIBLE_GROUPS.some(
    (group) => group.includes(viewer.friendship_type!) && group.includes(candidate.friendship_type!)
  );
  return compatible ? 5 : 0;
}

// 6. Meeting frequency compatibility, 8 points max (was 10, rescaled:
// 8, 5, 2, 0). Ordered list, same = full, one step apart = partial, two
// steps = small, three or more steps apart = 0 (flagged honestly in the
// reasoning narrative as "worth discussing" rather than hidden).
function meetingFreqDistance(viewer: Viewer, candidate: Candidate): number | null {
  if (!viewer.meeting_freq || !candidate.meeting_freq) return null;
  const vi = MEETING_FREQ_ORDER.indexOf(viewer.meeting_freq);
  const ci = MEETING_FREQ_ORDER.indexOf(candidate.meeting_freq);
  if (vi < 0 || ci < 0) return null;
  return Math.abs(vi - ci);
}

function meetingFreqScore(viewer: Viewer, candidate: Candidate): number {
  const dist = meetingFreqDistance(viewer, candidate);
  if (dist === null) return 0;
  if (dist === 0) return 8;
  if (dist === 1) return 5;
  if (dist === 2) return 2;
  return 0;
}

// 7 (new). Language overlap, 5 points max: a binary bonus, not scaled by
// how many languages overlap, sharing even one real language to connect
// in is the actual signal. "Other" is excluded from counting as a real
// match on its own (two people both picking "Other" doesn't mean they
// share a language), languages_other free text is never scored, same
// "other fields are display only" rule as everywhere else in this app.
function languageScore(viewer: Viewer, candidate: Candidate): number {
  const viewerSet = new Set((viewer.languages ?? []).filter((l) => l !== 'Other'));
  const shared = (candidate.languages ?? []).some((l) => l !== 'Other' && viewerSet.has(l));
  return shared ? 5 : 0;
}

// 8 (new). Communication style compatibility, 5 points max. Was a two-
// dimension (expression + openness) graduated 5/2/0 tier; expression was
// removed entirely (2026-07-31, duplicated Big Five's own disagreement/
// conflict-style question) and openness never depended on it existing,
// confirmed before removing it, so this collapses to a plain binary
// match on the one remaining dimension. Same 5-pt bucket weight
// preserved, no rebalancing needed elsewhere in the 100-point model.
function communicationStyleScore(viewer: Viewer, candidate: Candidate): number {
  const opennessMatch =
    Boolean(viewer.communication_style_openness) &&
    viewer.communication_style_openness === candidate.communication_style_openness;
  return opennessMatch ? 5 : 0;
}

// 9. Activity interests overlap, 2 points max (was 5, rescaled: 2, 1, 0).
function activityBonusScore(viewer: Viewer, candidate: Candidate): number {
  const n = sharedActivityCategories(viewer, candidate).length;
  if (n >= 2) return 2;
  if (n === 1) return 1;
  return 0;
}

// 3. Big Five proximity, 15 points max, computed via the
// big_five_proximity_score RPC (rescaled to 5/5/5 in 20260716000010)
// rather than reading raw scores here. Raw big_five_scores is
// deliberately never exposed through discovery_profiles or any other
// broadly-queryable view, "we'll never show you a score" is a real
// privacy boundary, not just a UI choice, so this function only ever
// receives the already-computed 0-15 bonus, never the underlying trait
// numbers.
async function bigFiveScore(
  supabase: ReturnType<typeof createClient>,
  candidateId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('big_five_proximity_score', { p_candidate_id: candidateId });
  if (error || typeof data !== 'number') return 0;
  return data;
}

type ScoreBreakdown = {
  total: number;
  lifeTransitions: number;
  values: number;
  bigFive: number;
  hangout: number;
  friendshipType: number;
  meetingFreq: number;
  language: number;
  communicationStyle: number;
  activities: number;
};

async function weightedScore(
  supabase: ReturnType<typeof createClient>,
  viewer: Viewer,
  candidate: Candidate
): Promise<ScoreBreakdown> {
  const lifeTransitions = lifeTransitionsScore(viewer, candidate);
  const values = valuesScore(viewer, candidate);
  const bigFive = await bigFiveScore(supabase, candidate.user_id);
  const hangout = hangoutScore(viewer, candidate);
  const friendshipType = friendshipTypeScore(viewer, candidate);
  const meetingFreq = meetingFreqScore(viewer, candidate);
  const language = languageScore(viewer, candidate);
  const communicationStyle = communicationStyleScore(viewer, candidate);
  const activities = activityBonusScore(viewer, candidate);
  return {
    total: lifeTransitions + values + bigFive + hangout + friendshipType + meetingFreq + language + communicationStyle + activities,
    lifeTransitions,
    values,
    bigFive,
    hangout,
    friendshipType,
    meetingFreq,
    language,
    communicationStyle,
    activities,
  };
}

// --- Dealbreaker hard filter. Basic keyword check, as specified, not a
// semantic understanding of the text: tokenizes the viewer's own
// dealbreakers text, drops very short words and a small stopword list to
// cut down on false positives, then checks whether any remaining word
// appears as a whole word anywhere in the candidate's own searchable
// profile text. A real limitation of "basic": a dealbreaker like "no
// smoking" and a candidate profile mentioning "non-smoker" would both
// contain "smoking"/"smoker" as different word forms and might not match,
// while a coincidental unrelated use of the same word could over-match.
// Flagged here rather than silently pretending this is more precise than
// it is.
// Caught live during verification, not just anticipated in the abstract:
// Maria Santos's real dealbreaker text ("Not looking for anything
// romantic, just real friendship.") matched the word "looking" against
// Elena Torres's unrelated personal_statement ("...looking for people who
// understand..."), silently excluding a genuinely compatible candidate.
// "looking"/"wanting"/"seeking"/"trying" are common phrase-starters in
// dealbreaker text ("not looking for X", "not wanting X"), the OBJECT of
// the sentence is the real signal, not the verb, so these are added
// alongside the more generic stopwords already here.
const DEALBREAKER_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'without', 'someone', 'anyone',
  'people', 'person', 'who', 'really', 'just', 'want', 'need', 'would',
  'like', 'dislike', 'prefer', 'hard', 'deal', 'breaker', 'breakers',
  'dont', 'cant', 'wont', 'isnt', 'not', 'never', 'have', 'has', 'been',
  'being', 'from', 'into', 'about', 'their', 'them', 'they', 'when',
  'where', 'what', 'much', 'very', 'more', 'less', 'also', 'than',
  'looking', 'wanting', 'seeking', 'trying', 'feeling', 'going',
  'getting', 'living', 'working', 'dating', 'anything', 'something',
]);

function dealbreakerKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !DEALBREAKER_STOPWORDS.has(w));
}

function candidateSearchableText(candidate: Candidate): string {
  const parts: string[] = [
    ...(candidate.values ?? []),
    ...(candidate.life_transitions ?? []),
    ...(candidate.activity_interests?.categories ?? []),
    candidate.activity_interests?.other ?? '',
    candidate.personal_statement ?? '',
    candidate.hangout_people_preference ?? '',
    ...(candidate.hangout_type_preference ?? []),
  ];
  return parts.join(' ').toLowerCase();
}

function dealbreakerConflict(viewer: Viewer, candidate: Candidate): boolean {
  if (!viewer.dealbreakers || !viewer.dealbreakers.trim()) return false;
  const keywords = dealbreakerKeywords(viewer.dealbreakers);
  if (keywords.length === 0) return false;
  const haystack = candidateSearchableText(candidate);
  return keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(haystack));
}

// Non-AI safety net, follows the same 5-part order and the same
// only-claim-what's-actually-shared rule the AI prompt below is given,
// grounded only in real overlaps and real differences between the two
// actual profiles, never invents anything.
function fallbackReasoning(viewer: Viewer, candidate: Candidate): string {
  const sentences: string[] = [];
  const candidateName = candidate.display_name ?? 'They';

  const transitions = sharedLifeTransitions(viewer, candidate);
  if (transitions.length > 0) {
    sentences.push(`You're both navigating ${transitions.map((t) => t.toLowerCase()).join(' and ')} right now.`);
  }

  const sharedCategories = sharedActivityCategories(viewer, candidate);
  if (sharedCategories.length > 0) {
    const labels = sharedCategories.slice(0, 2).map((c) => c.replace(/_/g, ' '));
    const detail = candidate.activity_interests?.details?.[sharedCategories[0]];
    const detailValue = detail ? Object.values(detail)[0] : undefined;
    const detailText = Array.isArray(detailValue) ? detailValue.join(', ') : detailValue;
    sentences.push(
      detailText
        ? `You both selected ${labels.join(' and ')}, and ${candidateName} listed ${detailText}.`
        : `You both selected ${labels.join(' and ')}.`
    );
  } else {
    sentences.push(
      'You have different activity interests, but compatible life stage and values can still make for a strong connection.'
    );
  }

  const commonValues = sharedValues(viewer, candidate);
  if (commonValues.length > 0) {
    sentences.push(`You both value ${commonValues.slice(0, 2).join(' and ').toLowerCase()}.`);
  }

  const rhythmMatches: string[] = [];
  if (viewer.meeting_freq && viewer.meeting_freq === candidate.meeting_freq) {
    rhythmMatches.push(`you both tend to want to meet up ${candidate.meeting_freq.toLowerCase()}`);
  }
  if (
    viewer.hangout_people_preference &&
    viewer.hangout_people_preference === candidate.hangout_people_preference
  ) {
    rhythmMatches.push(`you both prefer ${candidate.hangout_people_preference.toLowerCase()} hangouts`);
  }
  if (rhythmMatches.length > 0) {
    sentences.push(`Your rhythms line up too, ${rhythmMatches.join(', and ')}.`);
  }

  // "Worth talking through" is reserved for a real, significant
  // divergence, not any difference at all, meeting_freq specifically
  // three or more steps apart (the zero-point tier in meetingFreqScore),
  // matching the scoring model's own "not excluded, just flagged" rule
  // rather than surfacing friction for a merely one-step difference that
  // still earns a real partial score.
  const meetingDist = meetingFreqDistance(viewer, candidate);
  if (meetingDist !== null && meetingDist >= 3) {
    sentences.push(
      `${candidateName} tends to want to meet up ${candidate.meeting_freq!.toLowerCase()}, a meaningfully different rhythm than yours, worth discussing if you connect.`
    );
  } else if (
    viewer.communication_freq &&
    candidate.communication_freq &&
    viewer.communication_freq !== candidate.communication_freq
  ) {
    sentences.push(
      `${candidateName} tends to message ${candidate.communication_freq.toLowerCase()}, worth talking through if you connect.`
    );
  }

  return sentences.join(' ');
}

// Non-AI safety net for the human_detail field. Never paraphrases (person
// conversion like "I left..." to "She left..." needs real language
// understanding to stay grammatical and accurate, not a string transform),
// so it either quotes the candidate's own words directly or formats a real
// activity_interests entry. Grounded only in data that's actually present.
function fallbackHumanDetail(candidate: Candidate): string | null {
  if (candidate.personal_statement) {
    const firstSentence = candidate.personal_statement.split(/(?<=[.!?])\s+/)[0];
    return `In their own words: "${firstSentence}"`;
  }
  const firstCategory = candidate.activity_interests?.categories?.[0];
  if (firstCategory) {
    const detail = candidate.activity_interests?.details?.[firstCategory];
    const firstValue = detail ? Object.values(detail)[0] : undefined;
    const valueText = Array.isArray(firstValue) ? firstValue.join(', ') : firstValue;
    const categoryLabel = firstCategory.replace(/_/g, ' ');
    return valueText ? `Into ${categoryLabel}, especially ${valueText}.` : `Into ${categoryLabel}.`;
  }
  return null;
}

function buildPrompt(viewer: Viewer, candidates: Candidate[]): string {
  const viewerSummary = JSON.stringify({
    life_transitions: viewer.life_transitions,
    values: viewer.values,
    activity_interests: viewer.activity_interests,
    hangout_people_preference: viewer.hangout_people_preference,
    hangout_type_preference: viewer.hangout_type_preference,
    meeting_freq: viewer.meeting_freq,
    communication_freq: viewer.communication_freq,
    personal_statement: viewer.personal_statement,
  });

  const candidateSummaries = candidates.map((c) =>
    JSON.stringify({
      candidate_id: c.user_id,
      display_name: c.display_name,
      life_transitions: c.life_transitions,
      values: c.values,
      activity_interests: c.activity_interests,
      hangout_people_preference: c.hangout_people_preference,
      hangout_type_preference: c.hangout_type_preference,
      meeting_freq: c.meeting_freq,
      communication_freq: c.communication_freq,
      personal_statement: c.personal_statement,
    })
  );

  return `You are writing two things for each candidate on a friendship-matching app for adults navigating life transitions (divorce, relocation, bereavement, career change, empty nesting, and others). Not a dating app, no romantic framing ever. Someone can be navigating more than one life transition at once, life_transitions is an array on both sides, with no upper limit.

The viewer's profile:
${viewerSummary}

Candidates, one entry per candidate:
${candidateSummaries.join('\n')}

For each candidate, write two fields:

1. "reasoning": written in this exact order, skipping any part that has nothing real to say:
   First, shared life transitions, if the viewer's and candidate's life_transitions arrays share any value, name it specifically ("You're both navigating a career change", not "you have similar life experiences").
   Second, shared activity interests with specific details, if activity_interests.categories overlap, name the specific shared category, and if either person's nested detail for that category is available, name it too (for example "You both enjoy pickleball and listed yourselves as intermediate level" or "You both selected craft beer and cocktails"). If there is zero overlap in activity_interests.categories between the two, say so honestly instead of forcing a claim: "You have different activity interests, but compatible life stage and values can still make for a strong connection."
   Third, compatible values, named specifically, only if that exact value string appears in both people's values arrays. Never write "you both value X" unless X is actually present in both arrays.
   Fourth, rhythm compatibility (hangout style, meeting frequency), only if the data actually shows a match.
   Fifth, worth talking through, one honest sentence naming a real, significant friction point (a meaningfully different meeting frequency, not just a one-step difference) grounded in an actual difference in the data, written the way a caring, direct friend would. If there is no real significant mismatch to name, omit this part rather than inventing one.

2. "human_detail": one sentence, third person, about the candidate specifically, giving the viewer a real human sense of who this person is. Draw it directly from the candidate's personal_statement or activity_interests, using only what they actually said or selected. Never invent a fact, feeling, or detail that isn't in their data. Ground it in personal_statement if one is present; otherwise ground it in a specific activity_interests detail.

Strict rules, reject any temptation to do otherwise:
- Require at least one concrete shared data point before making any positive compatibility claim. A generic sentence that could apply to any two people ("you both value purpose", "you share an interest in connection") is not acceptable unless that exact word or category is verifiably present in both profiles above.
- Never state a positive claim when zero genuine overlap exists for that category, use the honest statement given above instead.
- "reasoning" is second person, addressed to the viewer ("You both...", "You'll likely connect over..."). "human_detail" is third person, about the candidate ("She left...", "He's the guy who...").
- Warm, specific, direct. Not clinical, not a dating-app bio.
- Never use em dashes. Use commas, periods, or restructure the sentence instead.
- Never mention personality trait names, scores, or psychological labels, this data was never given to you above and must never be guessed at or referenced.

Respond with ONLY a JSON array, no prose before or after, no markdown code fences. Each element: {"candidate_id": "...", "reasoning": "...", "human_detail": "..."}`;
}

type SuggestionResult = {
  userId: string;
  displayName: string | null;
  ageBand: string | null;
  lifeTransitions: string[];
  reasoning: string;
  humanDetail: string | null;
  locationCity: string | null;
  distanceMiles: number | null;
};

// Fix #3, capacity system: rewritten from "delete this user's whole
// cache then insert up to MAX_SUGGESTIONS new ones" to "top up today's
// cache with at most dailyCap distinct candidates total, ever, for this
// calendar date". The old delete-then-insert approach could never
// support a real daily cap, both the client-triggered fallback and the
// 6-hourly batch cron called it repeatedly and it would happily hand
// out a fresh MAX_SUGGESTIONS=5 candidates every single time, blowing
// past 2/day for a free user four times a day. suggested_date (already
// on the table, previously reduced to just metadata) is now the real
// cap boundary; rows already inserted today are never deleted or
// replaced by this function, only ever added to, up to the cap.
async function generateAndCacheSuggestions(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  viewer: Viewer,
  candidatePool: Candidate[],
  alreadySeen: Set<string>,
  dailyCap: number
): Promise<SuggestionResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  // Limen v2 (2026-10-03): the cap window is now a rolling 7 days, not a
  // calendar day. "dailyCap" keeps its parameter name for a smaller diff,
  // but it's the weekly cap (SUGGESTIONS_PER_WEEK) everywhere it's passed.
  const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: todayRows } = await supabase
    .from('match_suggestions')
    .select('candidate_id, reasoning, human_detail')
    .eq('user_id', userId)
    .gte('suggested_date', weekStart);
  const existingToday = (todayRows ?? []) as { candidate_id: string; reasoning: string; human_detail: string | null }[];
  const todaySuggestedIds = new Set(existingToday.map((r) => r.candidate_id));
  const remaining = Math.max(0, dailyCap - todaySuggestedIds.size);

  let newRows: { candidate_id: string; reasoning: string; human_detail: string | null }[] = [];

  if (remaining > 0) {
    const available = candidatePool.filter(
      (c) => !alreadySeen.has(c.user_id) && !todaySuggestedIds.has(c.user_id) && !dealbreakerConflict(viewer, c)
    );

    if (available.length > 0) {
      // Weighted score for every available candidate, computed in
      // parallel (each call makes one big_five_proximity_score RPC
      // round trip).
      const scored = await Promise.all(
        available.map(async (c) => ({ candidate: c, score: await weightedScore(supabase, viewer, c) }))
      );
      scored.sort((a, b) => b.score.total - a.score.total);
      // Capped by whatever's actually left of today's allowance, not the
      // flat MAX_SUGGESTIONS constant, that constant now only bounds a
      // single Claude call's batch size (kept below for that reason).
      const selected = scored.slice(0, Math.min(remaining, MAX_SUGGESTIONS, scored.length)).map((s) => s.candidate);

      const reasoningByCandidate = new Map<string, string>();
      const humanDetailByCandidate = new Map<string, string>();

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
              // Thinking tokens count against this budget too (confirmed
              // live: a single-candidate analysis on
              // generate-connection-analysis used 429 thinking tokens
              // before any real text), and this call covers up to 5
              // candidates at once, raised well past the original 1200
              // to leave real headroom.
              max_tokens: 2500,
              messages: [{ role: 'user', content: buildPrompt(viewer, selected) }],
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const raw = extractText(data);
            const jsonText = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(jsonText) as {
              candidate_id: string;
              reasoning: string;
              human_detail?: string;
            }[];
            for (const entry of parsed) {
              if (entry?.candidate_id && entry?.reasoning) {
                reasoningByCandidate.set(entry.candidate_id, entry.reasoning.replace(/\s*—\s*/g, ', '));
              }
              if (entry?.candidate_id && entry?.human_detail) {
                humanDetailByCandidate.set(entry.candidate_id, entry.human_detail.replace(/\s*—\s*/g, ', '));
              }
            }
          }
        } catch {
          // Fall through to the non-AI fallback below for any candidate
          // Claude didn't return usable reasoning for.
        }
      }

      newRows = selected.map((c) => ({
        candidate_id: c.user_id,
        reasoning: reasoningByCandidate.get(c.user_id) ?? fallbackReasoning(viewer, c),
        human_detail: humanDetailByCandidate.get(c.user_id) ?? fallbackHumanDetail(c),
      }));

      if (newRows.length > 0) {
        await supabase.from('match_suggestions').upsert(
          newRows.map((r) => ({ user_id: userId, candidate_id: r.candidate_id, reasoning: r.reasoning, human_detail: r.human_detail, suggested_date: today })),
          { onConflict: 'user_id,candidate_id,suggested_date', ignoreDuplicates: true }
        );
      }
    }
  }

  // What to actually show: everything suggested today (existing rows
  // this function didn't touch, plus whatever was just added), minus
  // anyone the viewer has since passed on. Previously-seen/unactioned
  // suggestions from earlier today are returned here too, exactly as
  // before, they were never deleted, so re-showing them costs nothing
  // against the cap.
  const reasoningById = new Map<string, { reasoning: string; human_detail: string | null }>();
  for (const r of existingToday) reasoningById.set(r.candidate_id, r);
  for (const r of newRows) reasoningById.set(r.candidate_id, r);

  const visibleIds = Array.from(reasoningById.keys()).filter((id) => !alreadySeen.has(id));
  if (visibleIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('discovery_profiles')
    .select('user_id, display_name, age_band, life_transitions, location_city, distance_miles')
    .in('user_id', visibleIds);

  return visibleIds
    .map((id) => {
      const profile = profiles?.find((p) => p.user_id === id);
      const r = reasoningById.get(id)!;
      if (!profile) return null;
      return {
        userId: id,
        displayName: profile.display_name,
        ageBand: profile.age_band,
        lifeTransitions: profile.life_transitions ?? [],
        reasoning: r.reasoning,
        humanDetail: r.human_detail,
        locationCity: profile.location_city,
        distanceMiles: profile.distance_miles,
      };
    })
    .filter((s): s is SuggestionResult => s !== null);
}

const EMPTY_VIEWER: Viewer = {
  display_name: null,
  life_transitions: null,
  values: null,
  activity_interests: null,
  hangout_people_preference: null,
  hangout_type_preference: null,
  meeting_freq: null,
  communication_freq: null,
  personal_statement: null,
  dealbreakers: null,
  languages: null,
  friendship_type: null,
  communication_style_openness: null,
};

// Batch mode (Fix 7): called only by the pg_cron-driven refresh, never by
// a client. Iterates every real user and regenerates their cache with a
// service-role client, since there's no individual user JWT to forward
// when refreshing everyone at once. Deliberately the one place in this
// function that uses the service role, gated behind MATCH_REFRESH_SECRET,
// not reachable with just the anon key the way every other path here is.
// Processed in parallel across users (each user's own generation is still
// sequential internally: fetch, then score, then one Claude call). A
// sequential for-loop here, one user fully finished before the next
// starts, was tested live and took over two minutes for just 10 users,
// real risk of pg_net's own response timeout (or the platform's request
// lifecycle) cutting the invocation off partway through, leaving a
// partial refresh every 6 hours with no clear signal anything was
// incomplete. Parallelizing brings total wall-clock time down to roughly
// one user's worth of latency regardless of how many users there are, an
// acceptable tradeoff at this project's real scale (10 real accounts);
// worth revisiting (chunked concurrency) if the user base grows enough
// that firing every user's Claude call at once becomes a rate-limit
// concern.
//
// 2026-07-28: scoped to users active in the last 7 days
// (batch_refresh_eligible_users, joined against auth.users.last_sign_in_at,
// the existing GoTrue-managed signal, no new tracking added). Safe
// because home.tsx's on-demand fallback is fully independent of this
// cron, confirmed live: it reads match_suggestions directly and only
// calls this function's normal per-user path when the cache is empty or
// stale, with no dependency on the cron ever having run for that user. A
// user excluded here simply gets a normal-latency real generation the
// next time they open Discover instead of an instant cached one, the
// same fallback that already covers a brand-new user before their
// first-ever cron cycle.
async function runBatchRefresh(): Promise<{ usersProcessed: number }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: users } = await supabase.rpc('batch_refresh_eligible_users', { p_days: 7 });

  const results = await Promise.all(
    (users ?? []).map(async (u) => {
      const [{ data: viewerRows }, { data: candidatePool }, { data: existingConnections }] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'display_name, life_transitions, values, activity_interests, hangout_people_preference, hangout_type_preference, meeting_freq, communication_freq, personal_statement, dealbreakers, languages, friendship_type, communication_style_openness'
          )
          .eq('user_id', u.id)
          .maybeSingle(),
        supabase.rpc('compatible_candidates_for', { p_user_id: u.id }),
        supabase.from('connections').select('user_b_id').eq('user_a_id', u.id).eq('status', 'passed'),
      ]);

      // No profile yet (still mid-onboarding) has nothing to score
      // against, skip rather than generate against an empty viewer.
      if (!viewerRows) return false;

      const viewer: Viewer = viewerRows;
      const alreadySeen = new Set((existingConnections ?? []).map((c) => c.user_b_id));
      // Limen v2: one flat weekly cap for everyone, never sold.
      const dailyCap = SUGGESTIONS_PER_WEEK;
      await generateAndCacheSuggestions(supabase, u.id, viewer, (candidatePool ?? []) as Candidate[], alreadySeen, dailyCap);
      return true;
    })
  );

  return { usersProcessed: results.filter(Boolean).length };
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

  // Batch mode, checked before the normal per-user auth path: only the
  // pg_cron job knows this secret, an ordinary client request (which only
  // ever has the anon key and a user JWT) can never satisfy this check.
  const batchSecret = req.headers.get('x-batch-secret');
  if (MATCH_REFRESH_SECRET && batchSecret === MATCH_REFRESH_SECRET) {
    const result = await runBatchRefresh();
    return new Response(JSON.stringify({ batch: true, ...result }), {
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

  // Fetched once, up front, and reused by both the cache check below and
  // the fresh-generation path further down. Scoped to status = 'passed'
  // only, the one status that actually means "don't suggest this person
  // again", matching browse.tsx's own filter. A prior version of this
  // function excluded every row regardless of status (saved, pending,
  // anything), which meant a real account that had saved or messaged its
  // entire compatible pool got zero suggestions forever, fixed earlier
  // this project.
  const { data: existingConnections } = await supabase
    .from('connections')
    .select('user_b_id')
    .eq('user_a_id', user.id)
    .eq('status', 'passed');
  const alreadySeen = new Set((existingConnections ?? []).map((c) => c.user_b_id));

  // Fix 7: freshness is now a rolling window (created_at), not a calendar
  // day (suggested_date). In practice this path is now rarely hit at all,
  // home.tsx reads match_suggestions directly for the fast case and only
  // calls this function when its own freshness check already came back
  // empty, this is mostly a safety net for a genuinely cold cache.
  const freshCutoff = new Date(Date.now() - CACHE_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const { data: cachedAll } = await supabase
    .from('match_suggestions')
    .select('candidate_id, reasoning, human_detail')
    .eq('user_id', user.id)
    .gte('created_at', freshCutoff);

  const cached = (cachedAll ?? []).filter((row) => !alreadySeen.has(row.candidate_id));

  if (cached.length > 0) {
    const candidateIds = cached.map((r) => r.candidate_id);
    const { data: candidateProfiles } = await supabase
      .from('discovery_profiles')
      .select('user_id, display_name, age_band, life_transitions, location_city, distance_miles')
      .in('user_id', candidateIds);

    const validCached = cached
      .map((row) => {
        const profile = candidateProfiles?.find((p) => p.user_id === row.candidate_id);
        if (!profile) return null;
        return {
          userId: row.candidate_id,
          displayName: profile.display_name,
          ageBand: profile.age_band,
          lifeTransitions: profile.life_transitions ?? [],
          reasoning: row.reasoning,
          humanDetail: row.human_detail ?? null,
          locationCity: profile.location_city,
          distanceMiles: profile.distance_miles,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (validCached.length > 0) {
      return new Response(JSON.stringify({ suggestions: validCached }), {
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      });
    }
  }

  const { data: viewerRows } = await supabase
    .from('profiles')
    .select(
      'display_name, life_transitions, values, activity_interests, hangout_people_preference, hangout_type_preference, meeting_freq, communication_freq, personal_statement, dealbreakers, languages, friendship_type, communication_style_openness'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  const viewer: Viewer = viewerRows ?? EMPTY_VIEWER;

  const { data: candidatePool } = await supabase
    .from('discovery_profiles')
    .select(
      'user_id, display_name, age_band, life_transitions, values, activity_interests, hangout_people_preference, hangout_type_preference, meeting_freq, communication_freq, personal_statement, languages, friendship_type, communication_style_openness, location_city, distance_miles'
    );

  // Limen v2 (2026-10-03): one flat weekly cap for everyone
  // (SUGGESTIONS_PER_WEEK). No Premium increase and no AI credits: more
  // options lowers satisfaction and commitment (D'Angelo & Toma 2017), so
  // capacity is never sold. See docs/LIMEN_V2_DECISIONS.md.
  const dailyCap = SUGGESTIONS_PER_WEEK;
  const weekStart = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: weekRows } = await supabase
    .from('match_suggestions')
    .select('candidate_id')
    .eq('user_id', user.id)
    .gte('suggested_date', weekStart);
  const atDailyCap = (weekRows ?? []).length >= dailyCap;
  const effectiveCap = dailyCap;

  const suggestions = await generateAndCacheSuggestions(
    supabase,
    user.id,
    viewer,
    (candidatePool ?? []) as Candidate[],
    alreadySeen,
    effectiveCap
  );

  // capReached: true is the real, new signal the client didn't have
  // before (confirmed absent in discovery, the cache-first architecture
  // previously just silently served fewer/cached suggestions with no
  // explicit blocked state), what the client's "buy credits" prompt is
  // shown against. Only true when genuinely blocked with zero credits
  // left to spend, never true just because today's cap exists.
  const capReached = atDailyCap;

  return new Response(JSON.stringify({ suggestions, capReached, usedCredit: false, aiCredits: 0 }), {
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
});
