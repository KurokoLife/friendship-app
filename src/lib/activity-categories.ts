// Activity categories and their optional follow-up questions, shared by
// profile build (input) and profiles (display).
//
// 2026-10-04 (docs/DECISIONS.md section 2): 40 categories became 32. Merged:
// Live shows (concerts, theater, comedy); Yoga, meditation & wellness;
// Drinks & nightlife; Cooking & grilling; Reading & podcasts; Learning &
// self-improvement; Volunteering & causes. "Arts & culture" is now
// "Museums & galleries". Stored keys were remapped by migration
// 20261004000000. Follow-ups are optional and collapsed in profile build,
// but shown on profiles when filled in: they are the most specific,
// askable things on a profile.

export type CategoryQuestion =
  | { type: 'chips'; field: string; multi: boolean; label: string; options: string[] }
  | { type: 'text'; field: string; label: string; placeholder: string };

export type ActivityCategory = {
  key: string;
  label: string;
  questions: CategoryQuestion[];
};

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  {
    key: 'movies', label: 'Movies',
    questions: [
      { type: 'chips', field: 'genres', multi: true, label: 'Which genres?', options: ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Documentary', 'Romance', 'Thriller', 'Animation', 'Foreign'] },
      { type: 'text', field: 'favorites', label: 'A few favorites', placeholder: 'Name a couple you love' },
    ],
  },
  {
    key: 'music', label: 'Music',
    questions: [
      { type: 'chips', field: 'genres', multi: true, label: 'Which genres?', options: ['Pop', 'Rock', 'Hip-Hop', 'Jazz', 'Classical', 'Country', 'Electronic', 'R&B', 'Folk', 'Metal'] },
      { type: 'text', field: 'favorite_artists', label: 'Favorite artists', placeholder: 'Who do you keep coming back to?' },
    ],
  },
  {
    key: 'food', label: 'Food & dining',
    questions: [
      { type: 'chips', field: 'cuisines', multi: true, label: 'Favorite cuisines?', options: ['Italian', 'Mexican', 'Japanese', 'Thai', 'Indian', 'Chinese', 'Mediterranean', 'American', 'French', 'Korean'] },
      { type: 'text', field: 'favorite_spots', label: 'Favorite spots', placeholder: 'Any go-to restaurants?' },
    ],
  },
  {
    key: 'sports', label: 'Sports',
    questions: [
      { type: 'chips', field: 'sports', multi: true, label: 'Which sports?', options: ['Basketball', 'Football', 'Soccer', 'Tennis', 'Golf', 'Baseball', 'Running', 'Cycling', 'Swimming', 'Yoga'] },
      { type: 'chips', field: 'play_or_watch', multi: false, label: 'Play or watch?', options: ['Play', 'Watch', 'Both'] },
    ],
  },
  {
    key: 'fitness', label: 'Fitness',
    questions: [
      { type: 'chips', field: 'types', multi: true, label: 'What kind?', options: ['Weightlifting', 'Running', 'Yoga', 'Pilates', 'HIIT', 'Cycling', 'Swimming', 'Climbing', 'Martial arts', 'Walking'] },
      { type: 'chips', field: 'frequency', multi: false, label: 'How often?', options: ['Daily', 'A few times a week', 'Weekly', 'Occasionally'] },
    ],
  },
  {
    key: 'travel', label: 'Travel',
    questions: [
      { type: 'chips', field: 'types', multi: true, label: 'What kind of travel?', options: ['Adventure', 'Beach', 'City breaks', 'Road trips', 'Backpacking', 'Luxury', 'Cultural', 'Nature & outdoors'] },
      { type: 'text', field: 'dream_destination', label: 'Dream destination', placeholder: 'Where would you go tomorrow?' },
    ],
  },
  {
    key: 'museums_galleries', label: 'Museums & galleries',
    questions: [
      { type: 'chips', field: 'interests', multi: true, label: 'What draws you in?', options: ['Art museums', 'History museums', 'Science museums', 'Galleries', 'Film festivals', 'Architecture'] },
      { type: 'text', field: 'favorites', label: 'A favorite', placeholder: 'An artist, exhibit, or place you loved' },
    ],
  },
  {
    key: 'games', label: 'Games',
    questions: [
      { type: 'chips', field: 'types', multi: true, label: 'What kind?', options: ['Video games', 'Board games', 'Card games', 'Puzzle games', 'Trivia', 'Tabletop RPGs'] },
      { type: 'text', field: 'favorites', label: 'Favorites', placeholder: 'What are you playing lately?' },
    ],
  },
  {
    key: 'outdoors', label: 'Outdoors',
    questions: [
      { type: 'chips', field: 'activities', multi: true, label: 'What do you like doing?', options: ['Hiking', 'Camping', 'Fishing', 'Kayaking', 'Rock climbing', 'Gardening', 'Beach days', 'Birdwatching'] },
      { type: 'text', field: 'favorite_spot', label: 'Favorite spot', placeholder: 'A trail, park, or place you love' },
    ],
  },
  {
    key: 'reading_podcasts', label: 'Reading & podcasts',
    questions: [
      { type: 'chips', field: 'genres', multi: true, label: 'What do you read or listen to?', options: ['Fiction', 'Non-fiction', 'Mystery', 'Sci-Fi/Fantasy', 'Biography', 'History', 'True crime', 'Science', 'Comedy', 'Poetry'] },
      { type: 'text', field: 'favorites', label: 'Currently reading or listening to', placeholder: "What's on your shelf or in your queue?" },
    ],
  },
  {
    key: 'cooking_grilling', label: 'Cooking & grilling',
    questions: [
      { type: 'chips', field: 'styles', multi: true, label: 'What do you like making?', options: ['Baking', 'Grilling & BBQ', 'Meal prep', 'Experimental', 'Comfort food', 'Healthy cooking', 'International cuisine'] },
      { type: 'text', field: 'specialty', label: 'Your specialty', placeholder: 'What do you make best?' },
    ],
  },
  {
    key: 'volunteering_causes', label: 'Volunteering & causes',
    questions: [
      { type: 'chips', field: 'causes', multi: true, label: 'What causes matter to you?', options: ['Animals', 'Environment', 'Community', 'Education', 'Healthcare', 'Food security', 'Elderly care', 'Local cleanups'] },
      { type: 'text', field: 'where', label: 'Where you volunteer', placeholder: 'Optional' },
    ],
  },
  {
    key: 'drinks_nightlife', label: 'Drinks & nightlife',
    questions: [
      { type: 'chips', field: 'preferences', multi: true, label: "What's your scene?", options: ['Wine', 'Cocktails', 'Craft beer', 'Quiet lounges', 'Live music venues', 'Dancing & clubs', 'Karaoke'] },
      { type: 'text', field: 'favorite_spot', label: 'Favorite spot', placeholder: 'Optional' },
    ],
  },
  {
    key: 'pets', label: 'Pets',
    questions: [
      { type: 'chips', field: 'types', multi: true, label: 'What kind?', options: ['Dogs', 'Cats', 'Birds', 'Fish', 'Reptiles', 'Small mammals', 'No pets'] },
      { type: 'text', field: 'about', label: 'Tell us about them', placeholder: 'Optional' },
    ],
  },
  {
    key: 'technology', label: 'Technology',
    questions: [
      { type: 'chips', field: 'interests', multi: true, label: 'What excites you?', options: ['Gadgets', 'Coding', 'AI', 'Gaming hardware', 'Photography tech', 'Home automation', 'Startups'] },
      { type: 'text', field: 'details', label: 'Tell us more', placeholder: 'Optional' },
    ],
  },
  {
    key: 'fashion', label: 'Fashion',
    questions: [
      { type: 'chips', field: 'style', multi: true, label: 'How would you describe your style?', options: ['Streetwear', 'Vintage', 'Minimalist', 'Sustainable fashion', 'Luxury', 'Casual', 'Thrifting'] },
      { type: 'text', field: 'favorites', label: 'Favorite brands or eras', placeholder: 'Optional' },
    ],
  },
  {
    key: 'photography', label: 'Photography',
    questions: [
      { type: 'chips', field: 'focus', multi: true, label: 'What do you shoot?', options: ['Portraits', 'Landscape', 'Street', 'Film', 'Travel', 'Wildlife', 'Editing'] },
      { type: 'text', field: 'gear_style', label: 'Your gear or style', placeholder: 'Optional' },
    ],
  },
  {
    key: 'dancing', label: 'Dancing',
    questions: [
      { type: 'chips', field: 'styles', multi: true, label: 'What styles?', options: ['Salsa', 'Hip-hop', 'Ballroom', 'Contemporary', 'Swing', 'Line dancing', 'Just for fun'] },
      { type: 'text', field: 'where', label: 'Where you like to dance', placeholder: 'Optional' },
    ],
  },
  {
    key: 'yoga_wellness', label: 'Yoga, meditation & wellness',
    questions: [
      { type: 'chips', field: 'practices', multi: true, label: 'What practices?', options: ['Yoga', 'Pilates', 'Meditation', 'Breathwork', 'Journaling', 'Sound baths', 'Other'] },
      { type: 'text', field: 'favorite_practice', label: 'Favorite studio or practice', placeholder: 'Optional' },
    ],
  },
  {
    key: 'running_cycling', label: 'Running / cycling',
    questions: [
      { type: 'chips', field: 'which', multi: false, label: 'Which?', options: ['Running', 'Cycling', 'Both'] },
      { type: 'text', field: 'level', label: 'Casual or training for events?', placeholder: 'Optional' },
    ],
  },
  {
    key: 'tennis_pickleball', label: 'Tennis / pickleball',
    questions: [
      { type: 'chips', field: 'which', multi: false, label: 'Which?', options: ['Tennis', 'Pickleball', 'Both'] },
      { type: 'chips', field: 'skill_level', multi: false, label: 'Skill level', options: ['Beginner', 'Intermediate', 'Advanced'] },
    ],
  },
  {
    key: 'golf', label: 'Golf',
    questions: [
      { type: 'chips', field: 'style', multi: false, label: 'Casual or serious?', options: ['Casual', 'Serious'] },
      { type: 'text', field: 'favorite_course', label: 'Favorite type of course', placeholder: 'Optional' },
    ],
  },
  {
    key: 'martial_arts', label: 'Martial arts',
    questions: [
      { type: 'chips', field: 'discipline', multi: false, label: 'Which discipline?', options: ['Judo', 'BJJ', 'Boxing', 'Muay Thai', 'Karate', 'Other'] },
    ],
  },
  {
    key: 'coffee_culture', label: 'Coffee culture',
    questions: [
      { type: 'chips', field: 'style', multi: false, label: 'Pour over or espresso?', options: ['Pour over', 'Espresso', 'Both'] },
      { type: 'text', field: 'favorite_spots', label: 'Favorite local spots', placeholder: 'Optional' },
    ],
  },
  {
    key: 'writing_journaling', label: 'Writing / journaling',
    questions: [
      { type: 'chips', field: 'kind', multi: true, label: 'What kind?', options: ['Personal journaling', 'Creative writing', 'Blogging', 'Other'] },
    ],
  },
  {
    key: 'crafts', label: 'Crafts',
    questions: [
      { type: 'chips', field: 'type', multi: true, label: 'What type?', options: ['Knitting', 'Crocheting', 'Pottery', 'DIY/home projects', 'Painting', 'Drawing', 'Other'] },
    ],
  },
  {
    key: 'collecting', label: 'Collecting',
    questions: [
      { type: 'chips', field: 'items', multi: true, label: 'What do you collect?', options: ['Vinyl records', 'Art', 'Vintage items', 'Antiques', 'Books', 'Other'] },
    ],
  },
  {
    key: 'live_shows', label: 'Live shows (concerts, theater, comedy)',
    questions: [
      { type: 'chips', field: 'type', multi: true, label: 'What kind?', options: ['Concerts', 'Musicals', 'Plays', 'Stand-up comedy', 'Improv', 'Dance performances', 'Opera'] },
      { type: 'text', field: 'favorites', label: 'A favorite artist, show, or venue', placeholder: 'Optional' },
    ],
  },
  {
    key: 'learning_growth', label: 'Learning & self-improvement',
    questions: [
      { type: 'chips', field: 'areas', multi: true, label: 'What areas?', options: ['History', 'Science', 'Philosophy', 'Politics', 'Languages', 'Books', 'Courses', 'Habits', 'Other'] },
      { type: 'text', field: 'currently_learning', label: "Something you're learning right now", placeholder: 'Optional' },
    ],
  },
  {
    key: 'spirituality_faith', label: 'Spirituality / faith',
    questions: [
      { type: 'text', field: 'tradition', label: 'What tradition or practice?', placeholder: 'Optional, shared only if you want to' },
    ],
  },
  {
    key: 'gardening_plants', label: 'Gardening / plants',
    questions: [
      { type: 'chips', field: 'setting', multi: false, label: 'Indoor plants, outdoor garden, or both?', options: ['Indoor plants', 'Outdoor garden', 'Both'] },
      { type: 'text', field: 'what_you_grow', label: 'What do you grow?', placeholder: 'Optional' },
    ],
  },
  {
    key: 'entrepreneurship', label: 'Entrepreneurship / side projects',
    questions: [
      { type: 'text', field: 'working_on', label: 'What are you working on?', placeholder: 'Optional' },
    ],
  },
];

export function activityCategoryLabel(key: string): string {
  return ACTIVITY_CATEGORIES.find((c) => c.key === key)?.label ?? key.replace(/_/g, ' ');
}

// Every filled-in follow-up for one category as short display lines.
// Fields from before the merge that the new questions don't ask anymore
// still show, as plain values.
export function activityDetailLines(
  key: string,
  detail: Record<string, string[] | string> | undefined
): string[] {
  if (!detail) return [];
  const category = ACTIVITY_CATEGORIES.find((c) => c.key === key);
  const lines: string[] = [];
  for (const [field, raw] of Object.entries(detail)) {
    const value = Array.isArray(raw) ? raw.filter(Boolean).join(', ') : (raw ?? '').trim();
    if (!value) continue;
    const question = category?.questions.find((q) => q.field === field);
    lines.push(question ? `${question.label.replace(/\?$/, '')}: ${value}` : value);
  }
  return lines;
}
