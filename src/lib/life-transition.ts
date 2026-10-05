// Generic, per-category phrasing, not tied to any one person's real words,
// used to turn a life_transitions category someone picked themselves into
// a warmer sentence fragment. Any category not in this map (shouldn't
// happen, filter-options.ts's LIFE_TRANSITIONS is a closed set) falls back
// to a lowercased version of the raw label. Shared between home.tsx's
// suggestion cards, browse.tsx's cards, and the inbox's conversation rows,
// all three want the identical fragment for the same category.
const LIFE_TRANSITION_FRAGMENTS: Record<string, string> = {
  'Divorce or separation': 'navigating life after a divorce or separation',
  'Divorce, separation, or the end of a long relationship': 'navigating life after a divorce, separation, or the end of a long relationship',
  "Nothing big, I'd just like more friends": 'here to make more friends',
  Relocation: 'settling into a new place after a recent move',
  Bereavement: 'finding their way through grief and loss',
  'Career change': 'figuring out what comes next after a career change',
  'Empty nesting': 'adjusting to a quieter house now that the kids are grown',
  Retirement: 'settling into a new rhythm after retirement',
  'Health journey': 'navigating a health journey',
  'Starting over after a long relationship': 'starting over after a long relationship',
  'Becoming a caregiver': 'adjusting to a new role as a caregiver',
  'Becoming a grandparent': 'settling into a new role as a grandparent',
  'Recovery journey': 'navigating a recovery journey',
  'Finding a new purpose': 'looking for a new sense of purpose',
};

// Someone can now be navigating up to 3 transitions at once
// (profiles.life_transitions is an array, see
// 20260713000005_life_transitions_array.sql), but a card's one-line
// caption stays readable by only showing the first one they picked, not
// all three stacked into a single run-on sentence. The full profile
// screen (candidate/[id].tsx) is the one place all of them are actually
// shown, it has the room for a real list.
export function lifeTransitionFragment(transitions: string[] | null): string | null {
  if (!transitions || transitions.length === 0) return null;
  const first = transitions[0];
  return LIFE_TRANSITION_FRAGMENTS[first] ?? first.toLowerCase();
}

// Every transition someone chose to show, as full sentences, for the full
// profile view (src/components/public-profile-view.tsx).
export function lifeTransitionSentences(transitions: string[] | null): string[] {
  if (!transitions || transitions.length === 0) return [];
  return transitions.map((t) => {
    const fragment = LIFE_TRANSITION_FRAGMENTS[t] ?? t.toLowerCase();
    return `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}.`;
  });
}
