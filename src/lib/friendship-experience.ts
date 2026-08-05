import { supabase } from '@/lib/supabase';

// "Your experience with new friendship": five private questions, formerly
// asked during onboarding (before generate-personality-narrative existed
// in its three-section form), moved 2026-07-28 to a post-first-message
// trigger instead, see FriendshipExperienceModal and
// shouldShowFriendshipExperiencePrompt below. Never shown on a public
// profile, never shared with other users, never used as a matching
// filter, ranking signal, or block signal, never turned into a score or a
// label, unchanged from the original onboarding version of this feature.

export type ExperienceMultiKey = 'growthFactors' | 'lostMomentumReasons';
export type ExperienceSingleKey = 'awkwardnessInterpretation' | 'afterPositiveMeetupBehavior' | 'hardestCurrentStep';

export type ExperienceQuestion =
  | { key: ExperienceMultiKey; type: 'multi'; prompt: string; options: string[] }
  | { key: ExperienceSingleKey; type: 'single'; prompt: string; options: string[] };

// Mirrors supabase/functions/generate-personality-narrative's own
// EXPERIENCE_PROMPTS/EXPERIENCE_OPTIONS exactly (that Deno function
// duplicates this list rather than importing it, it has no access to this
// app's own TS module tree). Keep both in sync if this ever changes.
export const EXPERIENCE_QUESTIONS: ExperienceQuestion[] = [
  {
    key: 'growthFactors',
    type: 'multi',
    prompt: 'Think about a friendship that grew well. What helped it grow?',
    options: [
      'We saw each other regularly',
      'We had something we enjoyed doing together',
      'One of us reached out and the other responded',
      'We could be honest, even when something felt awkward',
      'We followed through on plans',
      'It grew slowly over time',
      "I'm not sure",
    ],
  },
  {
    key: 'lostMomentumReasons',
    type: 'multi',
    prompt: 'When a promising new connection faded, what usually happened?',
    options: [
      'The conversation became one-sided',
      'We talked but never made plans',
      'We met once and neither of us followed up',
      'Scheduling or distance got in the way',
      'Someone canceled and it never restarted',
      'One of us stopped responding',
      "I'm not sure",
      "I haven't had this experience",
    ],
  },
  {
    key: 'awkwardnessInterpretation',
    type: 'single',
    prompt: 'When a first conversation or meetup feels awkward, what are you most likely to think?',
    options: [
      'We probably do not click',
      'I probably said something wrong',
      'They probably were not interested',
      'We may both just need more time',
      'Awkwardness is normal when people are new to each other',
      'It depends',
    ],
  },
  {
    key: 'afterPositiveMeetupBehavior',
    type: 'single',
    prompt: 'After a good first meetup, what are you most likely to do?',
    options: [
      'Reach out soon',
      'Want to reach out, but wait',
      'Wait to see whether they contact me',
      'Worry that reaching out too soon may feel like too much',
      'It depends',
    ],
  },
  {
    key: 'hardestCurrentStep',
    type: 'single',
    prompt: 'Which part of building a new friendship feels hardest right now?',
    options: [
      'Starting the conversation',
      'Suggesting a meetup',
      'Getting through the first meetup',
      'Following up afterward',
      'Suggesting another activity',
      'Knowing whether the interest is mutual',
      'Making time consistently',
      "I'm not sure",
    ],
  },
];

export type FriendshipExperience = {
  growthFactors: string[];
  lostMomentumReasons: string[];
  awkwardnessInterpretation: string | null;
  afterPositiveMeetupBehavior: string | null;
  hardestCurrentStep: string | null;
};

export const EMPTY_EXPERIENCE: FriendshipExperience = {
  growthFactors: [],
  lostMomentumReasons: [],
  awkwardnessInterpretation: null,
  afterPositiveMeetupBehavior: null,
  hardestCurrentStep: null,
};

export function allExperienceAnswered(experience: FriendshipExperience): boolean {
  return EXPERIENCE_QUESTIONS.every((q) =>
    q.type === 'multi' ? experience[q.key].length > 0 : experience[q.key] !== null
  );
}

// Shown in place of a real "what has helped" / "when uncertain" section
// whenever friendship_experience hasn't been answered yet. Deliberately
// NOT the same as generate-personality-narrative's own FALLBACK_WHAT_HELPED/
// FALLBACK_WHEN_UNCERTAIN constants, those were written for "there's
// genuinely no evidence and there may never be" (the old Profile-tab
// retake framing). This is a different, honest, future-facing case: the
// evidence doesn't exist YET because the question hasn't been asked yet,
// not because there's nothing there. Chosen client-side, not server-side,
// see this file's header comment for why the server can't tell these two
// cases apart on its own.
export const WHAT_HELPED_PENDING_COPY =
  "Once you've connected with someone, come back here and we'll reflect on what helped it go well.";
export const WHEN_UNCERTAIN_PENDING_COPY =
  "This will take shape once you've had a real conversation or two. Come back after you've connected with someone and we'll reflect on what felt uncertain.";

export async function saveFriendshipExperience(userId: string, experience: FriendshipExperience): Promise<void> {
  await supabase.from('profiles').upsert({ user_id: userId, friendship_experience: experience });
}

// Eligibility for the post-first-message prompt (2026-07-28 redesign,
// replacing the old onboarding placement). Two triggers, whichever comes
// first:
// 1. Four hours after the user's first message, sent OR received, across
//    ANY of their connections, whichever happened first. Read as "the
//    earliest message in any conversation this user is a participant in,
//    regardless of who sent it", exactly matching that framing.
// 2. A seven-day backstop since onboarding completed
//    (users.behavioral_tracking_disclosed_at, the real "onboarding is
//    fully done" timestamp readiness-commitment.tsx already writes), for
//    a user who hasn't exchanged a first message at all yet.
// No push infrastructure exists in this app (a standing, documented
// limitation), so this is checked live on load rather than fired by a
// server-side scheduler, same "next app open" surfacing every other
// elapsed-time prompt in this app already uses when there's no DB-backed
// evaluator behind it.
export async function shouldShowFriendshipExperiencePrompt(userId: string): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('friendship_experience')
    .eq('user_id', userId)
    .maybeSingle();
  if (profile?.friendship_experience) return false;

  const { data: myConnections } = await supabase
    .from('connections')
    .select('id')
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);
  const connectionIds = (myConnections ?? []).map((c) => c.id as string);

  if (connectionIds.length > 0) {
    const { data: earliestMessage } = await supabase
      .from('messages')
      .select('created_at')
      .in('connection_id', connectionIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (earliestMessage) {
      const elapsedMs = Date.now() - new Date(earliestMessage.created_at as string).getTime();
      return elapsedMs >= 4 * 60 * 60 * 1000;
    }
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('behavioral_tracking_disclosed_at')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow?.behavioral_tracking_disclosed_at) return false;

  const onboardingElapsedMs = Date.now() - new Date(userRow.behavioral_tracking_disclosed_at as string).getTime();
  return onboardingElapsedMs >= 7 * 24 * 60 * 60 * 1000;
}
