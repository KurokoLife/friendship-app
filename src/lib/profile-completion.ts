// One completion formula for the Profile tab and Edit profile (2026-10-14).
// Before, the tab showed a number saved at the last Save, which went stale
// when fields were added, so the two screens disagreed.

export type CompletionInput = {
  life_transitions?: string[] | null;
  life_transitions_other?: string | null;
  languages?: string[] | null;
  personal_statement?: string | null;
  values?: string[] | null;
  activity_categories?: string[] | null;
  hangout_type_preference?: string[] | null;
  stories?: { text?: string | null }[] | null;
  meeting_freq?: string | null;
  response_time?: string | null;
  bar_preference?: string | null;
  dealbreakers?: string | null;
  photo_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  friendship_types?: string[] | null;
  communication_style_openness?: string | null;
  availability?: string[] | null;
};

export function completionPct(p: CompletionInput): number {
  const has = (a?: unknown[] | null) => (a?.length ?? 0) > 0;
  const text = (t?: string | null) => (t ?? '').trim().length > 0;
  // 2026-10-18: "what brings you here" is free text (life_transitions_other);
  // values, hangout style, opening up and "Right now" are no longer asked.
  const checks = [
    text(p.life_transitions_other),
    has(p.activity_categories),
    (p.stories ?? []).some((s) => text(s?.text)),
    Boolean(p.meeting_freq),
    Boolean(p.response_time),
    Boolean(p.bar_preference),
    text(p.dealbreakers),
    Boolean(p.photo_url),
    Boolean(p.location_lat && p.location_lng),
    has(p.friendship_types),
    has(p.availability),
    has(p.languages),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
