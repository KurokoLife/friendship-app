const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

// The 2 mandatory onboarding modules have real, uploaded videos in the
// guide-videos Storage bucket (2026-08-22 session, migration
// 20260822000000). Every other module (F8's library) still has no real
// video and falls back to VideoPlaceholder. Deliberately a narrow,
// explicit map rather than derived from modules-data.ts itself, since
// which modules have a real video is independent of which modules exist.
const MODULE_VIDEO_FILES: Record<string, string> = {
  module_curiosity: 'module_curiosity.mp4',
  module_show_up: 'module_show_up.mp4',
};

const MEETUP_ANXIETY_VIDEO_FILE = 'meetup-day-anxiety.mp4';

function publicGuideVideoUrl(file: string): string | undefined {
  if (!SUPABASE_URL) return undefined;
  return `${SUPABASE_URL}/storage/v1/object/public/guide-videos/${file}`;
}

export function getModuleVideoUrl(moduleId: string): string | undefined {
  const file = MODULE_VIDEO_FILES[moduleId];
  return file ? publicGuideVideoUrl(file) : undefined;
}

export function getMeetupAnxietyVideoUrl(): string | undefined {
  return publicGuideVideoUrl(MEETUP_ANXIETY_VIDEO_FILE);
}

// The Guides list's own browsable entry for the anxiety video
// (guide_meetup_anxiety, see guide-only-entries.ts), a separate id/lookup
// from getMeetupAnxietyVideoUrl above on purpose: that one backs
// NextMeetupFeelingCard's contextual "Nervous" branch and is untouched by
// this addition, even though both ultimately resolve to the same real
// file in storage.
const GUIDE_ONLY_VIDEO_FILES: Record<string, string> = {
  guide_meetup_anxiety: MEETUP_ANXIETY_VIDEO_FILE,
};

export function getGuideOnlyEntryVideoUrl(id: string): string | undefined {
  const file = GUIDE_ONLY_VIDEO_FILES[id];
  return file ? publicGuideVideoUrl(file) : undefined;
}
