// Shared, closed option sets that both profile-build.tsx (what a user
// picks about themselves) and browse.tsx (F12, what a user filters other
// people by) need to stay in sync on. Kept in one place so the two screens
// can never quietly drift apart on the exact wording of an option, which
// would otherwise silently break filtering (a filter chip whose label
// doesn't exactly match the stored value would just never match anyone).
// Expanded from 6 to 13 options, then "Something else" was removed and the
// selection limit dropped entirely (2026-07-16): a person can select every
// option that applies, a separate life_transitions_other free-text field
// covers anything not on this list, display-only, never scored. Stored as
// profiles.life_transitions (text[], no length cap, see
// 20260716000000_profile_field_updates.sql).
export const LIFE_TRANSITIONS = [
  'Divorce or separation',
  'Relocation',
  'Bereavement',
  'Career change',
  'Empty nesting',
  'Retirement',
  'Health journey',
  'Starting over after a long relationship',
  'Becoming a caregiver',
  'Becoming a grandparent',
  'Recovery journey',
  'Finding a new purpose',
];

export const HANGOUT_PEOPLE = ['1-on-1', 'Small group (3-5)', 'Big group (6+)'];

export const HANGOUT_TYPES = [
  'Spontaneous drop-bys',
  'Planned ahead',
  'Co-working style',
  'Outdoor activities',
  'Homebody',
];

// Blueprint Section 8: general availability, when someone is typically
// free to meet, distinct from communication_freq (how often they check
// in over messaging) and meeting_freq (how often they like to actually
// get together). Multi-select, uncapped, same convention as
// hangout_type_preference above, someone can genuinely have more than
// one true availability window. Not required for matching, a soft
// preference only, stored as profiles.availability (text[]).
export const AVAILABILITY = [
  'Weekday mornings',
  'Weekday daytime',
  'Weekday evenings',
  'Weekends',
  'Flexible, it varies',
];

// Blueprint Section 8: preferred communication modes (text / voice note /
// call / in person). Confirmed a genuinely separate field from
// communication_style_openness (how soon someone shares personal
// things), not a naming overlap, has nothing to do with preferred
// channel. Multi-select, uncapped, same convention as availability
// above, not required for matching. Stored as
// profiles.communication_modes (text[]).
export const COMMUNICATION_MODES = ['Text', 'Voice note', 'Call', 'In person'];

export const COMMUNICATION_FREQ = [
  'A few times a day',
  'Daily',
  'A few times a week',
  'About once a week',
  'A few times a month',
];

export const MEETING_FREQ = ['Weekly', 'A few times a week', 'Every 2 weeks', 'Monthly', 'Every few months'];

export const RESPONSE_TIME = ['Within hours', 'Same day', '1-2 days', 'A few days'];

// Key/label only, profile-build.tsx's own ACTIVITY_CATEGORIES also has a
// nested set of follow-up questions per category that browse.tsx's filter
// never needs, only which category a person picked. The keys here must
// match ACTIVITY_CATEGORIES' keys exactly, that's the actual filtering
// contract, the label is just display text.
//
// Expanded from the original 18 with 22 more, flagged honestly: the
// request that added these said "expand from 18 to 35" (17 more) but then
// itemized 22 distinct categories with their own follow-up questions,
// 18 + 22 = 40, not 35. Built all 22 as given, since each came with its
// own real, itemized follow-up spec, dropping 5 of them to force the
// total to match the stated number would mean silently discarding real
// requirements to satisfy an arithmetic statement instead, the itemized
// list is the more specific and more clearly intentional of the two.
export const ACTIVITY_CATEGORY_OPTIONS: { key: string; label: string }[] = [
  { key: 'movies', label: 'Movies' },
  { key: 'music', label: 'Music' },
  { key: 'food', label: 'Food & dining' },
  { key: 'sports', label: 'Sports' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'travel', label: 'Travel' },
  { key: 'arts_culture', label: 'Arts & culture' },
  { key: 'games', label: 'Games' },
  { key: 'outdoors', label: 'Outdoors' },
  { key: 'reading', label: 'Reading' },
  { key: 'cooking', label: 'Cooking' },
  { key: 'volunteering', label: 'Volunteering' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'pets', label: 'Pets' },
  { key: 'technology', label: 'Technology' },
  { key: 'fashion', label: 'Fashion' },
  { key: 'photography', label: 'Photography' },
  { key: 'dancing', label: 'Dancing' },
  { key: 'yoga_pilates', label: 'Yoga / Pilates' },
  { key: 'wellness_mindfulness', label: 'Wellness / mindfulness / meditation' },
  { key: 'running_cycling', label: 'Running / cycling' },
  { key: 'tennis_pickleball', label: 'Tennis / pickleball' },
  { key: 'golf', label: 'Golf' },
  { key: 'martial_arts', label: 'Martial arts' },
  { key: 'wine_cocktails_beer', label: 'Wine / cocktails / craft beer' },
  { key: 'coffee_culture', label: 'Coffee culture' },
  { key: 'bbq_grilling', label: 'BBQ / grilling' },
  { key: 'writing_journaling', label: 'Writing / journaling' },
  { key: 'crafts', label: 'Crafts' },
  { key: 'collecting', label: 'Collecting' },
  { key: 'live_music', label: 'Live music / concerts' },
  { key: 'theater_performing_arts', label: 'Theater / performing arts' },
  { key: 'podcasts_audiobooks', label: 'Podcasts / audiobooks' },
  { key: 'history_learning', label: 'History / learning' },
  { key: 'spirituality_faith', label: 'Spirituality / faith' },
  { key: 'gardening_plants', label: 'Gardening / plants' },
  { key: 'environmental_activism', label: 'Environmental activism' },
  { key: 'self_improvement', label: 'Self-improvement / personal development' },
  { key: 'entrepreneurship', label: 'Entrepreneurship / side projects' },
  { key: 'comedy_live_shows', label: 'Comedy / live shows' },
];

// AGENTS.md: age filter is free for all users, open to all ages. Also
// reused as the bounds for the min/max friend age eligibility preference
// (Fix #1, July 19 reconciliation session), which uses the same 18-100
// range and matches profiles.min_friend_age/max_friend_age's own DB
// check constraints exactly.
export const MIN_AGE = 18;
export const MAX_AGE = 100;

// Public age bands (Fix #1): the only age-related value ever exposed to
// other users, exact age and birthdate are never selectable through
// discovery_profiles/browse_profiles at all anymore (see public.age_band()
// in 20260719000002). Browse's own age filter (previously two number
// inputs querying `age` directly) now works the same way as every other
// multi-select filter on that screen, filtering on this exact list of
// band values, matching public.age_band()'s own output exactly. "Under
// 18" is deliberately excluded, profiles.birthdate has a server-side
// 18+ check constraint, that band can never actually occur.
export const AGE_BANDS = ['18-24', '25-29', '30s', '40s', '50s', '60s', '70+'];

// Fix 2b: search radius slider bounds and default, profiles.
// search_radius_miles has a matching DB check (5-100).
export const MIN_SEARCH_RADIUS_MILES = 5;
export const MAX_SEARCH_RADIUS_MILES = 100;
export const DEFAULT_SEARCH_RADIUS_MILES = 30;

// Fix 2c: ethnicity, multi-select, optional, display only, never used for
// matching. "Other" is a real option like every other; selecting it
// reveals ethnicity_other for the accompanying free text, same pattern as
// life_transitions_other/values_other.
export const ETHNICITY_OPTIONS = [
  'Asian / Pacific Islander',
  'Black or African American',
  'Hispanic or Latino',
  'Middle Eastern or North African',
  'Native American or Indigenous',
  'White or Caucasian',
  'Multiracial or Mixed',
  'Other',
  'Prefer not to say',
];

// Fix 2d: languages, multi-select. "Other" reveals languages_other, same
// pattern as ethnicity above. Soft scoring weight in match suggestions
// (shared language, 5 points max).
export const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'Mandarin',
  'Cantonese',
  'Korean',
  'Japanese',
  'Vietnamese',
  'Tagalog',
  'French',
  'Portuguese',
  'Arabic',
  'Hindi',
  'Other',
];

// Fix 2e: friendship type, single select, required for matching.
export const FRIENDSHIP_TYPE_OPTIONS = [
  'Deep 1-on-1 connection',
  'Activity partner',
  'Someone to navigate this life stage with',
  'A social circle',
  'Open to whatever forms naturally',
];

// Fix 2f: communication style, two required scenario questions. Each
// option here is the short, storable label; the fuller description (the
// source instruction's own text after the em dash, replaced with a comma
// per the standing no-em-dash rule) is shown in the UI via the matching
// descriptions map below, not stored, this column only needs the label
// for scoring/filtering.
export const COMMUNICATION_STYLE_OPENNESS_OPTIONS = [
  'Pretty early',
  'After a few conversations',
  'Only after a long time',
];

export const COMMUNICATION_STYLE_OPENNESS_DESCRIPTIONS: Record<string, string> = {
  'Pretty early': 'I open up as conversation flows naturally',
  'After a few conversations': 'once I feel the person is trustworthy',
  'Only after a long time': 'I share personal things with very few people',
};

// Fix 1 (location cascade): country dropdown default and full option list.
// "United States" is placed first for quick access since it's the default
// selection and where every current seed profile is located, the rest is
// alphabetical. A standard list of UN member/observer states plus a
// handful of commonly-used non-UN entries (Taiwan, Kosovo), not an
// exhaustive ISO-3166 dump.
export const DEFAULT_LOCATION_COUNTRY = 'United States';

export const LOCATION_COUNTRIES = [
  'United States',
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas',
  'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
  'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon',
  'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia',
  'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
  'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia',
  'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
  'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique',
  'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand',
  'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea',
  'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands',
  'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain',
  'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan',
  'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'Uruguay',
  'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen',
  'Zambia', 'Zimbabwe',
];

// Full state/province dropdown data only exists for the United States,
// where every current seed profile is located and where this app's
// deepidv/Ticketmaster/Eventbrite integrations are scoped. Authoring an
// exhaustive subdivision list for all ~195 countries above is out of
// scope, so any other selected country falls back to a free-text state
// input in profile-build.tsx rather than a dropdown, a deliberate,
// documented narrowing of the "populates based on selected country"
// requirement.
export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Puerto Rico', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];
