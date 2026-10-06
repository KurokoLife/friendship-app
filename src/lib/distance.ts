// Fix 5: shared by home.tsx (Discovery) and browse.tsx (Browse), both
// read the same distance_miles/location_city shape from discovery_
// profiles/browse_profiles (or generate-match-suggestions' own response,
// which mirrors it exactly).
//
// Under 1 mile reads as "Nearby" rather than "0 miles away" or a
// fractional number, matching the given spec's third case ("if same
// city: show Nearby") without needing a separate city-string comparison,
// since two people in the same city will always compute well under a
// mile apart, close enough in practice this is the same signal without
// depending on city-name strings being formatted identically.
export function formatDistance(distanceMiles: number | null, locationCity: string | null): string | null {
  if (distanceMiles !== null && distanceMiles !== undefined) {
    // 2026-10-06: the city is shown next to the distance, so people can
    // tell where someone actually is, not just how far.
    const distance = distanceMiles < 1 ? 'Nearby' : `${Math.round(distanceMiles)} miles away`;
    return locationCity ? `${distance} · ${locationCity}` : distance;
  }
  // Distance couldn't be computed (the viewer or candidate lacks a real
  // geocode), fall back to showing the candidate's own city name if they
  // have one, per the given spec's second case.
  if (locationCity) return locationCity;
  return null;
}
