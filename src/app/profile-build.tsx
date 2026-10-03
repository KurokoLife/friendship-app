import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { CARE_STYLE_EXAMPLES, CARE_STYLE_MAX_LENGTH, CARE_STYLE_PROMPT } from '@/lib/care-style';
import { StoriesEditor } from '@/components/stories-editor';
import { normalizeStories, type Story } from '@/lib/stories';
import { UniversalTextBox } from '@/components/universal-text-box';
import { VoiceTextInput } from '@/components/voice-text-input';
import {
  AVAILABILITY,
  COMMUNICATION_FREQ,
  COMMUNICATION_MODES,
  COMMUNICATION_STYLE_OPENNESS_DESCRIPTIONS,
  COMMUNICATION_STYLE_OPENNESS_OPTIONS,
  DEFAULT_LOCATION_COUNTRY,
  DEFAULT_SEARCH_RADIUS_MILES,
  ETHNICITY_OPTIONS,
  FRIENDSHIP_TYPE_OPTIONS,
  HANGOUT_PEOPLE,
  HANGOUT_TYPES,
  LANGUAGE_OPTIONS,
  LIFE_TRANSITIONS,
  LOCATION_COUNTRIES,
  MAX_SEARCH_RADIUS_MILES,
  MEETING_FREQ,
  MIN_SEARCH_RADIUS_MILES,
  RESPONSE_TIME,
  US_STATES,
} from '@/lib/filter-options';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const MAX_VALUES = 10;

const VALUES_OPTIONS = [
  'Honesty', 'Humor', 'Family', 'Adventure', 'Stability',
  'Creativity', 'Spirituality', 'Community', 'Growth', 'Ambition',
  'Loyalty', 'Independence', 'Kindness', 'Authenticity', 'Curiosity',
  'Resilience', 'Security', 'Simplicity', 'Connection', 'Purpose',
  'Health', 'Compassion', 'Gratitude', 'Balance', 'Wisdom',
  'Courage', 'Generosity', 'Patience', 'Openness', 'Playfulness',
];

const BAR_PREFERENCE = ['I drink', "I don't drink", 'No preference'];
const SIXTEEN_TYPES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
];

type CategoryQuestion =
  | { type: 'chips'; field: string; multi: boolean; label: string; options: string[] }
  | { type: 'text'; field: string; label: string; placeholder: string };

type ActivityCategory = {
  key: string;
  label: string;
  questions: CategoryQuestion[];
};

const ACTIVITY_CATEGORIES: ActivityCategory[] = [
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
    key: 'arts_culture', label: 'Arts & culture',
    questions: [
      { type: 'chips', field: 'interests', multi: true, label: 'What draws you in?', options: ['Museums', 'Theater', 'Live music', 'Galleries', 'Film festivals', 'Opera', 'Poetry', 'Literature'] },
      { type: 'text', field: 'favorites', label: 'A favorite', placeholder: 'An artist, show, or exhibit you loved' },
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
    key: 'reading', label: 'Reading',
    questions: [
      { type: 'chips', field: 'genres', multi: true, label: 'What do you read?', options: ['Fiction', 'Non-fiction', 'Mystery', 'Sci-Fi/Fantasy', 'Biography', 'Self-help', 'History', 'Poetry'] },
      { type: 'text', field: 'favorites', label: 'Currently reading or a favorite', placeholder: "What's on your shelf?" },
    ],
  },
  {
    key: 'cooking', label: 'Cooking',
    questions: [
      { type: 'chips', field: 'styles', multi: true, label: 'What do you like making?', options: ['Baking', 'Grilling', 'Meal prep', 'Experimental', 'Comfort food', 'Healthy cooking', 'International cuisine'] },
      { type: 'text', field: 'specialty', label: 'Your specialty', placeholder: 'What do you make best?' },
    ],
  },
  {
    key: 'volunteering', label: 'Volunteering',
    questions: [
      { type: 'chips', field: 'causes', multi: true, label: 'What causes matter to you?', options: ['Animals', 'Environment', 'Community', 'Education', 'Healthcare', 'Food security', 'Elderly care'] },
      { type: 'text', field: 'where', label: 'Where you volunteer', placeholder: 'Optional' },
    ],
  },
  {
    key: 'nightlife', label: 'Nightlife',
    questions: [
      { type: 'chips', field: 'preferences', multi: true, label: "What's your scene?", options: ['Bars', 'Live music venues', 'Dancing & clubs', 'Comedy shows', 'Quiet lounges', 'Karaoke'] },
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
  // 22 categories added below, expanding from 18 to 40 total, see the
  // count discrepancy noted in filter-options.ts (the request said "35"
  // but itemized 22, built all 22 as given).
  {
    key: 'yoga_pilates', label: 'Yoga / Pilates',
    questions: [
      { type: 'chips', field: 'style', multi: false, label: 'What style?', options: ['Hatha', 'Vinyasa', 'Hot yoga', 'Pilates reformer', 'Other'] },
      { type: 'text', field: 'favorite_practice', label: 'Favorite studio or practice', placeholder: 'Optional' },
    ],
  },
  {
    key: 'wellness_mindfulness', label: 'Wellness / mindfulness / meditation',
    questions: [
      { type: 'chips', field: 'practices', multi: true, label: 'What practices?', options: ['Meditation', 'Breathwork', 'Journaling', 'Sound baths', 'Other'] },
      { type: 'text', field: 'frequency', label: 'How often do you practice?', placeholder: 'Optional' },
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
    // Given follow-up options were "Yoga, BJJ, Boxing, Muay Thai, Karate,
    // Other", Yoga isn't a martial art and the other five options are all
    // real combat disciplines, almost certainly meant to say Judo. Fixed
    // rather than shipping a known error, flagged here and in PROGRESS.md.
    key: 'martial_arts', label: 'Martial arts',
    questions: [
      { type: 'chips', field: 'discipline', multi: false, label: 'Which discipline?', options: ['Judo', 'BJJ', 'Boxing', 'Muay Thai', 'Karate', 'Other'] },
    ],
  },
  {
    key: 'wine_cocktails_beer', label: 'Wine / cocktails / craft beer',
    questions: [
      { type: 'chips', field: 'preference', multi: false, label: "What's your preference?", options: ['Wine', 'Cocktails', 'Craft beer', 'All three'] },
      { type: 'text', field: 'favorites', label: 'Favorite spots or styles', placeholder: 'Optional' },
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
    key: 'bbq_grilling', label: 'BBQ / grilling',
    questions: [
      { type: 'chips', field: 'role', multi: false, label: 'Backyard cook or restaurant seeker?', options: ['Backyard cook', 'Restaurant seeker', 'Both'] },
      { type: 'chips', field: 'style', multi: false, label: 'Favorite style', options: ['Texas', 'Korean', 'American', 'Other'] },
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
    key: 'live_music', label: 'Live music / concerts',
    questions: [
      { type: 'text', field: 'genres', label: 'What genres?', placeholder: 'Optional' },
      { type: 'chips', field: 'venues', multi: false, label: 'Venues', options: ['Small clubs', 'Large arenas', 'Outdoor festivals', 'All'] },
    ],
  },
  {
    key: 'theater_performing_arts', label: 'Theater / performing arts',
    questions: [
      { type: 'chips', field: 'type', multi: true, label: 'What type?', options: ['Broadway/musicals', 'Drama', 'Comedy', 'Opera', 'Dance performances', 'All'] },
    ],
  },
  {
    key: 'podcasts_audiobooks', label: 'Podcasts / audiobooks',
    questions: [
      { type: 'chips', field: 'genres', multi: true, label: 'Favorite genres?', options: ['True crime', 'History', 'Self-improvement', 'Comedy', 'Science', 'Fiction', 'Other'] },
    ],
  },
  {
    key: 'history_learning', label: 'History / learning',
    questions: [
      { type: 'chips', field: 'areas', multi: true, label: 'What areas?', options: ['Ancient history', 'Modern history', 'Science', 'Philosophy', 'Politics', 'Other'] },
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
    key: 'environmental_activism', label: 'Environmental activism',
    questions: [
      { type: 'chips', field: 'involvement', multi: true, label: 'How do you get involved?', options: ['Local cleanups', 'Advocacy', 'Sustainable living', 'Conservation', 'Other'] },
    ],
  },
  {
    key: 'self_improvement', label: 'Self-improvement / personal development',
    questions: [
      { type: 'chips', field: 'areas', multi: true, label: 'What areas?', options: ['Books', 'Coaching', 'Therapy', 'Courses', 'Habits', 'Other'] },
    ],
  },
  {
    key: 'entrepreneurship', label: 'Entrepreneurship / side projects',
    questions: [
      { type: 'text', field: 'working_on', label: 'What are you working on?', placeholder: 'Optional' },
    ],
  },
  {
    key: 'comedy_live_shows', label: 'Comedy / live shows',
    questions: [
      { type: 'chips', field: 'type', multi: true, label: 'What type?', options: ['Stand-up comedy', 'Improv', 'Live talk shows', 'Other'] },
    ],
  },
];

type ActivityDetails = Record<string, Record<string, string[] | string>>;

type ProfileFormState = {
  lifeTransitions: string[];
  lifeTransitionsOther: string;
  personalStatement: string;
  // Limen v2: "How I like care", the user's own words (optional).
  careStyle: string;
  // Limen v2: 2-3 short stories in the user's own words.
  stories: Story[];
  values: string[];
  valuesOther: string;
  activityCategories: string[];
  activityDetails: ActivityDetails;
  activityOther: string;
  hangoutPeoplePreference: string | null;
  hangoutTypePreference: string[];
  communicationFreq: string | null;
  meetingFreq: string | null;
  responseTime: string | null;
  barPreference: string | null;
  dealbreakers: string;
  personality16p: string | null;
  photoUrl: string | null;
  locationCity: string;
  locationState: string;
  locationCountry: string;
  locationLat: number | null;
  locationLng: number | null;
  searchRadiusMiles: number;
  ethnicity: string[];
  ethnicityOther: string;
  languages: string[];
  languagesOther: string;
  friendshipType: string | null;
  communicationStyleOpenness: string | null;
  availability: string[];
  communicationModes: string[];
};

const EMPTY_PROFILE: ProfileFormState = {
  lifeTransitions: [],
  lifeTransitionsOther: '',
  personalStatement: '',
  careStyle: '',
  stories: [],
  values: [],
  valuesOther: '',
  activityCategories: [],
  activityDetails: {},
  activityOther: '',
  hangoutPeoplePreference: null,
  hangoutTypePreference: [],
  communicationFreq: null,
  meetingFreq: null,
  responseTime: null,
  barPreference: null,
  dealbreakers: '',
  personality16p: null,
  photoUrl: null,
  locationCity: '',
  locationState: '',
  locationCountry: DEFAULT_LOCATION_COUNTRY,
  locationLat: null,
  locationLng: null,
  searchRadiusMiles: DEFAULT_SEARCH_RADIUS_MILES,
  ethnicity: [],
  ethnicityOther: '',
  languages: [],
  languagesOther: '',
  friendshipType: null,
  communicationStyleOpenness: null,
  availability: [],
  communicationModes: [],
};

const COMPLETION_THRESHOLD = 60;

function computeCompletionPct(p: ProfileFormState) {
  const checks = [
    p.lifeTransitions.length > 0,
    p.personalStatement.trim().length > 0,
    p.values.length > 0,
    p.activityCategories.length > 0,
    Boolean(p.hangoutPeoplePreference),
    p.hangoutTypePreference.length > 0,
    Boolean(p.communicationFreq),
    Boolean(p.meetingFreq),
    Boolean(p.responseTime),
    Boolean(p.barPreference),
    p.dealbreakers.trim().length > 0,
    Boolean(p.photoUrl),
    Boolean(p.locationLat && p.locationLng),
    Boolean(p.friendshipType),
    Boolean(p.communicationStyleOpenness),
    p.availability.length > 0,
    p.communicationModes.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function completionMessage(pct: number) {
  if (pct >= 100) return 'Your profile is complete.';
  if (pct >= 80) return 'Almost there.';
  if (pct >= COMPLETION_THRESHOLD) return "You're ready to continue. Keep going for a fuller profile.";
  return "A little more and you'll be ready to continue.";
}

// These drive matching directly, so they're not optional the way the rest
// of the profile is. No completion percentage lets you skip them.
// life_transitions joined this list per explicit instruction ("required
// for matching"), it wasn't hard-blocked before this update.
//
// 2026-07-29, onboarding pagination: each check now also carries which
// paginated step it lives on (STEP_LOCATION etc., defined below), the
// single source of truth both getMissingRequiredFields (unchanged output,
// same set of checks, same messages) and the new per-step
// getMissingRequiredFieldsForStep derive from, so restructuring the
// screen into steps can't silently change which fields are required or
// what they're called, exactly the same checks, just newly tagged.
const STEP_LOCATION = 0;
const STEP_WHAT_BRINGS_YOU_HERE = 1;
const STEP_ABOUT_YOU = 2;
const STEP_VALUES = 3;
const STEP_INTERESTS = 4;
const STEP_HANGOUT_STYLE = 5;
const STEP_FRIENDSHIP_TYPE_AND_RHYTHM = 6;
const STEP_COMMUNICATION_STYLE = 7;
const STEP_LANGUAGES_ETHNICITY_16P = 8;
const STEP_PHOTO = 9;
const TOTAL_STEPS = 10;

type RequiredFieldCheck = { step: number; message: string; isMissing: (p: ProfileFormState) => boolean };

const REQUIRED_FIELD_CHECKS: RequiredFieldCheck[] = [
  // Location is required (Fix 2a) specifically as a confirmed geocode, not
  // just typed text, everything downstream (radius filtering) depends on
  // real lat/lng, not the raw city string.
  { step: STEP_LOCATION, message: 'Location', isMissing: (p) => !(p.locationLat && p.locationLng) },
  {
    step: STEP_WHAT_BRINGS_YOU_HERE,
    message: 'What brings you here',
    isMissing: (p) => p.lifeTransitions.length === 0,
  },
  {
    step: STEP_HANGOUT_STYLE,
    message: 'How you hang out with a new friend',
    isMissing: (p) => !p.hangoutPeoplePreference,
  },
  {
    step: STEP_HANGOUT_STYLE,
    message: 'How you hang out',
    isMissing: (p) => p.hangoutTypePreference.length === 0,
  },
  {
    step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM,
    message: 'What kind of friendship you are hoping to build',
    isMissing: (p) => !p.friendshipType,
  },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, message: 'Check-in frequency', isMissing: (p) => !p.communicationFreq },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, message: 'Meeting frequency', isMissing: (p) => !p.meetingFreq },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, message: 'Response time', isMissing: (p) => !p.responseTime },
  {
    step: STEP_COMMUNICATION_STYLE,
    message: 'Communication style',
    isMissing: (p) => !p.communicationStyleOpenness,
  },
];

function getMissingRequiredFields(p: ProfileFormState): string[] {
  return REQUIRED_FIELD_CHECKS.filter((c) => c.isMissing(p)).map((c) => c.message);
}

function getMissingRequiredFieldsForStep(p: ProfileFormState, step: number): string[] {
  return REQUIRED_FIELD_CHECKS.filter((c) => c.step === step && c.isMissing(p)).map((c) => c.message);
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-4 py-2 ${
        selected
          ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
          : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text
        className={`text-caption ${
          selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-700 dark:text-stone-300'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  subtitle,
  children,
  nested,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  nested?: boolean;
}) {
  return (
    <View
      className={`gap-3 rounded-2xl border p-5 ${
        nested
          ? 'border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-800/60'
          : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
      }`}>
      <Text className="text-title text-stone-900 dark:text-stone-50">{title}</Text>
      {subtitle && <Text className="text-caption text-stone-500 dark:text-stone-400">{subtitle}</Text>}
      {children}
    </View>
  );
}

export default function ProfileBuildScreen() {
  // Fix 4: this screen doubles as the Profile tab's edit mode
  // (`/profile-build?from=profile`), reusing the exact same onboarding
  // UI and per-field autosave rather than building a second edit form.
  // Since autosave already writes to Supabase as the user types, "Cancel"
  // needs a real snapshot of the profile as it was when edit mode was
  // entered, to actually discard changes rather than just navigating away
  // from already-saved ones.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isEditMode = from === 'profile';
  const [originalProfile, setOriginalProfile] = useState<ProfileFormState | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [profile, setProfile] = useState<ProfileFormState>(EMPTY_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptedContinue, setAttemptedContinue] = useState(false);
  // Onboarding pagination (2026-07-29): fresh onboarding only, edit mode
  // (isEditMode) keeps rendering every section at once, unchanged, see
  // this file's own header note on that scope decision. `step` only ever
  // matters when !isEditMode, every render/handler below checks
  // isEditMode first.
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        const activityInterests = (data.activity_interests as {
          categories?: string[];
          details?: ActivityDetails;
          other?: string;
        }) ?? {};
        const loadedProfile: ProfileFormState = {
          lifeTransitions: data.life_transitions ?? [],
          lifeTransitionsOther: data.life_transitions_other ?? '',
          personalStatement: data.personal_statement ?? '',
          careStyle: data.care_style ?? '',
          stories: normalizeStories(data.stories),
          values: data.values ?? [],
          valuesOther: data.values_other ?? '',
          activityCategories: activityInterests.categories ?? [],
          activityDetails: activityInterests.details ?? {},
          activityOther: activityInterests.other ?? '',
          hangoutPeoplePreference: data.hangout_people_preference,
          hangoutTypePreference: data.hangout_type_preference ?? [],
          communicationFreq: data.communication_freq,
          meetingFreq: data.meeting_freq,
          responseTime: data.response_time,
          barPreference: data.bar_preference,
          dealbreakers: data.dealbreakers ?? '',
          personality16p: data.personality_16p,
          photoUrl: data.photo_url,
          locationCity: data.location_city ?? '',
          locationState: data.location_state ?? '',
          locationCountry: data.location_country ?? DEFAULT_LOCATION_COUNTRY,
          locationLat: data.location_lat ?? null,
          locationLng: data.location_lng ?? null,
          searchRadiusMiles: data.search_radius_miles ?? DEFAULT_SEARCH_RADIUS_MILES,
          ethnicity: data.ethnicity ?? [],
          ethnicityOther: data.ethnicity_other ?? '',
          languages: data.languages ?? [],
          languagesOther: data.languages_other ?? '',
          friendshipType: data.friendship_type,
          communicationStyleOpenness: data.communication_style_openness,
          availability: data.availability ?? [],
          communicationModes: data.communication_modes ?? [],
        };
        setProfile(loadedProfile);
        setOriginalProfile(loadedProfile);
      }
      setLoaded(true);
    })();
  }, []);

  const handleCancelEdit = async () => {
    if (!originalProfile) {
      router.replace('/profile');
      return;
    }
    setCancelling(true);
    await persist(originalProfile);
    setCancelling(false);
    router.replace('/profile');
  };

  const completionPct = computeCompletionPct(profile);
  const missingRequiredFields = getMissingRequiredFields(profile);
  const canContinue =
    completionPct >= COMPLETION_THRESHOLD && missingRequiredFields.length === 0 && isSupabaseConfigured;

  // Per-step gate for the "Next" button, only relevant outside edit mode.
  // The overall 60%-completion soft threshold (COMPLETION_THRESHOLD) was
  // never tied to any one field or section, it's an aggregate across the
  // whole profile including optional fields, so it stays a final-step-only
  // check (canContinue above), unchanged, exactly matching current
  // behavior rather than inventing a new per-step soft gate nobody asked
  // for. Hard-required fields, by contrast, now block at the step they
  // actually live on, per instruction ("not just at the end").
  const isLastStep = step === TOTAL_STEPS - 1;
  const stepMissingFields = getMissingRequiredFieldsForStep(profile, step);
  const canAdvanceStep = isLastStep ? canContinue : stepMissingFields.length === 0;

  const handleStepNext = () => {
    if (!canAdvanceStep) {
      setAttemptedContinue(true);
      return;
    }
    if (isLastStep) {
      router.replace(isEditMode ? '/profile' : '/big-five-assessment');
      return;
    }
    setAttemptedContinue(false);
    setStep((s) => s + 1);
  };

  const handleStepBack = () => {
    if (step === 0) {
      router.replace('/social-linking');
      return;
    }
    setAttemptedContinue(false);
    setStep((s) => s - 1);
  };

  const persist = async (next: ProfileFormState) => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    setSaving(true);
    const { error: saveError } = await supabase.from('profiles').upsert({
      user_id: user.id,
      life_transitions: next.lifeTransitions,
      life_transitions_other: next.lifeTransitionsOther.trim() || null,
      personal_statement: next.personalStatement || null,
      care_style: next.careStyle.trim().slice(0, CARE_STYLE_MAX_LENGTH) || null,
      stories: next.stories.filter((st) => st.text.trim().length > 0 || st.prompt_key),
      values: next.values,
      values_other: next.valuesOther.trim() || null,
      activity_interests: {
        categories: next.activityCategories,
        details: next.activityDetails,
        ...(next.activityOther.trim() ? { other: next.activityOther.trim() } : {}),
      },
      hangout_people_preference: next.hangoutPeoplePreference,
      hangout_type_preference: next.hangoutTypePreference,
      communication_freq: next.communicationFreq,
      meeting_freq: next.meetingFreq,
      response_time: next.responseTime,
      bar_preference: next.barPreference,
      dealbreakers: next.dealbreakers || null,
      personality_16p: next.personality16p,
      photo_url: next.photoUrl,
      location_city: next.locationCity.trim() || null,
      location_state: next.locationState.trim() || null,
      location_country: next.locationCountry || DEFAULT_LOCATION_COUNTRY,
      location_lat: next.locationLat,
      location_lng: next.locationLng,
      search_radius_miles: next.searchRadiusMiles,
      ethnicity: next.ethnicity,
      ethnicity_other: next.ethnicityOther.trim() || null,
      languages: next.languages,
      languages_other: next.languagesOther.trim() || null,
      friendship_type: next.friendshipType,
      communication_style_openness: next.communicationStyleOpenness,
      availability: next.availability,
      communication_modes: next.communicationModes,
      completion_pct: computeCompletionPct(next),
    });
    setSaving(false);
    if (saveError) setError(saveError.message);
  };

  const updateAndSave = (patch: Partial<ProfileFormState>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    persist(next);
  };

  const toggleValue = (option: string) => {
    const selected = profile.values.includes(option);
    if (!selected && profile.values.length >= MAX_VALUES) return;
    const next = selected ? profile.values.filter((v) => v !== option) : [...profile.values, option];
    updateAndSave({ values: next });
  };

  // Life transitions selection limit removed entirely (2026-07-16), any
  // number of the preset options can be selected. "Something else" is
  // gone from the option list itself, replaced by the separate
  // lifeTransitionsOther free-text field below, display only, never fed
  // into match scoring.
  const toggleLifeTransition = (option: string) => {
    const selected = profile.lifeTransitions.includes(option);
    const next = selected
      ? profile.lifeTransitions.filter((t) => t !== option)
      : [...profile.lifeTransitions, option];
    updateAndSave({ lifeTransitions: next });
  };

  const toggleCategory = (key: string) => {
    const next = profile.activityCategories.includes(key)
      ? profile.activityCategories.filter((c) => c !== key)
      : [...profile.activityCategories, key];
    updateAndSave({ activityCategories: next });
  };

  const updateActivityDetail = (categoryKey: string, field: string, value: string[] | string) => {
    updateAndSave({
      activityDetails: {
        ...profile.activityDetails,
        [categoryKey]: { ...(profile.activityDetails[categoryKey] || {}), [field]: value },
      },
    });
  };

  const toggleActivityChip = (categoryKey: string, field: string, option: string, multi: boolean) => {
    if (multi) {
      const current = (profile.activityDetails[categoryKey]?.[field] as string[]) || [];
      let next: string[];
      // Pets' "What kind?" question is the one multi-select chip list in
      // this whole section where two options are logically exclusive:
      // "No pets" and any real pet type can't both be true at once.
      // Scoped to this one category/field rather than a generic rule,
      // every other multi-select category here has no such conflict.
      if (categoryKey === 'pets' && field === 'types') {
        if (option === 'No pets') {
          next = current.includes('No pets') ? [] : ['No pets'];
        } else {
          const withoutNoPets = current.filter((v) => v !== 'No pets');
          next = withoutNoPets.includes(option)
            ? withoutNoPets.filter((v) => v !== option)
            : [...withoutNoPets, option];
        }
      } else {
        next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
      }
      updateActivityDetail(categoryKey, field, next);
    } else {
      const current = profile.activityDetails[categoryKey]?.[field] as string | undefined;
      updateActivityDetail(categoryKey, field, current === option ? '' : option);
    }
  };

  // Selection limit removed entirely (2026-07-16), any number of the
  // hangout type options can be selected.
  const toggleHangoutType = (option: string) => {
    const selected = profile.hangoutTypePreference.includes(option);
    const next = selected
      ? profile.hangoutTypePreference.filter((v) => v !== option)
      : [...profile.hangoutTypePreference, option];
    updateAndSave({ hangoutTypePreference: next });
  };

  // Availability and communication modes, both uncapped multi-select,
  // same no-limit reasoning as hangout type above.
  const toggleAvailability = (option: string) => {
    const selected = profile.availability.includes(option);
    const next = selected
      ? profile.availability.filter((v) => v !== option)
      : [...profile.availability, option];
    updateAndSave({ availability: next });
  };

  const toggleCommunicationMode = (option: string) => {
    const selected = profile.communicationModes.includes(option);
    const next = selected
      ? profile.communicationModes.filter((v) => v !== option)
      : [...profile.communicationModes, option];
    updateAndSave({ communicationModes: next });
  };

  // Fix 2c/2d: ethnicity and languages, no selection cap given, unlike
  // values/life transitions this was never asked to be limited.
  const toggleEthnicity = (option: string) => {
    const next = profile.ethnicity.includes(option)
      ? profile.ethnicity.filter((v) => v !== option)
      : [...profile.ethnicity, option];
    updateAndSave({ ethnicity: next });
  };

  const toggleLanguage = (option: string) => {
    const next = profile.languages.includes(option)
      ? profile.languages.filter((v) => v !== option)
      : [...profile.languages, option];
    updateAndSave({ languages: next });
  };

  // Fix 1 (2026-07-17): country/state/city is now a structured cascade
  // instead of one free-text field, so two people can no longer end up
  // stored as "los angeles, ca" and "Los Angeles, CA" for the same place.
  // Country and (for the US, which is the only country with a full
  // subdivision list, see filter-options.ts) state are chosen from a
  // picker; city stays free text since an exhaustive per-state city list
  // isn't feasible. Confirm geocodes the combination via the geocode-city
  // Edge Function (OpenStreetMap Nominatim, done server-side per its usage
  // policy, see that function's own comments), which now also returns
  // Nominatim's own normalized city/state/country strings, replacing
  // whatever capitalization/spelling the user typed with a standardized
  // value. A real, confirmed lat/lng is required for matching (see
  // getMissingRequiredFields), not just typed text, radius filtering has
  // nothing to compare against otherwise.
  const [geocoding, setGeocoding] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<'country' | 'state' | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  // Fix 2 (2026-07-17): a second path alongside the state/city cascade,
  // a single zip code that geocode-city resolves to city/state/lat/lng on
  // its own. locationZip is deliberately not part of ProfileFormState,
  // it's never stored, only city/state/country/lat/lng are, per explicit
  // instruction that both paths resolve to the same stored fields.
  const [locationEntryMode, setLocationEntryMode] = useState<'state_city' | 'zip'>('state_city');
  const [locationZip, setLocationZip] = useState('');

  const pickerOptions = activePicker === 'country' ? LOCATION_COUNTRIES : activePicker === 'state' ? US_STATES : [];
  const filteredPickerOptions = pickerSearch.trim()
    ? pickerOptions.filter((o) => o.toLowerCase().includes(pickerSearch.trim().toLowerCase()))
    : pickerOptions;

  const closePicker = () => {
    setActivePicker(null);
    setPickerSearch('');
  };

  // Changing country resets state (a state picked for the old country
  // isn't meaningful for the new one) and clears any prior geocode
  // confirmation, since the location has fundamentally changed and
  // shouldn't keep reading as "confirmed" until re-confirmed.
  const selectCountry = (country: string) => {
    updateAndSave({ locationCountry: country, locationState: '', locationLat: null, locationLng: null });
    closePicker();
  };

  const selectState = (state: string) => {
    updateAndSave({ locationState: state, locationLat: null, locationLng: null });
    closePicker();
  };

  // Switching entry mode without re-confirming would otherwise leave a
  // stale lat/lng sitting under whichever fields are now showing, same
  // reasoning as clearing it on any city/state/country edit above.
  const selectEntryMode = (mode: 'state_city' | 'zip') => {
    setLocationEntryMode(mode);
    setProfile((p) => ({ ...p, locationLat: null, locationLng: null }));
    setLocationError(null);
  };

  const confirmLocation = async () => {
    setLocationError(null);

    if (locationEntryMode === 'zip') {
      const zip = locationZip.trim();
      if (!zip) {
        setLocationError('Enter a zip code first.');
        return;
      }
      setGeocoding(true);
      const { data, error: fnError } = await supabase.functions.invoke('geocode-city', {
        body: { zip, country: profile.locationCountry },
      });
      setGeocoding(false);
      if (fnError || !data?.lat || !data?.lng) {
        setLocationError("We couldn't find that zip code. Double check it and try again.");
        return;
      }
      updateAndSave({
        locationCity: data.city || '',
        locationState: data.state || '',
        locationCountry: data.country || profile.locationCountry,
        locationLat: data.lat,
        locationLng: data.lng,
      });
      return;
    }

    const city = profile.locationCity.trim();
    if (!city) {
      setLocationError('Enter a city first.');
      return;
    }
    setGeocoding(true);
    const { data, error: fnError } = await supabase.functions.invoke('geocode-city', {
      body: { city, state: profile.locationState.trim() || undefined, country: profile.locationCountry },
    });
    setGeocoding(false);
    if (fnError || !data?.lat || !data?.lng) {
      setLocationError("We couldn't find that city. Try a more specific spelling.");
      return;
    }
    updateAndSave({
      locationCity: data.city || city,
      locationState: data.state || profile.locationState,
      locationCountry: data.country || profile.locationCountry,
      locationLat: data.lat,
      locationLng: data.lng,
    });
  };

  const pickPhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('We need permission to access your photos to set a profile photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    const base64 = asset.base64;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    setUploadingPhoto(true);
    const fileExt = asset.uri.split('.').pop()?.split('?')[0] || 'jpg';
    const filePath = `${user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filePath, decode(base64), { contentType: `image/${fileExt}`, upsert: true });

    if (uploadError) {
      setUploadingPhoto(false);
      setError(uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
    setUploadingPhoto(false);
    updateAndSave({ photoUrl: urlData.publicUrl });
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          {isEditMode ? (
            <View className="flex-row items-center justify-between">
              <Pressable onPress={handleCancelEdit} disabled={cancelling}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  {cancelling ? 'Cancelling...' : 'Cancel'}
                </Text>
              </Pressable>
              <Pressable onPress={() => router.replace('/profile')}>
                <Text className="text-caption font-semibold text-accent-500">Save</Text>
              </Pressable>
            </View>
          ) : (
            // Onboarding pagination (2026-07-29): same top-row pattern
            // gender-identity.tsx already uses, Back on the left (steps the
            // paginated flow back, or leaves the screen entirely from step
            // 0, see handleStepBack), "Step N of TOTAL_STEPS" on the right.
            <View className="flex-row items-center justify-between">
              <Pressable onPress={handleStepBack}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
              </Pressable>
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Step {step + 1} of {TOTAL_STEPS}
              </Text>
            </View>
          )}

          <View className="gap-3">
            <Text className="text-display text-stone-900 dark:text-stone-50">
              Build your profile
            </Text>
            <View className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
              <View className="h-2 rounded-full bg-accent-500" style={{ width: `${completionPct}%` }} />
            </View>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              {completionPct}% complete. {completionMessage(completionPct)}
            </Text>
          </View>

          {(isEditMode || step === STEP_LOCATION) && (
          <Section title="Where you're based" subtitle="Required. Used to find people near you">
            <View className="gap-3">
              <View className="gap-1">
                <Text className="text-caption text-stone-500 dark:text-stone-400">Country</Text>
                <Pressable
                  onPress={() => setActivePicker('country')}
                  className="flex-row items-center justify-between rounded-xl border border-stone-300 px-3 py-3 dark:border-stone-700">
                  <Text className="text-body text-stone-900 dark:text-stone-50">{profile.locationCountry}</Text>
                  <Ionicons name="chevron-down" size={16} color={MUTED_ICON_COLOR} />
                </Pressable>
              </View>

              <View className="gap-1">
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  How would you like to enter your location?
                </Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => selectEntryMode('state_city')}
                    className={`flex-1 items-center rounded-full border px-3 py-2 ${
                      locationEntryMode === 'state_city'
                        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text
                      className={`text-caption font-medium ${
                        locationEntryMode === 'state_city'
                          ? 'text-stone-50 dark:text-stone-900'
                          : 'text-stone-700 dark:text-stone-300'
                      }`}>
                      Enter state and city
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => selectEntryMode('zip')}
                    className={`flex-1 items-center rounded-full border px-3 py-2 ${
                      locationEntryMode === 'zip'
                        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text
                      className={`text-caption font-medium ${
                        locationEntryMode === 'zip'
                          ? 'text-stone-50 dark:text-stone-900'
                          : 'text-stone-700 dark:text-stone-300'
                      }`}>
                      Enter zip code
                    </Text>
                  </Pressable>
                </View>
              </View>

              {locationEntryMode === 'state_city' ? (
                <>
                  <View className="gap-1">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">State / Province</Text>
                    {profile.locationCountry === DEFAULT_LOCATION_COUNTRY ? (
                      <Pressable
                        onPress={() => setActivePicker('state')}
                        className="flex-row items-center justify-between rounded-xl border border-stone-300 px-3 py-3 dark:border-stone-700">
                        <Text className="text-body text-stone-900 dark:text-stone-50">
                          {profile.locationState || 'Select a state'}
                        </Text>
                        <Ionicons name="chevron-down" size={16} color={MUTED_ICON_COLOR} />
                      </Pressable>
                    ) : (
                      <View className="relative">
                        <TextInput
                          value={profile.locationState}
                          onChangeText={(text) => {
                            setProfile((p) => ({ ...p, locationState: text, locationLat: null, locationLng: null }));
                            setLocationError(null);
                          }}
                          placeholder="State or province"
                          placeholderTextColor={MUTED_ICON_COLOR}
                          className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                        />
                        <MicPlaceholderButton />
                      </View>
                    )}
                  </View>

                  <View className="gap-1">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">City</Text>
                    <View className="relative">
                      <TextInput
                        value={profile.locationCity}
                        onChangeText={(text) => {
                          setProfile((p) => ({ ...p, locationCity: text, locationLat: null, locationLng: null }));
                          setLocationError(null);
                        }}
                        placeholder="City"
                        placeholderTextColor={MUTED_ICON_COLOR}
                        className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                      />
                      <MicPlaceholderButton />
                    </View>
                  </View>
                </>
              ) : (
                <View className="gap-1">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">Zip code</Text>
                  <TextInput
                    value={locationZip}
                    onChangeText={(text) => {
                      setLocationZip(text);
                      setProfile((p) => ({ ...p, locationLat: null, locationLng: null }));
                      setLocationError(null);
                    }}
                    placeholder="Zip code"
                    keyboardType="number-pad"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>
              )}

              <Pressable
                onPress={confirmLocation}
                disabled={geocoding || (locationEntryMode === 'zip' ? !locationZip.trim() : !profile.locationCity.trim())}
                className={`items-center rounded-full border border-stone-300 px-4 py-3 dark:border-stone-700 ${
                  geocoding || (locationEntryMode === 'zip' ? !locationZip.trim() : !profile.locationCity.trim())
                    ? 'opacity-40'
                    : ''
                }`}>
                {geocoding ? (
                  <ActivityIndicator color={MUTED_ICON_COLOR} />
                ) : (
                  <Text className="text-caption font-medium text-stone-900 dark:text-stone-50">
                    Confirm location
                  </Text>
                )}
              </Pressable>

              {locationError && (
                <Text className="text-caption text-red-600 dark:text-red-400">{locationError}</Text>
              )}
              {profile.locationLat && profile.locationLng && !locationError && (
                <Text className="text-caption text-accent-500">
                  Location confirmed: {[profile.locationCity, profile.locationState].filter(Boolean).join(', ')}
                </Text>
              )}

              <View className="gap-1 pt-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  Search radius: {profile.searchRadiusMiles} miles
                </Text>
                <Slider
                  minimumValue={MIN_SEARCH_RADIUS_MILES}
                  maximumValue={MAX_SEARCH_RADIUS_MILES}
                  step={1}
                  value={profile.searchRadiusMiles}
                  onSlidingComplete={(value) => updateAndSave({ searchRadiusMiles: Math.round(value) })}
                  minimumTrackTintColor="#B5643B"
                />
              </View>
            </View>
          </Section>
          )}

          {(isEditMode || step === STEP_WHAT_BRINGS_YOU_HERE) && (
          <Section title="What brings you here?" subtitle="Required for matching. Choose all that apply">
            <View className="flex-row flex-wrap gap-2">
              {LIFE_TRANSITIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.lifeTransitions.includes(option)}
                  onPress={() => toggleLifeTransition(option)}
                />
              ))}
            </View>
            {attemptedContinue && profile.lifeTransitions.length === 0 && (
              <Text className="text-caption text-red-600 dark:text-red-400">
                Please select at least one option that applies to you.
              </Text>
            )}
            <View className="relative">
              <TextInput
                value={profile.lifeTransitionsOther}
                onChangeText={(text) => setProfile((p) => ({ ...p, lifeTransitionsOther: text }))}
                onBlur={() => persist(profile)}
                placeholder="Add your own"
                placeholderTextColor={MUTED_ICON_COLOR}
                className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>
          </Section>
          )}

          {(isEditMode || step === STEP_ABOUT_YOU) && (
          <Section title="About you" subtitle="What should people know before they meet you?">
            <VoiceTextInput
              value={profile.personalStatement}
              onChangeText={(text) => setProfile((p) => ({ ...p, personalStatement: text }))}
              onBlur={() => persist(profile)}
              numberOfLines={4}
              minHeightClassName="min-h-24"
              placeholder="A few sentences about who you are right now"
            />
            <UniversalTextBox
              value={profile.personalStatement}
              onChangeText={(text) => updateAndSave({ personalStatement: text })}
              context="profile"
            />
          </Section>
          )}

          {(isEditMode || step === STEP_ABOUT_YOU) && (
          <Section
            title="Stories"
            subtitle="Two or three short stories that show what you're like. Not a biography, just moments. Optional.">
            <StoriesEditor
              value={profile.stories}
              onChange={(stories) => setProfile((p) => ({ ...p, stories }))}
              onCommit={(stories) => updateAndSave({ stories })}
            />
          </Section>
          )}

          {(isEditMode || step === STEP_ABOUT_YOU) && (
          <Section title="How I like care" subtitle={`${CARE_STYLE_PROMPT} Optional, only people you connect with see this.`}>
            <VoiceTextInput
              value={profile.careStyle}
              onChangeText={(text) => setProfile((p) => ({ ...p, careStyle: text }))}
              onBlur={() => persist(profile)}
              numberOfLines={3}
              minHeightClassName="min-h-20"
              placeholder={CARE_STYLE_EXAMPLES}
            />
          </Section>
          )}

          {(isEditMode || step === STEP_VALUES) && (
          <Section
            title="What matters to you"
            subtitle={`Choose up to ${MAX_VALUES}. ${profile.values.length} of ${MAX_VALUES} selected`}>
            <View className="flex-row flex-wrap gap-2">
              {VALUES_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.values.includes(option)}
                  onPress={() => toggleValue(option)}
                />
              ))}
            </View>
            <View className="relative">
              <TextInput
                value={profile.valuesOther}
                onChangeText={(text) => setProfile((p) => ({ ...p, valuesOther: text }))}
                onBlur={() => persist(profile)}
                placeholder="Add your own"
                placeholderTextColor={MUTED_ICON_COLOR}
                className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>
          </Section>
          )}

          {(isEditMode || step === STEP_INTERESTS) && (
          <>
          <Section title="What do you like doing" subtitle="Pick any that fit. Each opens a couple quick follow-ups">
            <View className="flex-row flex-wrap gap-2">
              {ACTIVITY_CATEGORIES.map((category) => (
                <Chip
                  key={category.key}
                  label={category.label}
                  selected={profile.activityCategories.includes(category.key)}
                  onPress={() => toggleCategory(category.key)}
                />
              ))}
            </View>
            <View className="relative">
              <TextInput
                value={profile.activityOther}
                onChangeText={(text) => setProfile((p) => ({ ...p, activityOther: text }))}
                onBlur={() => persist(profile)}
                placeholder="Add your own"
                placeholderTextColor={MUTED_ICON_COLOR}
                className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>
          </Section>

          {ACTIVITY_CATEGORIES.filter((c) => profile.activityCategories.includes(c.key)).map((category) => (
            <Section key={category.key} title={category.label} nested>
              {category.questions.map((question) =>
                question.type === 'chips' ? (
                  <View key={question.field} className="gap-2">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      {question.label}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {question.options.map((option) => {
                        const stored = profile.activityDetails[category.key]?.[question.field];
                        const selected = question.multi
                          ? Array.isArray(stored) && stored.includes(option)
                          : stored === option;
                        return (
                          <Chip
                            key={option}
                            label={option}
                            selected={selected}
                            onPress={() => toggleActivityChip(category.key, question.field, option, question.multi)}
                          />
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  <View key={question.field} className="gap-2">
                    <Text className="text-caption text-stone-500 dark:text-stone-400">
                      {question.label}
                    </Text>
                    <View className="relative">
                      <TextInput
                        value={(profile.activityDetails[category.key]?.[question.field] as string) || ''}
                        onChangeText={(text) =>
                          setProfile((p) => ({
                            ...p,
                            activityDetails: {
                              ...p.activityDetails,
                              [category.key]: { ...(p.activityDetails[category.key] || {}), [question.field]: text },
                            },
                          }))
                        }
                        onBlur={() => persist(profile)}
                        placeholder={question.placeholder}
                        placeholderTextColor={MUTED_ICON_COLOR}
                        className="rounded-xl border border-stone-300 bg-white px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
                      />
                      <MicPlaceholderButton />
                    </View>
                  </View>
                )
              )}
            </Section>
          ))}
          </>
          )}

          {(isEditMode || step === STEP_HANGOUT_STYLE) && (
          <>
          <Section title="How you like to hang out with a new friend" subtitle="Required for matching. One that best fits">
            <View className="flex-row flex-wrap gap-2">
              {HANGOUT_PEOPLE.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.hangoutPeoplePreference === option}
                  onPress={() => updateAndSave({ hangoutPeoplePreference: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="How you like to hang out" subtitle="Required for matching. Choose all that apply">
            <View className="flex-row flex-wrap gap-2">
              {HANGOUT_TYPES.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.hangoutTypePreference.includes(option)}
                  onPress={() => toggleHangoutType(option)}
                />
              ))}
            </View>
          </Section>
          </>
          )}

          {(isEditMode || step === STEP_FRIENDSHIP_TYPE_AND_RHYTHM) && (
          <>
          <Section
            title="What kind of friendship are you hoping to build?"
            subtitle="Required for matching. One that best fits">
            <View className="flex-row flex-wrap gap-2">
              {FRIENDSHIP_TYPE_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.friendshipType === option}
                  onPress={() => updateAndSave({ friendshipType: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="How often you like to check in" subtitle="Required for matching">
            <View className="flex-row flex-wrap gap-2">
              {COMMUNICATION_FREQ.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.communicationFreq === option}
                  onPress={() => updateAndSave({ communicationFreq: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="How often you like to meet up" subtitle="Required for matching">
            <View className="flex-row flex-wrap gap-2">
              {MEETING_FREQ.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.meetingFreq === option}
                  onPress={() => updateAndSave({ meetingFreq: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="How quickly you tend to reply" subtitle="Required for matching">
            <View className="flex-row flex-wrap gap-2">
              {RESPONSE_TIME.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.responseTime === option}
                  onPress={() => updateAndSave({ responseTime: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="When you're generally free to meet" subtitle="Choose all that apply">
            <View className="flex-row flex-wrap gap-2">
              {AVAILABILITY.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.availability.includes(option)}
                  onPress={() => toggleAvailability(option)}
                />
              ))}
            </View>
          </Section>
          </>
          )}

          {(isEditMode || step === STEP_COMMUNICATION_STYLE) && (
          <>
          <Section
            title="You are getting to know someone new. When do you tend to share personal things?"
            subtitle="Required for matching">
            <View className="gap-2">
              {COMMUNICATION_STYLE_OPENNESS_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => updateAndSave({ communicationStyleOpenness: option })}
                  className={`rounded-xl border px-4 py-3 ${
                    profile.communicationStyleOpenness === option
                      ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}>
                  <Text
                    className={`text-body font-medium ${
                      profile.communicationStyleOpenness === option
                        ? 'text-stone-50 dark:text-stone-900'
                        : 'text-stone-900 dark:text-stone-50'
                    }`}>
                    {option}
                  </Text>
                  <Text
                    className={`text-caption ${
                      profile.communicationStyleOpenness === option
                        ? 'text-stone-300 dark:text-stone-600'
                        : 'text-stone-500 dark:text-stone-400'
                    }`}>
                    {COMMUNICATION_STYLE_OPENNESS_DESCRIPTIONS[option]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>

          <Section title="How you like to communicate" subtitle="Choose all that apply">
            <View className="flex-row flex-wrap gap-2">
              {COMMUNICATION_MODES.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.communicationModes.includes(option)}
                  onPress={() => toggleCommunicationMode(option)}
                />
              ))}
            </View>
          </Section>

          <Section title="Bar or restaurant preference" subtitle="Helps us suggest the right kind of activity later">
            <View className="flex-row flex-wrap gap-2">
              {BAR_PREFERENCE.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.barPreference === option}
                  onPress={() => updateAndSave({ barPreference: option })}
                />
              ))}
            </View>
          </Section>

          <Section title="Dealbreakers" subtitle="Optional. Anything that's a hard no for you?">
            <VoiceTextInput
              value={profile.dealbreakers}
              onChangeText={(text) => setProfile((p) => ({ ...p, dealbreakers: text }))}
              onBlur={() => persist(profile)}
              numberOfLines={3}
              minHeightClassName="min-h-20"
              placeholder="Optional"
            />
            <UniversalTextBox
              value={profile.dealbreakers}
              onChangeText={(text) => updateAndSave({ dealbreakers: text })}
              context="profile"
              reflectionQuestions={[
                "Think of a time a friendship didn't work for you. What was the real reason?",
                'Is it truly a hard no, or something you could talk about?',
              ]}
            />
          </Section>
          </>
          )}

          {(isEditMode || step === STEP_LANGUAGES_ETHNICITY_16P) && (
          <>
          <Section
            title="Languages I am comfortable connecting in"
            subtitle="Shown on your profile, and a small factor in match suggestions">
            <View className="flex-row flex-wrap gap-2">
              {LANGUAGE_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.languages.includes(option)}
                  onPress={() => toggleLanguage(option)}
                />
              ))}
            </View>
            {profile.languages.includes('Other') && (
              <View className="relative">
                <TextInput
                  value={profile.languagesOther}
                  onChangeText={(text) => setProfile((p) => ({ ...p, languagesOther: text }))}
                  onBlur={() => persist(profile)}
                  placeholder="Which other language?"
                  placeholderTextColor={MUTED_ICON_COLOR}
                  className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <MicPlaceholderButton />
              </View>
            )}
          </Section>

          <Section
            title="Ethnicity / race"
            subtitle="Optional. Shown on your profile, never used for matching.">
            <View className="flex-row flex-wrap gap-2">
              {ETHNICITY_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.ethnicity.includes(option)}
                  onPress={() => toggleEthnicity(option)}
                />
              ))}
            </View>
            {profile.ethnicity.includes('Other') && (
              <View className="relative">
                <TextInput
                  value={profile.ethnicityOther}
                  onChangeText={(text) => setProfile((p) => ({ ...p, ethnicityOther: text }))}
                  onBlur={() => persist(profile)}
                  placeholder="Tell us more"
                  placeholderTextColor={MUTED_ICON_COLOR}
                  className="rounded-xl border border-stone-300 px-3 py-2 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <MicPlaceholderButton />
              </View>
            )}
          </Section>

          <Section
            title="16 Personalities"
            subtitle="Optional. Shown on your profile, but never used for matching.">
            <View className="flex-row flex-wrap gap-2">
              {SIXTEEN_TYPES.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={profile.personality16p === option}
                  onPress={() =>
                    updateAndSave({
                      personality16p: profile.personality16p === option ? null : option,
                    })
                  }
                />
              ))}
            </View>
            <Pressable onPress={() => Linking.openURL('https://www.16personalities.com/free-personality-test')}>
              <Text className="text-caption text-accent-600 dark:text-accent-400">
                Take the free test →
              </Text>
            </Pressable>
          </Section>
          </>
          )}

          {(isEditMode || step === STEP_PHOTO) && (
          <Section title="Photo" subtitle="Only shown to a match after they've read your full profile">
            <View className="flex-row items-center gap-4">
              {profile.photoUrl ? (
                <Image source={{ uri: profile.photoUrl }} className="h-16 w-16 rounded-full" />
              ) : (
                <View className="h-16 w-16 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
                  <Text className="text-caption text-stone-400 dark:text-stone-500">No photo</Text>
                </View>
              )}
              <Pressable
                onPress={pickPhoto}
                disabled={uploadingPhoto}
                className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
                {uploadingPhoto ? (
                  <ActivityIndicator color={MUTED_ICON_COLOR} />
                ) : (
                  <Text className="text-caption font-medium text-stone-900 dark:text-stone-50">
                    {profile.photoUrl ? 'Change photo' : 'Add a photo'}
                  </Text>
                )}
              </Pressable>
            </View>
            {/* Trust and safety gate: a profile with no photo cannot
                appear in Discover or Browse at all (enforced server-side,
                discovery_profiles/browse_profiles both require
                photo_url is not null, not just a display convention).
                Surfaced here clearly rather than leaving it a silent
                gap someone would only discover by not getting matches. */}
            {!profile.photoUrl && (
              <Text className="text-caption text-amber-600 dark:text-amber-400">
                Without a photo, you will not appear in Discover or Browse for other people, and you
                will not be able to send the first message in a new conversation.
              </Text>
            )}
          </Section>
          )}
        </ScrollView>

        <View className="gap-3 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}
          {isEditMode && missingRequiredFields.length > 0 && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Still need (required for matching): {missingRequiredFields.join(', ')}
            </Text>
          )}
          {/* Onboarding pagination: on every step but the last, only THIS
              step's own missing required fields are shown, per instruction
              ("blocks progression at the right step, not just at the
              end"). The last step shows the exact same full-list message
              edit mode always has, since that's genuinely the final,
              whole-profile check, unchanged from before pagination. */}
          {!isEditMode && !isLastStep && attemptedContinue && stepMissingFields.length > 0 && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Still need (required for matching): {stepMissingFields.join(', ')}
            </Text>
          )}
          {!isEditMode && isLastStep && missingRequiredFields.length > 0 && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Still need (required for matching): {missingRequiredFields.join(', ')}
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          {isEditMode && (
            <Pressable onPress={() => router.push('/big-five-assessment?from=profile')} className="items-center py-1">
              <Text className="text-caption font-semibold text-accent-500">
                Retake personality assessment
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (isEditMode) {
                if (!canContinue) {
                  setAttemptedContinue(true);
                  return;
                }
                router.replace('/profile');
                return;
              }
              handleStepNext();
            }}
            className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
              (isEditMode ? !canContinue : !canAdvanceStep) ? 'opacity-40' : ''
            }`}>
            {saving && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {isEditMode
                ? missingRequiredFields.length > 0
                  ? 'Complete required fields to continue'
                  : completionPct < COMPLETION_THRESHOLD
                    ? `Complete ${COMPLETION_THRESHOLD}% to continue`
                    : 'Done'
                : isLastStep
                  ? missingRequiredFields.length > 0
                    ? 'Complete required fields to continue'
                    : completionPct < COMPLETION_THRESHOLD
                      ? `Complete ${COMPLETION_THRESHOLD}% to continue`
                      : 'Continue'
                  : stepMissingFields.length > 0
                    ? 'Complete required fields to continue'
                    : 'Next'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <Modal visible={activePicker !== null} animationType="slide" transparent onRequestClose={closePicker}>
        <View className="flex-1 justify-end bg-black/30">
          <Pressable className="flex-1" onPress={closePicker} />
          <View
            style={{ height: 500 }}
            className="gap-3 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <Text className="text-title text-stone-900 dark:text-stone-50">
              {activePicker === 'country' ? 'Select country' : 'Select state'}
            </Text>
            <TextInput
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Search"
              placeholderTextColor={MUTED_ICON_COLOR}
              className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <ScrollView className="flex-1">
              {filteredPickerOptions.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => (activePicker === 'country' ? selectCountry(option) : selectState(option))}
                  className="border-b border-stone-100 py-3 dark:border-stone-800">
                  <Text className="text-body text-stone-900 dark:text-stone-50">{option}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
