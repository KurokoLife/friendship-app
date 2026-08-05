// Guide-library-only entries: a real video, browsable from the Guides
// list and its own standalone /guide/[id] screen (2026-08-24), but with
// no quiz, no scenario, and no onboarding role at all, unlike everything
// in modules-data.ts's ModuleDef. Deliberately a separate, smaller type
// rather than forcing these fields to exist with fake/empty values on
// ModuleDef, which MODULES' other real consumers (etiquette-modules.tsx's
// onboarding filter, module/[id].tsx's quiz screen) both depend on being
// real, meaningful content.
export type GuideOnlyEntry = {
  id: string;
  title: string;
  // One quiet line for the Guides list row, matching ModuleDef's own
  // `description` field's role exactly.
  description: string;
  // The longer paragraph shown on the standalone /guide/[id] screen.
  libraryDescription: string;
};

// The anxiety video (meetup-day-anxiety.mp4) already exists and is
// already used contextually, inside NextMeetupFeelingCard's "Nervous"
// branch, but was never reachable as its own browsable Guides entry
// before this. Added here, not to MODULES.
//
// Content sourcing, per explicit instruction not to invent facts about
// the video: searched this repo, the Downloads folder, and the video
// source folder directly for any script or storyboard document for this
// specific video (the same kind of source "How We Show Up"'s own content
// was drawn from). None exists: no "video-3"/"does-not-need-to-be-
// perfect" reference anywhere, no video2/video3 storyboard alongside the
// one real video1_storyboard.png that does exist, and limen-spec-v6.md
// (the most likely candidate) explicitly states on its own line 8 that
// "video/Guide-library content details are omitted from this version."
// The only verified real content available is NextMeetupFeelingCard's
// own existing intro line ("That's a completely normal way to feel
// before meeting up. A couple of thoughts before you go."), used as the
// sole grounding for the text below, deliberately brief rather than
// elaborated on.
export const GUIDE_ONLY_ENTRIES: GuideOnlyEntry[] = [
  {
    id: 'guide_meetup_anxiety',
    title: 'Feeling Nervous Before a Meetup',
    description: 'A short note for the nerves before a meetup.',
    libraryDescription:
      "For the moments before a meetup when nerves show up: a completely normal way to feel, with a couple of thoughts to carry with you before you go.",
  },
];

export function getGuideOnlyEntry(id: string): GuideOnlyEntry | undefined {
  return GUIDE_ONLY_ENTRIES.find((e) => e.id === id);
}
