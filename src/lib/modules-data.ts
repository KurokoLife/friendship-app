// Shared content for every etiquette/skills module: F7's two mandatory
// modules, the quiet Guides list (profile settings), and any future
// contextual interstitial (Path 1, see module/[id].tsx and
// src/lib/module-gate.ts). One source of truth so none of those surfaces
// can drift apart on wording, and so completion keys line up with the
// single `users.etiquette_modules` JSONB column all of them read and write.
//
// Deliberately no unlock language, no time estimates, no post-MVP flag in
// this data anymore, none of that is shown anywhere in the UI. There is no
// gamification layer here, just content plus, where relevant, a note on
// which future in-app moment should eventually trigger it contextually.
export type ModuleChoice = {
  label: string;
  correct: boolean;
  feedback: string;
};

export type ModuleDef = {
  id: string;
  order: number;
  title: string;
  // One quiet line shown next to the title in the Guides list, e.g. "What
  // to say when a connection isn't working out." No "unlocks" framing.
  description: string;
  // A longer, informal paragraph for the standalone Guide library screen
  // (src/app/guide/[id].tsx, 2026-08-24), distinct from the one-line
  // `description` above. Optional: only the 2 modules with a real video
  // (module_curiosity, module_show_up) have one today, since that's the
  // only screen that reads it. Condensed from this module's own
  // `concept` array, not new facts, matching this project's own "don't
  // invent content" discipline.
  libraryDescription?: string;
  concept: string[];
  scenario: {
    prompt: string;
    choices: ModuleChoice[];
  };
  mandatory: boolean;
  // Not displayed anywhere. Documents which real in-app moment should
  // eventually show this module as a contextual interstitial (Path 1),
  // once that feature actually exists. Undefined for modules with no
  // single clear trigger, they only live in the Guides list for now.
  contextTrigger?: string;
};

export const MODULES: ModuleDef[] = [
  {
    // Onboarding update (2026-07-26): required Video 1, replacing "The
    // rhythm of messaging" in the mandatory onboarding slot (demoted
    // below, not deleted, still reachable in the Guides list). Real video
    // production is a separate, later task, not this one, see
    // VideoPlaceholder's own TODO and the comment on etiquette-modules.tsx.
    // Concept/scenario text below is a placeholder standing in for the
    // eventual video's script, written from the purpose this video is
    // meant to serve (changing the mindset a user brings into the app,
    // curiosity over evaluation), not a finished production brief.
    id: 'module_curiosity',
    order: 1,
    title: 'Begin With Curiosity',
    description: 'Why friendship starts with curiosity, not evaluation.',
    libraryDescription:
      "A profile is just a glimpse, not a whole person, so curiosity beats a snap judgment every time. A shared interest can open a door, and so can a real difference. You don't need instant chemistry to know something's worth continuing, one conversation is incomplete information on its own. An awkward moment doesn't mean it's not working either, the other person is probably just as unsure as you are.",
    // 2026-10-04 (docs/DECISIONS.md onboarding screen 8): key points
    // rewritten to match what the video actually teaches.
    concept: [
      "A profile is a glimpse, not a whole person. Everyone carries context you can't see.",
      'Start with curiosity, not evaluation: what would you genuinely like to understand about them?',
      'A shared interest can open a door, and so can a difference.',
      "Pauses and awkward moments are normal. They're probably wondering the same things you are.",
      "Curiosity doesn't mean ignoring your own comfort. It means you don't have to decide right away.",
    ],
    scenario: {
      prompt: "A profile doesn't immediately excite you. What's the healthier first move?",
      choices: [
        {
          label: 'Ask a genuine question about something in their profile.',
          correct: true,
          feedback:
            'That is curiosity in action. It gives the conversation somewhere real to go instead of resting on a first impression.',
        },
        {
          // A tempting wrong answer, not an obviously wrong one, so the
          // question takes a moment of real thought.
          label: "Wait to see if they message first, since the profile didn't grab you.",
          correct: false,
          feedback:
            "Waiting feels neutral, but it hands the first move to someone who is probably just as unsure as you. A profile is incomplete information either way, a genuine question is how you find out what's actually there.",
        },
      ],
    },
    mandatory: true,
  },
  {
    // Onboarding update (2026-07-26): required Video 2, replacing "When
    // friendship gets hard" in the mandatory onboarding slot (demoted
    // below, not deleted). Same placeholder-text-standing-in-for-a-video
    // note as above applies here.
    id: 'module_show_up',
    order: 2,
    title: 'How We Show Up',
    description: 'Messaging rhythm, honest endings, and naming awkwardness.',
    libraryDescription:
      "If a connection isn't right for you anymore, say so. A short, honest message is kinder than just disappearing, the other person deserves real clarity, not silence. That doesn't mean you owe anyone continued contact, though. If something feels unsafe, you can leave, block, or report, no explanation required.",
    // Concept and scenario replaced per Scene 7 of the video's own
    // script, matching honest endings rather than the earlier draft's
    // awkward-moment scenario, since the video content itself was built
    // around this instead.
    // 2026-10-04: the video covers reply rhythm, acknowledging without a
    // full reply, honest endings, naming awkwardness and safety; the page
    // now does too. The friendship-only line is page-only (not in the
    // video), part of the safety plan in docs/DECISIONS.md section 3.
    concept: [
      "Reply speeds differ. One slow reply isn't a verdict.",
      'You can acknowledge without a full reply: "Saw this, I\'ll get back to you this weekend."',
      "If you don't want to continue, say so briefly. Disappearing leaves them guessing.",
      'Naming awkwardness usually makes it smaller. Once you\'re comfortable, a short call can help.',
      'If you feel unsafe, you owe no explanation. Leave, block, or report.',
      "Limen is for friendship only. Romantic advances or asking for money aren't okay here.",
    ],
    scenario: {
      prompt: "You've decided this connection isn't right for you. What's the healthier move?",
      choices: [
        {
          label: "Send a short, honest message that you're ending it.",
          correct: true,
          feedback:
            "That's honest closure. Even a brief message gives the other person clarity instead of silence, and closes things with the same care you'd want to receive.",
        },
        {
          // The soft-ghosting habit Limen is trying to prevent, written as
          // the tempting answer it is.
          label: 'Keep replying politely but less often, so it fades without hurting them.',
          correct: false,
          feedback:
            "It feels gentler, but from their side it's a slow, confusing silence, left wondering what changed. A short, honest message is kinder, even when it's a hard one to send.",
        },
      ],
    },
    mandatory: true,
  },
  {
    id: 'module_1',
    // Demoted from the mandatory onboarding slot (2026-07-26), replaced
    // above by "Begin With Curiosity". Content and id untouched, still
    // reachable in the Guides list (src/app/guides.tsx), still shares
    // completion tracking under the same users.etiquette_modules key it
    // always has, for any existing user who already completed it.
    order: 3,
    title: 'The rhythm of messaging',
    description: 'How reply timing and honest rescheduling keep plans alive.',
    concept: [
      "Good friendships have a rhythm, and messaging is part of it. The rule of thumb: reply within 48 hours. If you genuinely can't give a real answer yet, a quick status works just as well. Something like, buried this week, will write back properly soon.",
      "When you need to reschedule, always offer a specific new time. Let's figure it out later quietly ends more plans than an honest reschedule ever does.",
    ],
    scenario: {
      prompt: 'You need to cancel plans with a friend for tomorrow. What do you say?',
      choices: [
        {
          label: "Can't make tomorrow, are you free Thursday evening instead?",
          correct: true,
          feedback:
            "That's the rhythm. A specific new time keeps the plan alive instead of leaving it to drift.",
        },
        {
          label: "Can't make tomorrow, we'll figure out another time soon.",
          correct: false,
          feedback:
            "Here's what your friend experiences: an open-ended soon often reads as a soft no. They're left wondering if you'll actually follow up, and most people won't chase a plan a second time.",
        },
      ],
    },
    mandatory: false,
  },
  {
    id: 'module_2',
    // Demoted from the mandatory onboarding slot (2026-07-26), replaced
    // above by "How We Show Up". Content and id untouched, still
    // reachable in the Guides list, same completion-tracking note as
    // module_1 above.
    order: 4,
    title: 'When friendship gets hard',
    description: 'What to do when the effort starts to feel one-sided.',
    concept: [
      "Sometimes you'll notice the effort isn't even. You're the one reaching out, planning, remembering. That's worth naming to yourself, calmly, without turning it into a verdict on the whole friendship.",
      'The same goes for anything that feels off. Naming discomfort directly, kindly, and early is what keeps a friendship real. Going quiet just lets it fade for both of you.',
    ],
    scenario: {
      prompt: "You've noticed you've been the one initiating plans for weeks. What's the healthiest move?",
      choices: [
        {
          label: "Mention it directly. I've been the one reaching out lately, how are you feeling about us hanging out?",
          correct: true,
          feedback:
            'Exactly. Naming it gives the friendship a real chance to rebalance instead of quietly fading.',
        },
        {
          label: 'Stop reaching out and see if they notice.',
          correct: false,
          feedback:
            "Here's what your friend experiences: they may not even register the shift, life gets busy. Silence just lets the friendship fade for both of you, with neither person understanding why.",
        },
      ],
    },
    mandatory: false,
    contextTrigger:
      'F20 reciprocity awareness, once built: surface when the app detects one-sided initiation.',
  },
  {
    id: 'module_3',
    order: 5,
    title: 'The honest exit',
    description: "What to say when a connection isn't working out.",
    concept: [
      "Every friendship connection deserves an honest ending if it's not working, not a slow fade into silence. Ghosting isn't an option here, not because it's against the rules, but because everyone deserves to know where they stand.",
      "An honest exit doesn't need a long explanation. A simple, kind message that says this isn't the right fit is enough. It takes more courage than staying quiet, and that courage is worth something.",
    ],
    scenario: {
      prompt: "You've decided this connection isn't working for you. What do you do?",
      choices: [
        {
          label: "Send a short, kind message letting them know you're stepping back.",
          correct: true,
          feedback:
            "That's the honest exit. It's a harder message to send than silence, but it's the one that respects the other person.",
        },
        {
          label: 'Just stop responding and let the conversation fade.',
          correct: false,
          feedback:
            "Here's what your friend experiences: they're left wondering what happened, replaying messages, unsure if it was something they did. An honest ending spares them that.",
        },
      ],
    },
    mandatory: false,
    contextTrigger:
      'F29 honest exit, once built: surface the first time a user tries to end a connection.',
  },
  {
    id: 'module_4',
    order: 6,
    title: 'Curiosity and care',
    description: 'Small ways of noticing and showing up for a friend.',
    concept: [
      'Curiosity is the heart of good friendship. Instead of assuming you know what someone means or how they feel, asking a genuine question opens the door to actually knowing them.',
      "Care doesn't always look like grand gestures. Noticing a small shift in someone's mood, and asking about it instead of letting it pass, is often what people remember most.",
    ],
    scenario: {
      prompt: 'A friend seems quieter than usual during your hangout. What is the better move?',
      choices: [
        {
          label: 'Ask gently, you seem a little quiet today, is everything okay?',
          correct: true,
          feedback:
            'That is curiosity in action. It gives them an easy opening to share, or to say they are fine, without pressure either way.',
        },
        {
          label: "Assume they're just tired and don't bring it up.",
          correct: false,
          feedback:
            "Here's what your friend experiences: they may have wanted an opening to talk, and assuming instead of asking can quietly close that door.",
        },
      ],
    },
    mandatory: false,
    contextTrigger:
      'F23 activity suggestions / PM4 parallel hangout, once built: surface when suggesting activity options after a first meetup.',
  },
  {
    id: 'module_5',
    order: 7,
    title: 'What friendship actually looks like',
    description: "Why friendship doesn't move at just one speed.",
    concept: [
      "Friendship doesn't move at one speed. Some connections are weekly, some are monthly, some are the kind where months pass and it still feels the same when you reconnect. None of those are lesser.",
      "Not every friendship becomes a best friendship, and that's fine. Comparing a new connection to your closest friendships too early is a quick way to talk yourself out of something that just needs more time.",
    ],
    scenario: {
      prompt: 'A new friend hasn\'t texted in two weeks. What is the healthiest read?',
      choices: [
        {
          label: "Life probably got busy, I'll reach out when I think of them.",
          correct: true,
          feedback:
            'Exactly right. Rhythm varies a lot between people, and a quiet stretch rarely means what it feels like it means.',
        },
        {
          label: "They've probably lost interest in being friends.",
          correct: false,
          feedback:
            "Here's what's usually actually happening: most gaps like this are just life, not a verdict on the friendship. Reaching out is almost always welcomed.",
        },
      ],
    },
    mandatory: false,
  },
  {
    id: 'module_6',
    order: 8,
    title: 'Early friendship fragility',
    description: 'How trust builds, a little at a time, in a new friendship.',
    concept: [
      "New friendships are more fragile than old ones. They haven't built up the trust that lets them absorb an awkward moment or a slow reply yet, so small things can feel like bigger tests early on.",
      'Sharing something real, a little at a time, is what turns an acquaintance into a friend. Too much too soon can overwhelm, staying guarded too long can keep things surface level forever.',
    ],
    scenario: {
      prompt: 'A newer friend shares something vulnerable with you. What is the better response?',
      choices: [
        {
          label: 'Thank them for sharing, and respond with something real of your own.',
          correct: true,
          feedback:
            'That is how trust builds. Meeting vulnerability with vulnerability tells them it was safe to share.',
        },
        {
          label: 'Change the subject to something lighter to ease the moment.',
          correct: false,
          feedback:
            "Here's what your friend experiences: it can feel like the vulnerable thing they shared wasn't welcome, even if that wasn't the intent.",
        },
      ],
    },
    mandatory: false,
  },
  {
    id: 'module_7',
    order: 9,
    title: 'How to write an honest profile',
    description: 'Why honesty works better than sounding impressive.',
    concept: [
      "A profile that sounds like everyone else's attracts matches based on nothing real. Writing what's actually true about you, even the ordinary parts, is what helps the right people recognize themselves in you.",
      "You don't need to sound impressive. You need to sound like you. The friendships that last are built on who you actually are, not a more polished version of it.",
    ],
    scenario: {
      prompt: 'You are filling out your profile. What is the better approach?',
      choices: [
        {
          label: 'Describe your actual interests and personality, even the low-key ones.',
          correct: true,
          feedback:
            'That is it. An honest profile is what makes matching actually work, instead of just looking good.',
        },
        {
          label: 'List interests that sound more exciting than your real ones.',
          correct: false,
          feedback:
            'Here is what happens: you might get more matches, but fewer of them will actually click, since they connected with a version of you that is not quite real.',
        },
      ],
    },
    mandatory: false,
  },
  {
    id: 'module_8',
    order: 10,
    title: 'Understanding your social patterns',
    description: 'Noticing your own habits in how you show up for friends.',
    concept: [
      'Everyone has default patterns in friendship, some people always initiate, some always wait to be invited. Noticing your own pattern, without judging it, is the first step to changing it if you want to.',
      'This app already learns some of this from how you answered earlier questions. This module is about noticing it for yourself too, so it does not stay invisible to you.',
    ],
    scenario: {
      prompt: 'You notice you almost always wait for others to reach out first. What is a healthy next step?',
      choices: [
        {
          label: 'Try initiating one hangout this week, just to see how it feels.',
          correct: true,
          feedback:
            'Small experiments like that are how patterns actually shift, not by deciding to be a different person overnight.',
        },
        {
          label: "Decide that's just who you are and leave it alone.",
          correct: false,
          feedback:
            'That is a fair choice too, waiting is not wrong. Just worth knowing it is a pattern you are choosing, not a fixed trait.',
        },
      ],
    },
    mandatory: false,
  },
  {
    id: 'module_9',
    order: 11,
    title: 'Everyday friendship',
    description: 'Why the ordinary, unplanned moments count too.',
    concept: [
      'Not every moment of friendship needs to be a planned event. Running an errand together, or just being in the same space while you both do your own thing, builds connection just as much as a big night out.',
      'This is sometimes called ordinary time, the everyday, unremarkable moments that quietly become some of the ones you remember most.',
    ],
    scenario: {
      prompt: 'A friend invites you to just come along while they run errands. What is the better response?',
      choices: [
        {
          label: 'Say yes, it does not have to be a big plan to be worth doing.',
          correct: true,
          feedback:
            'Exactly. Some of the best friendship moments happen in the ordinary, unplanned stretches of time.',
        },
        {
          label: 'Decline, since it is not a real hangout.',
          correct: false,
          feedback:
            'Here is what you might be missing: casual, low-key time together often builds more closeness than the occasional big event.',
        },
      ],
    },
    mandatory: false,
  },
];

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}
