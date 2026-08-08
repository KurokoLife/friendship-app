import { supabase } from '@/lib/supabase';

// "Your experience with new friendship": five private questions. Asked
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
