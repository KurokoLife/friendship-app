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
// 2026-10-10: one new person a day, at most 3 waiting (see addTodaysPerson).

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
  friendship_types?: string[] | null;
  communication_style_openness: string | null;
  location_city: string | null;
  distance_miles: number | null;
  // From compatible_candidates_for only (2026-10-04). Hidden life
  // transitions still score, but are never named in suggestion text.
  show_life_transitions?: boolean | null;
  interested_in_viewer?: boolean | null;
  ghosting_penalized?: boolean | null;
};

// What the viewer is allowed to see of a candidate's life transitions.
function visibleTransitions(candidate: Candidate): string[] {
  return candidate.show_life_transitions === false ? [] : candidate.life_transitions ?? [];
}

function forDisplay(candidate: Candidate): Candidate {
  return { ...candidate, life_transitions: visibleTransitions(candidate) };
}

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
  friendship_types?: string[] | null;
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
// 2026-10-04: 30 points max (was 25). Personality similarity no longer
// scores (docs/DECISIONS.md section 2); its 15 points moved here (+5),
// to values (+5) and to meeting rhythm (+5).
function lifeTransitionsScore(viewer: Viewer, candidate: Candidate): number {
  const n = sharedLifeTransitions(viewer, candidate).length;
  if (n >= 3) return 30;
  if (n === 2) return 20;
  if (n === 1) return 10;
  return 0;
}

// 2. Values overlap, 20 points max (was 25, rescaled: 20, 14, 8, 0). Both
// arrays are preset-only as of 20260716000000 (free-text additions live
// in values_other and are never scored).
function valuesScore(viewer: Viewer, candidate: Candidate): number {
  // 2026-10-04: 25 points max (was 20). Values are now capped at 5 per
  // person, so 3+ shared is a strong signal.
  const n = sharedValues(viewer, candidate).length;
  if (n >= 3) return 25;
  if (n === 2) return 17;
  if (n === 1) return 10;
  return 0;
}

// 4. Hangout style compatibility, 10 points max, from shared hangout
// types only. 2026-10-05: the group-size question (1-on-1 / small / big
// group) was removed. Limen introduces one person at a time and first
// meetups are one on one, so group size is the premise, not a preference.
function hangoutScore(viewer: Viewer, candidate: Candidate): number {
  const viewerTypes = new Set(viewer.hangout_type_preference ?? []);
  const sharedTypes = (candidate.hangout_type_preference ?? []).filter((t) => viewerTypes.has(t));
  return Math.min(10, sharedTypes.length * (10 / TOTAL_HANGOUT_TYPES) * 2);
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
// 2026-10-05: people pick up to 2 friendship types (friendship_types).
// "A social circle" was removed (Limen is one person at a time). Older
// profiles only have the single friendship_type, used as a fallback.
const FRIENDSHIP_TYPE_COMPATIBLE_GROUPS: string[][] = [
  ['Deep 1-on-1 connection', 'Someone to navigate this life stage with'],
];
const OPEN_FRIENDSHIP_TYPE = 'Open to whatever forms naturally';

function friendshipTypesOf(person: { friendship_type: string | null; friendship_types?: string[] | null }): string[] {
  if (person.friendship_types && person.friendship_types.length > 0) return person.friendship_types;
  return person.friendship_type ? [person.friendship_type] : [];
}

function friendshipTypeScore(viewer: Viewer, candidate: Candidate): number {
  const mine = friendshipTypesOf(viewer);
  const theirs = friendshipTypesOf(candidate);
  if (mine.length === 0 || theirs.length === 0) return 0;
  if (mine.some((t) => theirs.includes(t))) return 10;
  if (mine.includes(OPEN_FRIENDSHIP_TYPE) || theirs.includes(OPEN_FRIENDSHIP_TYPE)) return 5;
  const compatible = FRIENDSHIP_TYPE_COMPATIBLE_GROUPS.some(
    (group) => mine.some((t) => group.includes(t)) && theirs.some((t) => group.includes(t))
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
  // 2026-10-04: 13 points max (was 8).
  if (dist === null) return 0;
  if (dist === 0) return 13;
  if (dist === 1) return 8;
  if (dist === 2) return 3;
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
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
  // deno-lint-ignore no-explicit-any
  _supabase: any,
  viewer: Viewer,
  candidate: Candidate
): Promise<ScoreBreakdown> {
  // 2026-10-18 (founder): meeting pace 40, interests 40, friendship type 20.
  // "What brings you here" is now free text (never read or scored), values,
  // hangout style and opening up are no longer asked, and a shared language
  // is a requirement (compatible_candidates_for), not points. The old parts
  // stay in the breakdown as 0 so its shape is stable.
  const dist = meetingFreqDistance(viewer, candidate);
  const meetingFreq = dist === null ? 0 : dist === 0 ? 40 : dist === 1 ? 25 : dist === 2 ? 10 : 0;
  const sharedActs = sharedActivityCategories(viewer, candidate).length;
  const activities = sharedActs >= 3 ? 40 : sharedActs === 2 ? 30 : sharedActs === 1 ? 18 : 0;
  const friendshipType = friendshipTypeScore(viewer, candidate) * 2;
  return {
    total: meetingFreq + activities + friendshipType,
    lifeTransitions: 0,
    values: 0,
    bigFive: 0,
    hangout: 0,
    friendshipType,
    meetingFreq,
    language: 0,
    communicationStyle: 0,
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

// 2026-10-10: one new person a day (docs/DECISIONS.md section 4).
// The database decides whether someone gets a new person today and who
// can be picked (discover_next_candidates: nobody you've had a chat with,
// nobody with 3 active chats, nobody you passed on, saved or said
// Interested to, nobody shown in the last 21 days, and nothing while you
// have 3 active chats yourself). This function only ranks those people,
// writes the short "why" for the top one, and adds them (discover_add,
// which checks again). Discover itself reads get_discover().
const VIEWER_COLUMNS =
  'display_name, life_transitions, values, activity_interests, hangout_people_preference, hangout_type_preference, meeting_freq, communication_freq, personal_statement, dealbreakers, languages, friendship_type, friendship_types, communication_style_openness';

type NextCandidate = {
  candidate_id: string;
  interested_in_viewer: boolean | null;
  ghosting_penalized: boolean | null;
  previously_suggested: boolean | null;
};

// deno-lint-ignore no-explicit-any
type Db = any;

async function addTodaysPerson(
  service: Db,
  scoringClient: Db,
  userId: string,
  viewer: Viewer,
  tz: string | null
): Promise<boolean> {
  const { data: next } = await service.rpc('discover_next_candidates', { p_user_id: userId, p_tz: tz });
  const allowed = (next ?? []) as NextCandidate[];
  if (allowed.length === 0) return false;

  const { data: poolRows } = await service.rpc('compatible_candidates_for', { p_user_id: userId });
  const flags = new Map(allowed.map((n) => [n.candidate_id, n]));
  const pool = ((poolRows ?? []) as Candidate[]).filter((c) => flags.has(c.user_id));
  if (pool.length === 0) return false;

  const scored = await Promise.all(
    pool.map(async (c) => ({ candidate: c, score: await weightedScore(scoringClient, viewer, c) }))
  );
  // Someone who already said Interested in the viewer goes first (never
  // revealed). Someone shown before and let go comes back at the bottom,
  // and anyone under the ghosting rule goes last. Then by score.
  const rank = (c: Candidate) => {
    const f = flags.get(c.user_id);
    if (f?.ghosting_penalized) return 3;
    if (f?.previously_suggested) return 2;
    if (f?.interested_in_viewer) return 0;
    return 1;
  };
  scored.sort((a, b) => rank(a.candidate) - rank(b.candidate) || b.score.total - a.score.total);
  const pick = scored[0].candidate;

  let reasoning: string | null = null;
  let humanDetail: string | null = null;
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
          max_tokens: 1500,
          messages: [{ role: 'user', content: buildPrompt(viewer, [forDisplay(pick)]) }],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const jsonText = extractText(data).replace(/^```(json)?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(jsonText) as { candidate_id: string; reasoning: string; human_detail?: string }[];
        const entry = parsed.find((e) => e?.candidate_id === pick.user_id) ?? parsed[0];
        if (entry?.reasoning) reasoning = entry.reasoning.replace(/\s*—\s*/g, ', ');
        if (entry?.human_detail) humanDetail = entry.human_detail.replace(/\s*—\s*/g, ', ');
      }
    } catch {
      // The plain written fallback below is used instead.
    }
  }

  const { data: added } = await service.rpc('discover_add', {
    p_user_id: userId,
    p_candidate_id: pick.user_id,
    p_reasoning: reasoning ?? fallbackReasoning(viewer, forDisplay(pick)),
    p_human_detail: humanDetail ?? fallbackHumanDetail(forDisplay(pick)),
    p_tz: tz,
  });
  return added === true;
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
  friendship_types: null,
  communication_style_openness: null,
};

// Batch mode: called only by the scheduled refresh (MATCH_REFRESH_SECRET),
// so people who were active this week find today's person waiting. Uses
// the Los Angeles day, the pilot's city.
async function runBatchRefresh(): Promise<{ usersProcessed: number }> {
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: users } = await service.rpc('batch_refresh_eligible_users', { p_days: 7 });
  const results = await Promise.all(
    (users ?? []).map(async (u: { id: string }) => {
      const { data: viewerRows } = await service.from('profiles').select(VIEWER_COLUMNS).eq('user_id', u.id).maybeSingle();
      if (!viewerRows) return false;
      return addTodaysPerson(service, service, u.id, viewerRows as Viewer, 'America/Los_Angeles');
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

  let tz: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.tz === 'string') tz = body.tz;
  } catch {
    // No body: the database uses the Los Angeles day.
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: viewerRows } = await supabase.from('profiles').select(VIEWER_COLUMNS).eq('user_id', user.id).maybeSingle();
  const viewer: Viewer = (viewerRows as Viewer | null) ?? EMPTY_VIEWER;
  const added = await addTodaysPerson(service, supabase, user.id, viewer, tz);

  return new Response(JSON.stringify({ added }), {
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
});
