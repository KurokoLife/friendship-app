import { supabase } from '@/lib/supabase';

// "How you connect" (2026-10-18): six private questions about friendship
// habits, shown only on the person's own Profile ("You as a friend"). No
// summary is written from them, and they are never used for matching.
// History: "Your experience with new friendship": five private questions. Asked
// during onboarding originally, moved 2026-07-28 to a post-first-message
// trigger, moved back to onboarding 2026-08-08 (src/app/friendship-
// experience.tsx, reached right after big-five-assessment.tsx completes).
// The time-based eligibility logic that lived here for the post-first-
// message version (shouldShowFriendshipExperiencePrompt) is fully removed,
// not just unused, this is a real trigger-mechanism replacement, not an
// addition alongside it. Never shown on a public profile, never shared
// with other users, never used as a matching filter, ranking signal, or
// block signal, never turned into a score or a label, unchanged
// throughout every version of this feature's own trigger.

// 2026-10-22: every question takes any number of answers. They used to be
// "pick the one most likely", but people often think more than one thing,
// and since the answers are private and never scored, there is no reason
// to make them choose.
export type ExperienceKey =
  | 'growthFactors'
  | 'lostMomentumReasons'
  | 'awkwardnessInterpretation'
  | 'slowReplyThought'
  | 'afterPositiveMeetupBehavior'
  | 'hardestCurrentStep';

export type ExperienceQuestion = { key: ExperienceKey; prompt: string; options: string[] };

// Mirrors supabase/functions/generate-personality-narrative's own
// EXPERIENCE_PROMPTS/EXPERIENCE_OPTIONS exactly (that Deno function
// duplicates this list rather than importing it, it has no access to this
// app's own TS module tree). Keep both in sync if this ever changes.
export const EXPERIENCE_QUESTIONS: ExperienceQuestion[] = [
  {
    key: 'growthFactors',
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
    prompt: 'When a first conversation or meetup feels awkward, what goes through your mind?',
    options: [
      'We probably do not click',
      'I probably said something wrong',
      'They probably were not interested',
      'We may both just need more time',
      'Awkwardness is normal when people are new to each other',
      'It depends',
    ],
  },
  // 2026-10-18: replaces the old "When a friend cancels last minute" question.
  {
    key: 'slowReplyThought',
    prompt: 'When someone takes a while to reply, I usually think...',
    options: [
      "They're probably just busy",
      'I wonder if I said something wrong',
      'They may have lost interest',
      "I don't think much of it",
      'It depends',
    ],
  },
  {
    key: 'afterPositiveMeetupBehavior',
    prompt: 'After a good first meetup, what do you usually do?',
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
    prompt: 'Which parts of building a new friendship feel hardest right now?',
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

export type FriendshipExperience = Record<ExperienceKey, string[]>;

export const EMPTY_EXPERIENCE: FriendshipExperience = {
  growthFactors: [],
  lostMomentumReasons: [],
  awkwardnessInterpretation: [],
  slowReplyThought: [],
  afterPositiveMeetupBehavior: [],
  hardestCurrentStep: [],
};

// Older answers saved one choice as a plain string; read them as a list.
export function normalizeExperience(stored: unknown): FriendshipExperience {
  const out: FriendshipExperience = { ...EMPTY_EXPERIENCE };
  if (!stored || typeof stored !== 'object') return out;
  const obj = stored as Record<string, unknown>;
  for (const q of EXPERIENCE_QUESTIONS) {
    const v = obj[q.key];
    out[q.key] = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [];
  }
  return out;
}

export function allExperienceAnswered(experience: FriendshipExperience): boolean {
  return EXPERIENCE_QUESTIONS.every((q) => experience[q.key].length > 0);
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
