// Limen v2 (2026-10-03) monetization config. See
// docs/LIMEN_V2_DECISIONS.md, "Monetization".
//
// Member-funded only: no ads, no data sales, no venue/employer/health-plan
// deals, no paywalled features, no capacity for sale. Prices below are the
// working plan from the feature evaluation, to be validated in the pilot.

export type MonetizationPhase = 'pilot' | 'founding' | 'journey';

// Current phase. 'founding' and 'journey' need new non-renewing store
// products (App Store / Play) before they can be switched on.
export const MONETIZATION_PHASE: MonetizationPhase = 'pilot';

export const JOURNEY_LENGTH_DAYS = 182; // about 6 months

export const JOURNEY_PRICE_OPTIONS: { key: string; label: string; usd: number; note?: string }[] = [
  { key: 'free', label: 'Free', usd: 0, note: 'no questions asked' },
  { key: 'p18', label: '$18', usd: 18 },
  { key: 'p30', label: '$30', usd: 30, note: 'suggested, about $5 a month' },
  { key: 'p60', label: '$60', usd: 60, note: 'covers you and one other person' },
];
