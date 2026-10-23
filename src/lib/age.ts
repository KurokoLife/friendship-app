// Fix #1 (July 19 reconciliation session): pure age/age-band functions,
// the client-side counterpart to public.age_band() (migration
// 20260719000002), which does the same band computation server-side for
// discovery_profiles/browse_profiles/compatible_candidates_for. Kept in
// sync by hand, same "a Deno function can't import this" reasoning this
// project already applies elsewhere between Edge Functions and src/lib.
//
// Exact age is fine to compute and show for a user's OWN profile (self-
// display, e.g. the Profile tab), that's not the privacy boundary. It's
// showing one person's exact age/birthdate TO ANOTHER USER that must
// never happen, which is why the server-side views never expose the raw
// column at all, not just omit it from this app's own UI.
export function calculateAge(birthdate: string | Date): number {
  const dob = typeof birthdate === 'string' ? new Date(birthdate) : birthdate;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

// Bands per blueprint Section 9, identical to public.age_band()'s own
// case statement.
export function ageToBand(age: number): string {
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18-24';
  if (age >= 70) return '70+';
  // 2026-10-22: 5-year ranges (25-29, 30-34, ... 65-69), same as public.age_band().
  const start = Math.floor(age / 5) * 5;
  return `${start}-${start + 4}`;
}

export function birthdateToAgeBand(birthdate: string | Date): string {
  return ageToBand(calculateAge(birthdate));
}
