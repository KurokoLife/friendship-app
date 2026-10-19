import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { decode } from 'base64-arraybuffer';
import { PHOTO_RULES_TEXT, pickProfilePhoto } from '@/lib/photo-picker';
import { ProfileBasicsCard } from '@/components/profile-basics-card';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { completionPct } from '@/lib/profile-completion';
import { WHAT_BRINGS_MAX_LENGTH, flushStartDraft } from '@/lib/start-draft';
import { normalizeStories, type Story } from '@/lib/stories';
import { ACTIVITY_CATEGORIES } from '@/lib/activity-categories';
import { UniversalTextBox } from '@/components/universal-text-box';
import { VoiceTextInput } from '@/components/voice-text-input';
import {
  AVAILABILITY,
  COMMUNICATION_STYLE_OPENNESS_DESCRIPTIONS,
  COMMUNICATION_STYLE_OPENNESS_OPTIONS,
  DEFAULT_LOCATION_COUNTRY,
  DEFAULT_SEARCH_RADIUS_MILES,
  FRIENDSHIP_TYPE_DESCRIPTIONS,
  FRIENDSHIP_TYPE_OPTIONS,
  HANGOUT_TYPES,
  LANGUAGE_OPTIONS,
  LIFE_TRANSITIONS,
  MAX_FRIENDSHIP_TYPES,
  MAX_LIFE_TRANSITIONS,
  NOTHING_BIG_TRANSITION,
  LOCATION_COUNTRIES,
  MAX_SEARCH_RADIUS_MILES,
  MEETING_FREQ,
  MIN_SEARCH_RADIUS_MILES,
  RESPONSE_TIME,
  US_STATES,
} from '@/lib/filter-options';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
// 2026-10-04 (docs/DECISIONS.md section 2): up to 5 of 20.
const MAX_VALUES = 5;
// "Right now, I'm..." (stored in personal_statement, docs/DECISIONS.md
// section 2): one short line instead of an open bio.
const RIGHT_NOW_MAX_LENGTH = 150;

const VALUES_OPTIONS = [
  'Honesty', 'Humor', 'Family', 'Adventure', 'Stability',
  'Creativity', 'Spirituality', 'Community', 'Growth', 'Ambition',
  'Loyalty', 'Independence', 'Kindness', 'Curiosity', 'Purpose',
  'Health', 'Balance', 'Simplicity', 'Courage', 'Gratitude',
];

// Stored values unchanged (activity suggestions filter on them); only the
// question is reworded (2026-10-04).
// 2026-10-18: reworded. Stored values: 'No preference' (fine with me),
// 'Rather not', "I don't drink" (plan ideas skip bars for the last two).
export const BAR_CHOICES: { value: string; label: string }[] = [
  { value: 'No preference', label: 'Fine with me' },
  { value: 'Rather not', label: "I'd rather not" },
  { value: "I don't drink", label: "I don't drink" },
];

const INTEREST_NOTE_PLACEHOLDER = 'In your own words (optional), like "mostly talking to my tomatoes"';

// "Good to know about me" (replaces "Hard nos", stored in dealbreakers):
// a different grey example each visit.
const GOOD_TO_KNOW_EXAMPLES = [
  'Quiet places are easier for me.',
  'I sometimes have my kid with me.',
  'Early mornings work best.',
  'I like to plan a week or two ahead.',
];


type ActivityDetails = Record<string, Record<string, string[] | string>>;

type ProfileFormState = {
  lifeTransitions: string[];
  showLifeTransitions: boolean;
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
  extraPhotoUrls: string[];
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
  friendshipTypes: string[];
  communicationStyleOpenness: string | null;
  availability: string[];
  communicationModes: string[];
};

const EMPTY_PROFILE: ProfileFormState = {
  lifeTransitions: [],
  showLifeTransitions: true,
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
  extraPhotoUrls: [],
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
  friendshipTypes: [],
  communicationStyleOpenness: null,
  availability: [],
  communicationModes: [],
};

// Set when the profile loads: true once migration 20261005000001 has
// added profiles.friendship_types.
let hasFriendshipTypesColumn = false;

const COMPLETION_THRESHOLD = 60;

function computeCompletionPct(p: ProfileFormState) {
  return completionPct({
    life_transitions: p.lifeTransitions,
    life_transitions_other: p.lifeTransitionsOther,
    languages: p.languages,
    personal_statement: p.personalStatement,
    values: p.values,
    activity_categories: p.activityCategories,
    hangout_type_preference: p.hangoutTypePreference,
    stories: p.stories,
    meeting_freq: p.meetingFreq,
    response_time: p.responseTime,
    bar_preference: p.barPreference,
    dealbreakers: p.dealbreakers,
    photo_url: p.photoUrl,
    location_lat: p.locationLat,
    location_lng: p.locationLng,
    friendship_types: p.friendshipTypes,
    communication_style_openness: p.communicationStyleOpenness,
    availability: p.availability,
  });
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
const STEP_LANGUAGES = 8;
const STEP_PHOTO = 9;
// Edit profile only: "What brings you here" and your stories (asked in
// "Start with you" during joining).
const STEP_START = 10;
const EDIT_BASICS = -1;
// Joining (2026-10-18): what you enjoy, then the practical bits. Who you'd
// like to meet comes next (gender-identity), then How you connect, then
// the photo on its own (?from=photo). Values, what-brings chips, hangout
// style and opening up are no longer asked.
const ONBOARDING_STEPS = [STEP_INTERESTS, STEP_LOCATION, STEP_FRIENDSHIP_TYPE_AND_RHYTHM, STEP_COMMUNICATION_STYLE, STEP_LANGUAGES];

// The Edit profile list. `use` says, in a word, whether the part is used to
// suggest people (details on each field inside, see MATCH_USE).
const EDIT_SECTIONS: { step: number; title: string; use: 'yes' | 'some' | 'no' }[] = [
  { step: STEP_START, title: 'What brings you here and your stories', use: 'no' },
  { step: STEP_INTERESTS, title: 'What you enjoy', use: 'yes' },
  { step: EDIT_BASICS, title: 'Name, age, who you would like to meet', use: 'yes' },
  { step: STEP_LOCATION, title: "Where you're based", use: 'yes' },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, title: 'Friendship type, pace and free times', use: 'some' },
  { step: STEP_COMMUNICATION_STYLE, title: 'Bars or drinks, good to know, how you like care', use: 'no' },
  { step: STEP_LANGUAGES, title: 'Languages', use: 'yes' },
  { step: STEP_PHOTO, title: 'Photos', use: 'no' },
];
const USE_LABEL = { yes: 'Used for matching', some: 'Partly used for matching', no: 'Not used for matching' } as const;

type RequiredFieldCheck = { step: number; message: string; isMissing: (p: ProfileFormState) => boolean };

const REQUIRED_FIELD_CHECKS: RequiredFieldCheck[] = [
  // Location is required (Fix 2a) specifically as a confirmed geocode, not
  // just typed text, everything downstream (radius filtering) depends on
  // real lat/lng, not the raw city string.
  { step: STEP_LOCATION, message: 'Location', isMissing: (p) => !(p.locationLat && p.locationLng) },
  {
    step: STEP_START,
    message: 'What brings you here',
    isMissing: (p) => !p.lifeTransitionsOther.trim(),
  },
  {
    step: STEP_START,
    message: 'At least one story',
    isMissing: (p) => !p.stories.some((st) => st.text.trim().length > 0),
  },
  {
    step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM,
    message: 'What kind of friendship you are hoping to build',
    isMissing: (p) => p.friendshipTypes.length === 0,
  },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, message: 'Meeting frequency', isMissing: (p) => !p.meetingFreq },
  { step: STEP_FRIENDSHIP_TYPE_AND_RHYTHM, message: 'Response time', isMissing: (p) => !p.responseTime },
  // 2026-10-18: people are only suggested to someone who shares a language.
  {
    step: STEP_LANGUAGES,
    message: 'At least one language',
    isMissing: (p) => !p.languages.some((l) => l !== 'Other'),
  },
  // 2026-10-04: one clear face photo is required (the selfie check
  // compares against it).
  { step: STEP_PHOTO, message: 'A profile photo', isMissing: (p) => !p.photoUrl },
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

// Whether a field is used to suggest people (2026-10-14, founder: people
// should know). Source of truth: compatible_candidates_for (who can be
// shown) and weightedScore in generate-match-suggestions (how people are
// ranked). Keep MATCH_USE in step with those two.
// 2026-10-18: warm, plain words. Keep in step with compatible_candidates_for
// (filters: who you'd like to meet, ages, distance, a shared language) and
// weightedScore (meeting pace 40, interests 40, friendship type 20).
const MATCH_USE = {
  location: { used: true, text: 'Used to suggest people near you. Others only see your city.' },
  whatBrings: { used: false, text: 'Shown on your profile so people can get to know you.' },
  stories: { used: false, text: 'Shown on your profile so people can get to know you.' },
  care: { used: false, text: 'Only people you connect with see it.' },
  activities: { used: true, text: 'Used to suggest people who enjoy similar things. Also helps with plan ideas.' },
  friendshipType: { used: true, text: 'Used to suggest people looking for something similar.' },
  meetingFreq: { used: true, text: 'Used to suggest people with a similar rhythm.' },
  responseTime: { used: false, text: 'Shown on your profile, so people know what to expect.' },
  availability: { used: false, text: 'Helps when you plan a meetup.' },
  bars: { used: false, text: 'Keeps plan ideas right for you.' },
  goodToKnow: { used: false, text: 'Shown on your profile so people know up front.' },
  languages: { used: true, text: 'You are only suggested to people who share at least one language with you.' },
  photos: { used: false, text: 'A photo is needed to be suggested to anyone.' },
} as const;

function MatchLine({ use }: { use: { used: boolean; text: string } }) {
  return (
    <View className="flex-row items-start gap-1.5">
      <Ionicons
        name={use.used ? 'people-outline' : 'eye-off-outline'}
        size={13}
        color={use.used ? '#B5643B' : MUTED_ICON_COLOR}
        style={{ marginTop: 2 }}
      />
      <Text className={`flex-1 text-caption ${use.used ? 'text-accent-500' : 'text-stone-400 dark:text-stone-500'}`}>
        {use.text}
      </Text>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
  nested,
  matching,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  nested?: boolean;
  matching?: { used: boolean; text: string };
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
      {matching && <MatchLine use={matching} />}
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
  const { from, resume } = useLocalSearchParams<{ from?: string; resume?: string }>();
  const isEditMode = from === 'profile';
  // Joining: the photo is its own step near the end (2026-10-18).
  const isPhotoStep = from === 'photo';
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
  const [step, setStep] = useState(resume === 'last' ? ONBOARDING_STEPS.length - 1 : 0);
  // Edit profile (2026-10-14): a short list of sections; tap one to open
  // just that part. null = the list.
  const [editSection, setEditSection] = useState<number | null>(null);
  const shows = (st: number) =>
    isEditMode ? editSection === st : isPhotoStep ? st === STEP_PHOTO : ONBOARDING_STEPS[step] === st;
  const [goodToKnowExample] = useState(
    () => GOOD_TO_KNOW_EXAMPLES[Math.floor(Math.random() * GOOD_TO_KNOW_EXAMPLES.length)]
  );
  const scrollRef = useRef<ScrollView>(null);
  const openSection = (st: number | null) => {
    setEditSection(st);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const [openActivityDetails, setOpenActivityDetails] = useState<string[]>([]);

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
      // Anything still waiting from "Start with you" is saved first.
      await flushStartDraft();
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      hasFriendshipTypesColumn = Boolean(data && 'friendship_types' in data);
      if (data) {
        const activityInterests = (data.activity_interests as {
          categories?: string[];
          details?: ActivityDetails;
          other?: string;
        }) ?? {};
        const loadedProfile: ProfileFormState = {
          lifeTransitions: data.life_transitions ?? [],
          showLifeTransitions: data.show_life_transitions ?? true,
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
          extraPhotoUrls: data.extra_photo_urls ?? [],
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
          friendshipTypes:
            data.friendship_types ??
            (data.friendship_type && data.friendship_type !== 'A social circle' ? [data.friendship_type] : []),
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
  const canContinue = missingRequiredFields.length === 0 && isSupabaseConfigured;

  // Per-step gate for the "Next" button, only relevant outside edit mode.
  // The overall 60%-completion soft threshold (COMPLETION_THRESHOLD) was
  // never tied to any one field or section, it's an aggregate across the
  // whole profile including optional fields, so it stays a final-step-only
  // check (canContinue above), unchanged, exactly matching current
  // behavior rather than inventing a new per-step soft gate nobody asked
  // for. Hard-required fields, by contrast, now block at the step they
  // actually live on, per instruction ("not just at the end").
  const isLastStep = isPhotoStep || step === ONBOARDING_STEPS.length - 1;
  const stepMissingFields = getMissingRequiredFieldsForStep(profile, isPhotoStep ? STEP_PHOTO : ONBOARDING_STEPS[step]);
  const canAdvanceStep = stepMissingFields.length === 0 && isSupabaseConfigured;

  const handleStepNext = () => {
    if (!canAdvanceStep) {
      setAttemptedContinue(true);
      return;
    }
    setAttemptedContinue(false);
    if (isPhotoStep) {
      router.replace('/readiness-commitment');
      return;
    }
    if (isLastStep) {
      router.replace('/gender-identity');
      return;
    }
    setStep((s) => s + 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const handleStepBack = () => {
    setAttemptedContinue(false);
    if (isPhotoStep) {
      router.replace('/big-five-assessment');
      return;
    }
    if (step === 0) {
      router.replace('/start-with-you');
      return;
    }
    setStep((s) => s - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
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
      show_life_transitions: next.showLifeTransitions,
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
      extra_photo_urls: next.extraPhotoUrls.slice(0, 2),
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
      friendship_type: next.friendshipTypes[0] ?? null,
      // Only sent once the friendship_types column exists (migration
      // 20261005000001), so saving keeps working before it is applied.
      ...(hasFriendshipTypesColumn ? { friendship_types: next.friendshipTypes.length > 0 ? next.friendshipTypes : null } : {}),
      communication_style_openness: next.communicationStyleOpenness,
      availability: next.availability,
      communication_modes: next.communicationModes,
      completion_pct: computeCompletionPct(next),
    });
    setSaving(false);
    if (saveError) setError('Something went wrong saving that. Try again.');
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
  // 2026-10-04: choose up to 3. "Nothing big, I'd just like more friends"
  // stands on its own, like "No pets" below.
  const toggleLifeTransition = (option: string) => {
    const selected = profile.lifeTransitions.includes(option);
    if (selected) {
      updateAndSave({ lifeTransitions: profile.lifeTransitions.filter((t) => t !== option) });
      return;
    }
    if (option === NOTHING_BIG_TRANSITION) {
      updateAndSave({ lifeTransitions: [option] });
      return;
    }
    const withoutNothingBig = profile.lifeTransitions.filter((t) => t !== NOTHING_BIG_TRANSITION);
    if (withoutNothingBig.length >= MAX_LIFE_TRANSITIONS) return;
    updateAndSave({ lifeTransitions: [...withoutNothingBig, option] });
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
  const [friendshipTypeNotice, setFriendshipTypeNotice] = useState<string | null>(null);
  const toggleFriendshipType = (option: string) => {
    setFriendshipTypeNotice(null);
    const selected = profile.friendshipTypes.includes(option);
    if (!selected && profile.friendshipTypes.length >= MAX_FRIENDSHIP_TYPES) {
      setFriendshipTypeNotice(`You can choose up to ${MAX_FRIENDSHIP_TYPES}. Unselect one to pick another.`);
      return;
    }
    const next = selected
      ? profile.friendshipTypes.filter((v) => v !== option)
      : [...profile.friendshipTypes, option];
    updateAndSave({ friendshipTypes: next, friendshipType: next[0] ?? null });
  };

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

  // 2026-10-05: ZIP code only (US). Typing a city ("Los Angeles, CA")
  // was easy to get wrong, and a ZIP is more precise for distance. The
  // server lookup (geocode-city, which uses Zippopotam for US ZIPs) is
  // tried first; if it fails, the app asks Zippopotam directly.
  const confirmLocation = async () => {
    setLocationError(null);
    const zip = locationZip.trim();
    if (!/^[0-9]{5}$/.test(zip)) {
      setLocationError('Enter a 5-digit ZIP code.');
      return;
    }
    setGeocoding(true);
    let found: { city: string; state: string; lat: number; lng: number } | null = null;
    try {
      const { data, error: fnError } = await supabase.functions.invoke('geocode-city', {
        body: { zip, country: DEFAULT_LOCATION_COUNTRY },
      });
      if (!fnError && data?.lat && data?.lng) {
        found = { city: data.city || '', state: data.state || '', lat: data.lat, lng: data.lng };
      }
    } catch {
      found = null;
    }
    if (!found) {
      try {
        const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (res.ok) {
          const body = await res.json();
          const place = body?.places?.[0];
          if (place) {
            found = {
              city: place['place name'] ?? '',
              state: place.state ?? '',
              lat: Number(place.latitude),
              lng: Number(place.longitude),
            };
          }
        }
      } catch {
        found = null;
      }
    }
    setGeocoding(false);
    if (!found || !found.lat || !found.lng) {
      setLocationError("We couldn't find that ZIP code. Double check it and try again.");
      return;
    }
    updateAndSave({
      locationCity: found.city,
      locationState: found.state,
      locationCountry: DEFAULT_LOCATION_COUNTRY,
      locationLat: found.lat,
      locationLng: found.lng,
    });
  };

  const pickPhoto = async (slot: 'main' | 'extra') => {
    setError(null);
    const picked = await pickProfilePhoto();
    if (!picked.ok) {
      if ('message' in picked) setError(picked.message);
      return;
    }
    const { base64, contentType, ext: fileExt } = picked.photo;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Your session expired. Please verify your phone number again.');
      return;
    }

    setUploadingPhoto(true);
    const filePath = `${user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filePath, decode(base64), { contentType, upsert: true });

    if (uploadError) {
      setUploadingPhoto(false);
      setError("That photo didn't upload. Try again.");
      return;
    }

    const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
    setUploadingPhoto(false);
    if (slot === 'main') updateAndSave({ photoUrl: urlData.publicUrl });
    else updateAndSave({ extraPhotoUrls: [...profile.extraPhotoUrls, urlData.publicUrl].slice(0, 2) });
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
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-5 px-6 pb-6 pt-10">
          {isEditMode ? (
            <View className="flex-row items-center justify-between">
              <Pressable onPress={() => (editSection === null ? router.replace('/profile') : openSection(null))}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  {editSection === null ? 'Back' : 'All sections'}
                </Text>
              </Pressable>
              <Text className="text-caption text-stone-400 dark:text-stone-600">Changes save as you go</Text>
            </View>
          ) : (
            // Onboarding pagination (2026-07-29): same top-row pattern
            // gender-identity.tsx already uses, Back on the left (steps the
            // paginated flow back, or leaves the screen entirely from step
            // 0, see handleStepBack), "Step N of TOTAL_STEPS" on the right.
            // Joining (2026-10-18): Back only. No "Step N of 10" and no
            // completion bar, so people write for a person, not a grader.
            <View className="flex-row items-center justify-between">
              <Pressable onPress={handleStepBack}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
              </Pressable>
            </View>
          )}

          {isEditMode ? (
            <View className="gap-3">
              <Text className="text-display text-stone-900 dark:text-stone-50">Edit profile</Text>
              <View className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                <View className="h-2 rounded-full bg-accent-500" style={{ width: `${completionPct}%` }} />
              </View>
              <Text className="text-caption text-stone-500 dark:text-stone-400">{completionPct}% complete.</Text>
            </View>
          ) : (
            <Text className="text-display text-stone-900 dark:text-stone-50">
              {isPhotoStep
                ? 'A photo of you'
                : ONBOARDING_STEPS[step] === STEP_INTERESTS
                  ? 'What you enjoy'
                  : 'A few practical things'}
            </Text>
          )}

          {isEditMode && editSection === null && (
            <View className="gap-2">
              {EDIT_SECTIONS.map((sec) => {
                const missing = REQUIRED_FIELD_CHECKS.some((c) => c.step === sec.step && c.isMissing(profile));
                return (
                  <Pressable
                    key={sec.step}
                    onPress={() => openSection(sec.step)}
                    className="flex-row items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 active:opacity-80 dark:border-stone-700 dark:bg-stone-800">
                    <View className="flex-1 gap-0.5">
                      <Text className="text-body text-stone-900 dark:text-stone-50">{sec.title}</Text>
                      <Text
                        className={`text-caption ${
                          sec.use === 'no' ? 'text-stone-400 dark:text-stone-500' : 'text-accent-500'
                        }`}>
                        {USE_LABEL[sec.use]}
                        {missing ? ' · Needs an answer' : ''}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
                  </Pressable>
                );
              })}
              <Text className="text-caption text-stone-400 dark:text-stone-500">
                Matching uses only the parts marked above. Your words (what brings you here, your stories, good to know,
                how you like care) are never used to pick who you meet.
              </Text>
            </View>
          )}

          {isEditMode && editSection === EDIT_BASICS && <ProfileBasicsCard />}

          {shows(STEP_LOCATION) && (
          <Section title="Where you're based" matching={MATCH_USE.location}>
            <View className="gap-3">
              <View className="gap-1">
                <Text className="text-caption text-stone-500 dark:text-stone-400">Your ZIP code (US)</Text>
                <TextInput
                  value={locationZip}
                  onChangeText={(text) => {
                    setLocationZip(text.replace(/[^0-9]/g, '').slice(0, 5));
                    setProfile((p) => ({ ...p, locationLat: null, locationLng: null }));
                    setLocationError(null);
                  }}
                  placeholder="e.g. 90012"
                  keyboardType="number-pad"
                  maxLength={5}
                  placeholderTextColor={MUTED_ICON_COLOR}
                  className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                />
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  We only show your city to others, never your ZIP code.
                </Text>
              </View>

              <Pressable
                onPress={confirmLocation}
                disabled={geocoding || locationZip.length !== 5}
                className={`items-center rounded-full border border-stone-300 px-4 py-3 dark:border-stone-700 ${
                  geocoding || locationZip.length !== 5 ? 'opacity-40' : ''
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
                  Found: {[profile.locationCity, profile.locationState].filter(Boolean).join(', ')}
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

          {shows(STEP_START) && (
          <Section title="What brings you to Limen?" matching={MATCH_USE.whatBrings}>
            <VoiceTextInput
              value={profile.lifeTransitionsOther}
              onChangeText={(text) =>
                setProfile((p) => ({ ...p, lifeTransitionsOther: text.slice(0, WHAT_BRINGS_MAX_LENGTH), showLifeTransitions: true }))
              }
              onBlur={() => persist({ ...profile, showLifeTransitions: true })}
              numberOfLines={3}
              minHeightClassName="min-h-20"
              placeholder="Most of my friends moved away and I miss having people to call."
            />
          </Section>
          )}

          {shows(STEP_START) && (
          <Section
            title="Your stories"
            matching={MATCH_USE.stories}
            subtitle="Something that happened, told the way you'd tell a friend. Up to three.">
            <StoriesEditor
              value={profile.stories}
              onChange={(stories) => setProfile((p) => ({ ...p, stories }))}
              onCommit={(stories) => updateAndSave({ stories })}
            />
          </Section>
          )}

          {shows(STEP_INTERESTS) && (
          <>
          <Section title="What do you enjoy?" matching={MATCH_USE.activities} subtitle="Pick any that fit. For each one, you can add a line in your own words.">
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
              <TextInput
                value={(profile.activityDetails[category.key]?.note as string) || ''}
                onChangeText={(text) =>
                  setProfile((p) => ({
                    ...p,
                    activityDetails: {
                      ...p.activityDetails,
                      [category.key]: { ...(p.activityDetails[category.key] || {}), note: text.slice(0, 120) },
                    },
                  }))
                }
                onBlur={() => persist(profile)}
                placeholder={INTEREST_NOTE_PLACEHOLDER}
                placeholderTextColor={MUTED_ICON_COLOR}
                accessibilityLabel={`${category.label} in your own words`}
                className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50"
              />
              <Pressable
                onPress={() =>
                  setOpenActivityDetails((open) =>
                    open.includes(category.key) ? open.filter((k) => k !== category.key) : [...open, category.key]
                  )
                }>
                <Text className="text-caption font-semibold text-accent-500">
                  {openActivityDetails.includes(category.key) ? 'Hide details' : 'Add details (optional)'}
                </Text>
              </Pressable>
              {openActivityDetails.includes(category.key) && category.questions.map((question) =>
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

          {shows(STEP_FRIENDSHIP_TYPE_AND_RHYTHM) && (
          <>
          <Section
            title="What kind of friendship are you hoping to build?"
            matching={MATCH_USE.friendshipType}
            subtitle={`Choose up to ${MAX_FRIENDSHIP_TYPES}.`}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Limen introduces you to one person at a time, and first meetups are one on one.
            </Text>
            <View className="gap-2">
              {FRIENDSHIP_TYPE_OPTIONS.map((option) => {
                const selected = profile.friendshipTypes.includes(option);
                return (
                  <Pressable
                    key={option}
                    onPress={() => toggleFriendshipType(option)}
                    className={`gap-0.5 rounded-2xl border p-3 ${
                      selected
                        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                        : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text
                      className={`text-body font-medium ${
                        selected ? 'text-stone-50 dark:text-stone-900' : 'text-stone-900 dark:text-stone-50'
                      }`}>
                      {option}
                    </Text>
                    <Text
                      className={`text-caption ${
                        selected ? 'text-stone-300 dark:text-stone-600' : 'text-stone-500 dark:text-stone-400'
                      }`}>
                      {FRIENDSHIP_TYPE_DESCRIPTIONS[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {friendshipTypeNotice && (
              <Text className="text-caption text-amber-600 dark:text-amber-400">{friendshipTypeNotice}</Text>
            )}
          </Section>

          <Section title="How often you like to meet up" matching={MATCH_USE.meetingFreq}>
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

          <Section title="How quickly you tend to reply" matching={MATCH_USE.responseTime}>
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

          <Section title="When you're generally free to meet" subtitle="Choose any that fit." matching={MATCH_USE.availability}>
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

          {shows(STEP_COMMUNICATION_STYLE) && (
          <>
          <Section title="Are bars or drinks okay when you meet?" matching={MATCH_USE.bars}>
            <View className="flex-row flex-wrap gap-2">
              {BAR_CHOICES.map((choice) => (
                <Chip
                  key={choice.value}
                  label={choice.label}
                  selected={profile.barPreference === choice.value}
                  onPress={() => updateAndSave({ barPreference: choice.value })}
                />
              ))}
            </View>
          </Section>

          <Section title="Good to know about me" subtitle="Optional." matching={MATCH_USE.goodToKnow}>
            <VoiceTextInput
              value={profile.dealbreakers}
              onChangeText={(text) => setProfile((p) => ({ ...p, dealbreakers: text.slice(0, 300) }))}
              onBlur={() => persist(profile)}
              numberOfLines={3}
              minHeightClassName="min-h-20"
              placeholder={goodToKnowExample}
            />
          </Section>

          <Section title="How I like care" subtitle={`${CARE_STYLE_PROMPT} Optional.`} matching={MATCH_USE.care}>
            <VoiceTextInput
              value={profile.careStyle}
              onChangeText={(text) => setProfile((p) => ({ ...p, careStyle: text }))}
              onBlur={() => persist(profile)}
              numberOfLines={3}
              minHeightClassName="min-h-20"
              placeholder={CARE_STYLE_EXAMPLES}
            />
          </Section>
          </>
          )}

          {shows(STEP_LANGUAGES) && (
          <>
          <Section
            title="Languages I am comfortable connecting in"
            subtitle="Choose all you're comfortable with."
            matching={MATCH_USE.languages}>
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

          </>
          )}

          {shows(STEP_PHOTO) && (
          <Section
            title="Photos"
            matching={MATCH_USE.photos}
            subtitle="One clear photo of your face, and up to 2 more if you like. Your selfie check is compared with the first one.">
            <View className="flex-row items-center gap-4">
              {profile.photoUrl ? (
                <Image source={{ uri: profile.photoUrl }} className="h-16 w-16 rounded-full" />
              ) : (
                <View className="h-16 w-16 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-700">
                  <Text className="text-caption text-stone-400 dark:text-stone-500">No photo</Text>
                </View>
              )}
              <Pressable
                onPress={() => pickPhoto('main')}
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
            <Text className="text-caption text-stone-500 dark:text-stone-400">{PHOTO_RULES_TEXT}</Text>
            {/* Trust and safety gate: a profile with no photo cannot
                appear in Discover or Browse at all (enforced server-side,
                discovery_profiles/browse_profiles both require
                photo_url is not null, not just a display convention).
                Surfaced here clearly rather than leaving it a silent
                gap someone would only discover by not getting matches. */}
            {!profile.photoUrl && (
              <Text className="text-caption text-amber-600 dark:text-amber-400">
                Without a photo, you won&apos;t appear to anyone, and you can&apos;t say hello.
              </Text>
            )}
            {profile.photoUrl && (
              <View className="gap-2 pt-2">
                <Text className="text-caption text-stone-500 dark:text-stone-400">More photos (optional)</Text>
                <View className="flex-row flex-wrap items-center gap-3">
                  {profile.extraPhotoUrls.map((url) => (
                    <Pressable
                      key={url}
                      onPress={() =>
                        updateAndSave({ extraPhotoUrls: profile.extraPhotoUrls.filter((u) => u !== url) })
                      }
                      accessibilityLabel="Remove this photo"
                      className="items-center gap-1">
                      <Image source={{ uri: url }} className="h-16 w-16 rounded-xl" />
                      <Text className="text-caption text-stone-500 dark:text-stone-400">Remove</Text>
                    </Pressable>
                  ))}
                  {profile.extraPhotoUrls.length < 2 && (
                    <Pressable
                      onPress={() => pickPhoto('extra')}
                      disabled={uploadingPhoto}
                      className="h-16 w-16 items-center justify-center rounded-xl border border-dashed border-stone-300 dark:border-stone-600">
                      <Text className="text-title text-stone-400">+</Text>
                    </Pressable>
                  )}
                </View>
              </View>
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
          {/* Edit profile: each part in the list says "Needs an answer" instead of one long line here. */}
          {/* Onboarding pagination: on every step but the last, only THIS
              step's own missing required fields are shown, per instruction
              ("blocks progression at the right step, not just at the
              end"). The last step shows the exact same full-list message
              edit mode always has, since that's genuinely the final,
              whole-profile check, unchanged from before pagination. */}
          {!isEditMode && attemptedContinue && stepMissingFields.length > 0 && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Still needed: {stepMissingFields.join(', ')}
            </Text>
          )}
          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
          {isEditMode && editSection === null && (
            <Pressable onPress={handleCancelEdit} disabled={cancelling} className="items-center py-1">
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                {cancelling ? 'Undoing...' : 'Undo my changes since I opened this'}
              </Text>
            </Pressable>
          )}
          {isEditMode && editSection !== null ? (
            <Pressable
              onPress={() => openSection(null)}
              className="items-center rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50">
              <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">Done with this part</Text>
            </Pressable>
          ) : (
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
                  ? 'Answer the parts marked "Needs an answer"'
                  : 'Done'
                : 'Continue'}
            </Text>
          </Pressable>
          )}
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
