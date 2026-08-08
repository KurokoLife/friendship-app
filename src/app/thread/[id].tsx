import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivitySuggestionsModal } from '@/components/activity-suggestions-modal';
import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { CoachMark } from '@/components/coach-mark';
import { EndConnectionModal } from '@/components/end-connection-modal';
import { FirstMeetupMilestoneModal } from '@/components/first-meetup-milestone-modal';
import { FollowUpReflectionCard } from '@/components/follow-up-reflection-card';
import { GraduationModal } from '@/components/graduation-modal';
import { MeetupCheckinCard } from '@/components/meetup-checkin-card';
import { MeetupConfirmationCard } from '@/components/meetup-confirmation-card';
import { MeetupOutcomeCard } from '@/components/meetup-outcome-card';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { ConversationFlowPromptCard } from '@/components/conversation-flow-prompt-card';
import { MeetupSuggestionBanner } from '@/components/meetup-suggestion-banner';
import { ReplyAssistPanel, type ReplyAssistContextMessage } from '@/components/reply-assist-panel';
import { ReportModal } from '@/components/report-modal';
import { SpotlightTarget } from '@/components/spotlight-target';
import { CreditBlockedError, DraftServiceError, UniversalTextBox } from '@/components/universal-text-box';
import { fetchActiveReflections, type FollowUpReflection } from '@/lib/follow-up-reflection';
import { fetchGraduationEligibility, shouldShowGraduationPrompt } from '@/lib/graduation';
import { track } from '@/lib/analytics';
import {
  dismissMeetupSuggestionPermanently,
  fetchMeetupSuggestionState,
  shouldShowMeetupSuggestion,
  snoozeMeetupSuggestion,
  type MeetupSuggestionState,
} from '@/lib/meetup-suggestion';
import {
  dismissMeetupOutcome,
  fetchMeetupCheckinStatus,
  fetchMeetupLog,
  fetchNextMeetupStatus,
  fetchPendingMeetupConfirmation,
  formatMeetupDateShort,
  hasAckedNextMeetupFeeling,
  proposeNextMeetup,
  recordPlanActivity,
  submitNextMeetupFeeling,
  type MeetupCheckinStatus,
  type MeetupConfirmationRequest,
  type MeetupLogEntry,
  type NextMeetupStatus,
} from '@/lib/meetup-milestones';
import { NextMeetupIndicator } from '@/components/next-meetup-indicator';
import { NextMeetupFeelingCard } from '@/components/next-meetup-feeling-card';
import { formatMeetupDate } from '@/lib/remember';
import { fetchLatestRememberNote } from '@/lib/remember';
import { RememberReminderCard } from '@/components/remember-reminder-card';
import {
  bestPromptPerConnection,
  fetchActivePrompts,
  HONEST_EXIT_RECEIVER_TEXT,
  HONEST_EXIT_SENDER_TEXT,
  resumeConnection,
  senderReassuranceLine,
  type NoGhostPrompt,
} from '@/lib/no-ghost';
// F20 disabled 2026-07-16, see PROGRESS.md: detection was incorrectly
// flagging normal back-and-forth conversations as one-sided. Code kept
// in place, not deleted, for a future re-enable once the heuristic is
// improved.
// import { isDoingMostOfTheWork, RECIPROCITY_NOTE } from '@/lib/reciprocity';
import { subscribeToMessages } from '@/lib/realtime-messages';
import {
  dismissRhythmMismatch,
  hasDismissedRhythmMismatch,
  isReplyingMuchFaster,
  rhythmMismatchNote,
} from '@/lib/rhythm-mismatch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Message = {
  id: string;
  connection_id: string;
  sender_id: string;
  content: string;
  type: string;
  read_at: string | null;
  created_at: string;
};

type OtherParticipant = {
  display_name: string | null;
  response_time: string | null;
  messaging_preference: string | null;
};

const MESSAGING_PREFERENCE_GENDER_VALUES = ['woman', 'man', 'non_binary', 'transgender', 'queer'];

// Part 1, 2026-08-14: mirrors first_message_allowed_by_preference() (the
// real, enforcing copy of this logic, at the messages INSERT RLS layer)
// exactly, so this client-side gate never drifts from what the database
// will actually accept or reject. Kept deliberately duplicated rather
// than shared, Deno edge functions and RLS SQL can't import from this
// file and this logic is small enough that duplication is lower-risk
// than a cross-runtime shared-module setup for one function.
function firstMessageAllowedByPreference(
  receiverPreference: string | null,
  senderGenderIdentity: string | null
): boolean {
  if (!receiverPreference || receiverPreference === 'anyone') return true;
  if (receiverPreference === 'only_people_i_message_first') return false;
  if (MESSAGING_PREFERENCE_GENDER_VALUES.includes(receiverPreference)) {
    return senderGenderIdentity === receiverPreference;
  }
  return true;
}

// Quiet, expectation-setting phrasing, never judgmental, matching the
// exact style requested ("Maria typically replies within a day"). Keyed
// to profile-build.tsx's closed RESPONSE_TIME option set.
const RESPONSE_TIME_PHRASES: Record<string, string> = {
  'Within hours': 'typically replies within hours',
  'Same day': 'typically replies within a day',
  '1-2 days': 'typically replies within a couple of days',
  'A few days': 'typically takes a few days to reply',
};

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// F16: the core connection layer between two matched users. Clean,
// minimal thread, no GIFs, no emoji reactions, no stickers. Read receipts
// are private to the receiver, this screen never renders read_at for the
// sender's own messages, only marks incoming messages read on the
// receiving side (see the "Recipients can mark messages as read" RLS
// policy in 20260712000004_add_messages.sql, which enforces the same
// rule at the data layer).
export default function ThreadScreen() {
  const { id: connectionId } = useLocalSearchParams<{ id: string }>();
  const [myId, setMyId] = useState<string | null>(null);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [other, setOther] = useState<OtherParticipant | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyAssistVisible, setReplyAssistVisible] = useState(false);
  const [noGhostPrompt, setNoGhostPrompt] = useState<NoGhostPrompt | null>(null);
  // Kept separate from noGhostPrompt: sending the honest-exit message
  // triggers this same screen's own realtime onInsert handler, which
  // unconditionally nulls noGhostPrompt the moment the message lands,
  // unmounting ConversationFlowPromptCard (and its local exitConfirmed
  // state) before the sender ever sees the required confirmation copy.
  // This flag lives at the screen level instead, so the confirmation
  // survives that unmount.
  const [honestExitSent, setHonestExitSent] = useState(false);
  const [followUpReflection, setFollowUpReflection] = useState<FollowUpReflection | null>(null);
  const [rhythmNoteDismissed, setRhythmNoteDismissed] = useState(false);
  const [meetupSuggestionState, setMeetupSuggestionState] = useState<MeetupSuggestionState | null>(null);
  const [activitySuggestionsVisible, setActivitySuggestionsVisible] = useState(false);
  const [checkinStatus, setCheckinStatus] = useState<MeetupCheckinStatus | null>(null);
  // Graduation foundation (2026-08-25): a separate signal from
  // checkinStatus above, fires only when the OTHER participant just
  // reported a meetup happened, decoupled from this viewer's own
  // checkinStatus (which may not exist, may be unresolved, or may already
  // be resolved, none of that matters here). meetupLog backs the thread
  // header's "Met N times · date, date, date" display, only ever grows on
  // a real mutual confirm.
  const [pendingMeetupConfirmation, setPendingMeetupConfirmation] = useState<MeetupConfirmationRequest | null>(null);
  const [meetupLog, setMeetupLog] = useState<MeetupLogEntry[]>([]);
  const [graduationModalVisible, setGraduationModalVisible] = useState(false);
  const [showFirstMilestone, setShowFirstMilestone] = useState(false);
  // Item 4, 2026-08-16: next-meetup date. nextMeetupStatus backs the
  // always-visible NextMeetupIndicator; feelingAcked tracks whether the
  // CURRENT viewer has already tapped through today's day-of feeling
  // check for the currently confirmed date specifically (re-fetched
  // whenever the date itself changes, so a new confirmed cycle correctly
  // shows the card again even on the same calendar day it was set).
  const [nextMeetupStatus, setNextMeetupStatus] = useState<NextMeetupStatus>({
    date: null,
    status: null,
    proposedBy: null,
  });
  const [feelingAcked, setFeelingAcked] = useState(false);
  const [rememberReminderNote, setRememberReminderNote] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  // 20260818000000: the standalone Honest Exit entry point, reachable
  // directly from the header at the user's own initiative, independent of
  // any no-ghost escalation or meetup-outcome trigger.
  const [endConnectionVisible, setEndConnectionVisible] = useState(false);
  // Ambiguous-state fix: whether the CURRENT VIEWER is the one who
  // blocked the other participant, as opposed to the one who was
  // blocked. Only meaningful when connectionStatus === 'blocked'.
  // Sourced from the blocks table's own self-row-only SELECT RLS
  // ("Users can read their own blocks", 20260729000000: auth.uid() =
  // blocker_id), which already makes it structurally impossible for the
  // blocked person to ever see the other side's block row, this state
  // just reflects that: a genuine result of "did I block them", not a
  // client-side guess that could leak the answer to the wrong person.
  const [isBlocker, setIsBlocker] = useState(false);
  // 2026-07-30: photo-required-for-first-message. Fetched once alongside
  // the other initial reads, before `loaded` flips true, so this never
  // flashes the gate for a user who legitimately has a photo while the
  // real value is still in flight.
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | null>(null);
  // Part 1, 2026-08-14: messaging_preference enforcement, same
  // fetched-once-before-`loaded` reasoning as myPhotoUrl above. Self-row
  // readable directly (users' own SELECT RLS), the other participant's
  // own messaging_preference comes from `other` (connection_participant_
  // profiles) instead, fetched in the same initial batch.
  const [myGenderIdentity, setMyGenderIdentity] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const loadMeetupSuggestionState = useCallback(async () => {
    if (!connectionId) return;
    setMeetupSuggestionState(await fetchMeetupSuggestionState(connectionId));
  }, [connectionId]);

  // 2026-07-28 milestone redesign: no scheduled_at/confirmed_at date
  // exists anywhere anymore, so there's nothing to fetch on a timer. One
  // read covers both possible cards: an unresolved row (my_resolved_at
  // null) means MeetupCheckinCard should show, a resolved row with a
  // branch means MeetupOutcomeCard should show. No row at all means
  // neither, the normal, most-of-the-time case.
  const loadCheckinStatus = useCallback(async () => {
    if (!connectionId) return;
    setCheckinStatus(await fetchMeetupCheckinStatus(connectionId));
  }, [connectionId]);

  const loadPendingMeetupConfirmation = useCallback(async () => {
    if (!connectionId) return;
    setPendingMeetupConfirmation(await fetchPendingMeetupConfirmation(connectionId));
  }, [connectionId]);

  const loadMeetupLog = useCallback(async () => {
    if (!connectionId) return;
    setMeetupLog(await fetchMeetupLog(connectionId));
  }, [connectionId]);

  // Graduation: checked alongside meetupLog (both react to the same
  // underlying event, a meetup_count change via mutual confirmation),
  // fires the "Shown" analytics event exactly once per genuine
  // transition into visible, not on every re-check while it's already
  // showing or already dismissed.
  const checkGraduationEligibility = useCallback(async () => {
    if (!connectionId) return;
    const eligibility = await fetchGraduationEligibility(connectionId);
    const shouldShow = shouldShowGraduationPrompt(eligibility);
    setGraduationModalVisible((wasVisible) => {
      if (shouldShow && !wasVisible) {
        track('graduation_shown', { connectionId });
      }
      return shouldShow;
    });
  }, [connectionId]);

  // Item 4, 2026-08-16: reloaded after propose/confirm/reschedule so the
  // indicator reflects the real, persisted state rather than an
  // optimistic local guess (same reasoning every other RPC-backed status
  // in this file already follows). Also re-checks the day-of feeling ack
  // for whatever date is now current, keyed by date (not just "have I
  // ever acked"), so a reschedule to a new date correctly shows the
  // feeling card again even if an earlier date's cycle was already acked.
  // Accepts an explicit viewer id (mirroring markIncomingRead's own
  // pattern below) rather than only reading the myId state, since the
  // very first call happens inside the same initial-load effect that
  // just set myId, before that state update has actually landed in this
  // closure.
  const loadNextMeetupStatus = useCallback(
    async (viewerId?: string) => {
      if (!connectionId) return;
      const resolvedViewerId = viewerId ?? myId;
      const status = await fetchNextMeetupStatus(connectionId);
      setNextMeetupStatus(status);
      if (status.date && status.status === 'confirmed' && resolvedViewerId) {
        setFeelingAcked(await hasAckedNextMeetupFeeling(connectionId, resolvedViewerId, status.date));
      } else {
        setFeelingAcked(false);
      }
    },
    [connectionId, myId]
  );

  // Persisted (meetup_outcome_dismissals), not client-only: this app's Back
  // button always calls router.replace(), so the thread screen never
  // survives a real exit and re-entry the way a tab screen does, a purely
  // local dismiss resurfaced on almost every real visit. Re-fetches
  // checkinStatus after the write so the now-true outcome_dismissed flag
  // (and the render condition reading it) reflect the real, persisted
  // state, not an optimistic local guess.
  const handleDismissCheckinOutcome = useCallback(async () => {
    if (!checkinStatus || !myId) return;
    await dismissMeetupOutcome(checkinStatus.checkin_id, myId);
    await loadCheckinStatus();
  }, [checkinStatus, myId, loadCheckinStatus]);

  const loadNoGhostPrompt = useCallback(async () => {
    if (!connectionId) return;
    const prompts = await fetchActivePrompts();
    const best = bestPromptPerConnection(prompts).get(connectionId) ?? null;
    setNoGhostPrompt(best);
  }, [connectionId]);

  // Fix #2: re-read after any action that might change status (a prompt
  // resolving into Pause, or an explicit Resume), rather than trusting
  // the one-time value from the initial connection fetch below. Also
  // re-derives isBlocker whenever status is 'blocked' (covers both a
  // fresh block just made by this viewer, via handleBlocked below, and
  // a block that already existed when this screen first loaded).
  const loadConnectionStatus = useCallback(async () => {
    if (!connectionId || !otherId) return;
    const { data } = await supabase.from('connections').select('status').eq('id', connectionId).maybeSingle();
    const status = data?.status ?? null;
    setConnectionStatus(status);
    if (status === 'blocked') {
      const { data: myBlock } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', myId)
        .eq('blocked_id', otherId)
        .maybeSingle();
      setIsBlocker(Boolean(myBlock));
    }
  }, [connectionId, otherId, myId]);

  const handleNoGhostResolved = useCallback(async () => {
    await loadNoGhostPrompt();
    await loadConnectionStatus();
  }, [loadNoGhostPrompt, loadConnectionStatus]);

  const handleResume = useCallback(async () => {
    if (!connectionId) return;
    await resumeConnection(connectionId);
    await loadConnectionStatus();
  }, [connectionId, loadConnectionStatus]);

  // Report & Block: blocking is immediate and needs no further
  // confirmation step here, block_user() already did the real work
  // (the RPC call inside BlockConfirmModal), this just re-reads the
  // connection's own status so the thread reflects the block right away,
  // hiding compose and every active prompt card in the same render pass.
  const handleBlocked = useCallback(async () => {
    setBlockConfirmVisible(false);
    await loadConnectionStatus();
  }, [loadConnectionStatus]);

  // "End the connection" (no-ghost escalation card's exit option, and the
  // meetup-outcome not_good card's exit option) now atomically flips
  // connections.status to 'ended'. honestExitSent is what keeps the
  // sender's own "Choosing honesty over silence..." confirmation visible
  // (both cards render it locally the instant this fires), and
  // loadConnectionStatus() is what makes the rest of the screen (the
  // banner, the footer, the "connection isn't ended" gate around every
  // other prompt/card) actually reflect the real, now-closed state,
  // rather than only reacting on the next unrelated reload.
  const handleExitConfirmed = useCallback(() => {
    setHonestExitSent(true);
    loadConnectionStatus();
  }, [loadConnectionStatus]);

  // F19: separate from no-ghost, its own table, its own priority (shown
  // only when no no-ghost prompt is active, see the render below).
  const loadFollowUpReflection = useCallback(async () => {
    if (!connectionId) return;
    const reflections = await fetchActiveReflections();
    setFollowUpReflection(reflections.find((r) => r.connection_id === connectionId) ?? null);
  }, [connectionId]);

  const markIncomingRead = useCallback(
    async (viewerId: string) => {
      if (!connectionId) return;
      await supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('connection_id', connectionId)
        .neq('sender_id', viewerId)
        .is('read_at', null);
    },
    [connectionId]
  );

  useEffect(() => {
    if (!isSupabaseConfigured || !connectionId) {
      setLoaded(true);
      return;
    }

    // Real bug, confirmed live (not just theorized): this effect can run
    // twice for a single navigation (confirmed via direct instrumentation,
    // ~380ms apart, same connectionId, in this dev environment, most
    // likely Expo Router wrapping routes in StrictMode during development).
    // Without this flag, the first invocation's cleanup fires before its
    // own async chain has reached subscribeToMessages below (there are many
    // awaited steps ahead of it), so `unsubscribe` is still null and
    // cleanup is a no-op. The first invocation's async work keeps running
    // in the background regardless, and eventually registers its OWN
    // realtime handler anyway, on top of the second invocation's. Both then
    // stay registered for the lifetime of the real mount, so every single
    // INSERT event calls setMessages twice, appending the identical row
    // (identical id) to the array twice, which is exactly what produced the
    // "Encountered two children with the same key" React warning and the
    // visibly duplicated message bubble a real user reported. `cancelled`
    // is checked immediately after subscribing (no await in between, so no
    // race window) and tears down a subscription that was registered by an
    // invocation React had already asked to clean up.
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoaded(true);
        return;
      }
      setMyId(user.id);

      const { data: connection } = await supabase
        .from('connections')
        .select('user_a_id, user_b_id, status')
        .eq('id', connectionId)
        .maybeSingle();

      if (!connection) {
        setNotFound(true);
        setLoaded(true);
        return;
      }

      const otherUserId = connection.user_a_id === user.id ? connection.user_b_id : connection.user_a_id;
      setOtherId(otherUserId);
      setConnectionStatus(connection.status);

      const [{ data: otherProfile }, { data: existingMessages }, dismissed, { data: myProfile }, { data: myUserRow }] =
        await Promise.all([
          // 2026-08-11 fix: was discovery_profiles, keyed by user_id, whose
          // WHERE clause hard-filters on gender/pause compatibility, a
          // real photo, mutual age range, radius, and block status. Any of
          // those drifting after this connection was formed (most
          // commonly: no photo, or a block) silently returned null here,
          // falling back to "A member" for two real, already-connected
          // participants. connection_participant_profiles (20260811000000)
          // is a plain, unfiltered view over profiles, keyed by
          // connection_id, the same pattern inbox_conversations already
          // uses to resolve this exact name correctly. Extended
          // 2026-08-14 (Part 1) with messaging_preference for the new
          // first-message gate below.
          supabase
            .from('connection_participant_profiles')
            .select('display_name, response_time, messaging_preference')
            .eq('connection_id', connectionId)
            .maybeSingle(),
          supabase
            .from('messages')
            .select('*')
            .eq('connection_id', connectionId)
            .order('created_at', { ascending: true }),
          hasDismissedRhythmMismatch(connectionId, user.id),
          supabase.from('profiles').select('photo_url').eq('user_id', user.id).maybeSingle(),
          supabase.from('users').select('gender_identity').eq('id', user.id).maybeSingle(),
        ]);

      setOther(otherProfile ?? null);
      setMessages((existingMessages ?? []) as Message[]);
      setRhythmNoteDismissed(dismissed);
      setMyGenderIdentity(myUserRow?.gender_identity ?? null);
      setMyPhotoUrl(myProfile?.photo_url ?? null);

      // Ambiguous-state fix: only meaningful (and only queried) when
      // this connection is actually blocked. blocks' own SELECT RLS
      // ("Users can read their own blocks", auth.uid() = blocker_id)
      // means this always comes back empty for the blocked person, they
      // structurally cannot see the other side's block row, this is not
      // a client-side guess.
      if (connection.status === 'blocked') {
        const { data: myBlock } = await supabase
          .from('blocks')
          .select('id')
          .eq('blocker_id', user.id)
          .eq('blocked_id', otherUserId)
          .maybeSingle();
        setIsBlocker(Boolean(myBlock));
      }

      setLoaded(true);
      await markIncomingRead(user.id);
      await loadNoGhostPrompt();
      await loadFollowUpReflection();
      await loadMeetupSuggestionState();
      await loadCheckinStatus();
      await loadPendingMeetupConfirmation();
      await loadMeetupLog();
      await checkGraduationEligibility();
      await loadNextMeetupStatus(user.id);

      // Shared channel (src/lib/realtime-messages.ts), not a per-screen
      // one, so this and the inbox screen's own subscription can never
      // collide, filtering by connection_id happens here client-side
      // instead of via a server-side channel filter, since the channel
      // itself is shared across connections now.
      const realtimeUnsubscribe = subscribeToMessages({
        onInsert: (payload) => {
          const incoming = payload.new as Message;
          if (incoming.connection_id !== connectionId) return;
          // Defense in depth, independent of the cancelled-effect fix
          // above: never append a message id that's already in the list,
          // regardless of why a duplicate delivery might happen (a stray
          // second subscription, or Realtime's own occasional redelivery
          // on reconnect). This is what actually stops "two children with
          // the same key" at the render level, the cancelled flag above
          // stops the stray subscription from existing in the first place,
          // together they cover both the cause and the symptom.
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          if (incoming.sender_id !== user.id) {
            markIncomingRead(user.id);
          }
          // A new message clears no-ghost tracking for this connection
          // (20260712000007's trigger), so any prompt shown here is
          // stale the moment either side sends something. Same reasoning
          // for the follow-up reflection prompt (F19's own clearing
          // trigger, 20260718000000).
          setNoGhostPrompt(null);
          setFollowUpReflection(null);
        },
      });
      if (cancelled) {
        realtimeUnsubscribe();
        return;
      }
      unsubscribe = realtimeUnsubscribe;
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [
    connectionId,
    markIncomingRead,
    loadNoGhostPrompt,
    loadFollowUpReflection,
    loadMeetupSuggestionState,
    loadCheckinStatus,
    loadPendingMeetupConfirmation,
    loadMeetupLog,
    checkGraduationEligibility,
    loadNextMeetupStatus,
  ]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const sendMessage = async (content: string) => {
    if (!content || !myId || !connectionId) return;
    const { error } = await supabase.from('messages').insert({
      connection_id: connectionId,
      sender_id: myId,
      content,
      type: 'text',
    });
    // 2026-08-14: this used to never check the insert's own error at
    // all, so a genuine RLS rejection (the photo gate, and now the
    // messaging_preference gate) silently dropped the message with zero
    // feedback, while handleSend below had already cleared the draft
    // unconditionally, losing the user's own typed text on any failure,
    // not just this one. The proactive UI gates above cover the normal
    // case, this is the honest fallback for a race condition (e.g. the
    // other participant's messaging_preference changes between this
    // screen loading and the send itself).
    if (error) throw error;
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(content);
      setDraft('');
    } catch {
      setSendError("That message couldn't be sent. Nothing was lost, your draft is still here.");
    } finally {
      setSending(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  if (notFound || !myId) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That conversation isn&apos;t available.
        </Text>
      </View>
    );
  }

  // 2026-08-11: neither the response-time line nor the sender
  // reassurance line make sense once a connection is blocked or
  // inactive, no reply is coming either way, and for the ambiguous
  // (blocked, not-the-blocker) viewer specifically, a stray "you may
  // keep waiting on a reply" line right above a "this conversation
  // isn't available" banner would read as a contradiction, undermining
  // the whole point of that banner being genuinely neutral.
  const conversationEnded =
    connectionStatus === 'blocked' || connectionStatus === 'inactive' || connectionStatus === 'ended';
  const responsePhrase =
    !conversationEnded && other?.response_time ? RESPONSE_TIME_PHRASES[other.response_time] : null;

  // Fix #2: sender-only passive reassurance line (blueprint's 20h and
  // 72h-in-Chat checkpoints), only shown to whoever sent the last
  // message and is waiting on a reply, never to the recipient (they get
  // the actual prompt card instead, when due). Disappears once a reply
  // lands or the real S1 prompt (125h) takes over the same header slot.
  const lastMessage = messages[messages.length - 1];
  const isSenderWaiting = Boolean(lastMessage && myId && lastMessage.sender_id === myId);
  const hoursSinceSent = lastMessage
    ? (Date.now() - new Date(lastMessage.created_at).getTime()) / (60 * 60 * 1000)
    : 0;
  const statusLine =
    !conversationEnded && isSenderWaiting && !noGhostPrompt
      ? senderReassuranceLine(other?.display_name ?? 'They', responsePhrase, hoursSinceSent, false)
      : null;

  // F16 update: a real behavioral mismatch (I'm replying much faster than
  // they are), computed from actual message timestamps, distinct from the
  // stated-preference response line above. Only shown to whoever is the
  // fast one, once per connection, dismissible, never again after that.
  const showRhythmMismatchNote =
    !conversationEnded && !rhythmNoteDismissed && myId !== null && isReplyingMuchFaster(messages, myId);
  const rhythmNoteText = showRhythmMismatchNote
    ? rhythmMismatchNote(other?.display_name ?? 'They', other?.response_time ?? null)
    : null;

  // F22: fires once the conversation reaches 7 messages (of the given
  // "7-10" range). The old "never while a meetup is already planned"
  // gate is gone along with the concept of an active meetup, there's
  // nothing left to actively plan against, snooze/permanent-dismiss are
  // the only remaining controls on repeat firing.
  const showMeetupSuggestion = shouldShowMeetupSuggestion(messages.length, meetupSuggestionState, connectionStatus);

  // 2026-07-28 milestone redesign: both the manual "Let's plan
  // something" button and the automatic banner's "Yes" route through
  // here, so first-time engagement is detected consistently regardless
  // of which entry point the user actually used. record_plan_activity
  // also clears any stale checkin row from a prior planning cycle
  // (a fresh cycle starting over), so checkin state is reloaded after.
  const handlePlanSomething = async () => {
    if (!connectionId) return;
    const isFirstTime = await recordPlanActivity(connectionId);
    await loadCheckinStatus();
    // Item 4, 2026-08-16: "Either 'Let's plan something' auto-populates
    // the date, or either user sets/edits it directly." Read literally:
    // engaging this flow with no date currently active gives the
    // NextMeetupIndicator a real, editable starting point (today) rather
    // than leaving it empty, without inventing any date-guessing logic
    // beyond that. Only fires when nothing is already proposed/confirmed,
    // never silently overwrites a real in-progress date the two people
    // are already coordinating on.
    if (!nextMeetupStatus.date) {
      await proposeNextMeetup(connectionId, formatMeetupDate(new Date()));
      await loadNextMeetupStatus();
    }
    if (isFirstTime) {
      setShowFirstMilestone(true);
      return;
    }
    // Remember Step 2: no scheduled date exists to anchor a "day before"
    // reminder to anymore, so this is the next real planning moment
    // instead. Only surfaces when there's actually something noted, a
    // connection with no Remember entries goes straight into activity
    // suggestions exactly as before this feature existed.
    const note = connectionId ? await fetchLatestRememberNote(connectionId) : null;
    if (note) {
      setRememberReminderNote(note);
    } else {
      setActivitySuggestionsVisible(true);
    }
  };

  const handleRememberReminderContinue = () => {
    setRememberReminderNote(null);
    setActivitySuggestionsVisible(true);
  };

  const handleMeetupSuggestionNotYet = async () => {
    if (!connectionId) return;
    await snoozeMeetupSuggestion(connectionId, messages.length);
    await loadMeetupSuggestionState();
  };

  const handleMeetupSuggestionDontRemindMe = async () => {
    if (!connectionId) return;
    await dismissMeetupSuggestionPermanently(connectionId);
    await loadMeetupSuggestionState();
  };

  const handleFirstMilestoneClose = () => {
    setShowFirstMilestone(false);
    setActivitySuggestionsVisible(true);
  };

  const handleDismissRhythmNote = async () => {
    if (!connectionId || !myId) return;
    setRhythmNoteDismissed(true);
    await dismissRhythmMismatch(connectionId, myId);
  };

  // F20 disabled 2026-07-16 (see PROGRESS.md): the detection heuristic
  // incorrectly flagged normal back-and-forth conversations as one-sided.
  // Kept commented out, not deleted, pending a better approach.
  // const showReciprocityNote = Boolean(myId) && isDoingMostOfTheWork(messages, myId as string);
  const showReciprocityNote = false;

  // F18: last 3-5 messages, in order, as context for the draft. Only
  // sender/content cross into the Edge Function, nothing else about the
  // conversation.
  const replyAssistContext: ReplyAssistContextMessage[] = messages.slice(-5).map((m) => ({
    sender: m.sender_id === myId ? 'me' : 'them',
    content: m.content,
  }));

  const requestComposeDraft = async (situation: string): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('generate-reply-draft', {
      body: { rawInput: situation, recentMessages: replyAssistContext },
    });
    if (error) throw error;
    // 2026-07-30 fix: this custom onRequestDraft previously never checked
    // data?.blocked, so a real cap/pool block on this specific surface
    // fell through to the generic "No draft returned" error below instead
    // of UniversalTextBox's own CreditBlockedError handling (the blocked
    // message plus the "Get 50 AI credits" button, already working on
    // every other AI-assist surface in the app). Matches the exact check
    // order UniversalTextBox's own internal requestDraft already uses.
    if (data?.blocked) throw new CreditBlockedError(data.message as string, data.tier as string | undefined);
    if (data?.error) throw new DraftServiceError(data.error as string);
    if (!data?.draft) throw new Error('No draft returned');
    return data.draft as string;
  };

  // 2026-07-30: a brand-new conversation (zero messages either direction)
  // requires the sender to have a real profile photo before their first
  // message goes out. Replying once a conversation is underway never
  // needs one, regardless of when either participant added or removed a
  // photo afterward. This is a proactive UI gate; the real enforcement is
  // the messages INSERT RLS policy itself (20260807000000), matching this
  // app's own established pattern (Report & Block) of never relying on a
  // client-side hide alone for something this consequential.
  const needsPhotoForFirstMessage = messages.length === 0 && myPhotoUrl === null;

  // Part 1, 2026-08-14: same "brand-new conversation only" scoping as the
  // photo gate above, mirroring it exactly per instruction. Real
  // enforcement is the messages INSERT RLS policy itself
  // (20260814000000, first_message_allowed_by_preference); this is the
  // proactive UI half.
  const blockedByPreference =
    messages.length === 0 && !firstMessageAllowedByPreference(other?.messaging_preference ?? null, myGenderIdentity);

  let lastDateLabel = '';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1">
        <View className="gap-1 border-b border-stone-200 px-6 pb-4 pt-4 dark:border-stone-800">
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => router.replace('/home')}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
            </Pressable>
            {/* Report & Block: always reachable from Chat regardless of
                connection state, safety concerns shouldn't depend on
                anything else being active first. End Connection
                (20260818000000): the standalone Honest Exit entry point,
                usable on any healthy connection at the user's own
                initiative, deliberately NOT shown once the connection is
                already blocked/inactive/ended, ending an already-ended
                connection has nothing left to do. */}
            <View className="flex-row gap-4">
              {!conversationEnded && (
                <Pressable onPress={() => setEndConnectionVisible(true)}>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">End</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setReportModalVisible(true)}>
                <Text className="text-caption text-stone-500 dark:text-stone-400">Report</Text>
              </Pressable>
              <Pressable onPress={() => setBlockConfirmVisible(true)}>
                <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
              </Pressable>
            </View>
          </View>
          {/* F16 update: tapping the name or the rest of the header opens
              the same full-profile screen Discovery and Browse use
              (candidate/[id].tsx). Standard stack push, not a modal, its
              own Back returns here via the native stack, not a hardcoded
              replace, since this is the one place in the app that opens
              that screen from a conversation rather than a discovery
              list. */}
          <Pressable
            onPress={() => otherId && router.push({ pathname: '/candidate/[id]', params: { id: otherId } })}
            disabled={!otherId}>
            <Text className="text-title text-stone-900 dark:text-stone-50">
              {other?.display_name ?? 'A member'}
            </Text>
            {/* S1 (Part 1) subsumes the permanent response-time header
                for the sender during its own 24-hour window ("X typically
                replies within Y. Give it some time."), so the plain
                header line is only shown when S1 isn't already covering
                the same information, avoiding a redundant duplicate. */}
            {responsePhrase && !statusLine && (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                {other?.display_name ?? 'They'} {responsePhrase}.
              </Text>
            )}
            {statusLine && (
              <Text className="text-caption text-stone-400 dark:text-stone-600">{statusLine}</Text>
            )}
            {/* Graduation foundation: only shown once at least one meetup
                is mutually confirmed, per explicit instruction not to
                clutter a thread that hasn't met yet. meetupLog is already
                ordered most-recent-first (fetchMeetupLog's own order). */}
            {meetupLog.length > 0 && (
              <Text className="text-caption text-stone-400 dark:text-stone-600">
                Met {meetupLog.length} {meetupLog.length === 1 ? 'time' : 'times'} ·{' '}
                {meetupLog.map((entry) => formatMeetupDateShort(entry.meetup_date)).join(', ')}
              </Text>
            )}
          </Pressable>
          {rhythmNoteText && (
            <View className="mt-1 flex-row items-start gap-2">
              <Text className="flex-1 text-caption text-stone-400 dark:text-stone-600">{rhythmNoteText}</Text>
              <Pressable onPress={handleDismissRhythmNote}>
                <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Dismiss</Text>
              </Pressable>
            </View>
          )}
          {/* F20 disabled 2026-07-16, see PROGRESS.md. showReciprocityNote is
              hardcoded false above, so this never renders; kept as a
              comment, not deleted, for the eventual re-enable.
          {showReciprocityNote && (
            <Text className="mt-1 text-caption text-stone-400 dark:text-stone-600">{RECIPROCITY_NOTE}</Text>
          )}
          */}
        </View>

        {/* Block: instant and bidirectional. Message history above stays
            fully visible for both participants' own reference (never
            deleted), but every active prompt/card below is hidden and
            the compose footer is replaced. 2026-08-11: the two
            participants deliberately no longer see the same text here.
            The blocker gets this app's own honest, clear state (unique
            to them, since only the blocker's own row in `blocks` is
            ever readable back to them, see isBlocker above). The blocked
            person gets a genuinely ambiguous state below instead, no
            wording anywhere confirms to them that they were specifically
            blocked, matching a real product decision that a block should
            not hand the blocked person a confirmed signal to retaliate
            or re-approach through another channel. */}
        {connectionStatus === 'blocked' && isBlocker && (
          <View className="mx-6 mt-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This connection is blocked. You can no longer message each other.
            </Text>
          </View>
        )}

        {connectionStatus === 'blocked' && !isBlocker && (
          <View className="mx-6 mt-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This conversation isn&apos;t available anymore.
            </Text>
          </View>
        )}

        {/* 2026-08-11: 'inactive' is a real, separate state from
            'blocked', a closed/archived connection (F17's 7-day
            auto-close, or S1's "close and free capacity", or a
            just-unblocked connection, see the messages RLS comment in
            20260811000000), not a safety action, so it gets its own
            honest copy and its own path back in, reusing the exact
            fresh-start mechanism a brand-new connection already uses
            (create_connection_with_capacity_check, reached the same way
            starting any new conversation is: through the person's
            profile). */}
        {connectionStatus === 'inactive' && (
          <View className="mx-6 mt-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This conversation has ended. Visit their profile to say hello again and start fresh.
            </Text>
          </View>
        )}

        {/* 'ended' (20260817000000): a genuine Honest Exit, a deliberate
            decision by one participant to close the connection, distinct
            from both 'blocked' (a safety action, ambiguous to the blocked
            party) and 'inactive' (an auto-close, unblock, or "close and
            make room", none of which were anyone's considered choice to
            leave). Both participants see the exact same honest copy here,
            not Block's differentiated framing, matching Honest Exit's own
            established sender/receiver text. honestExitSent shows the
            sender's own confirmation text in place of the plain banner,
            surviving here rather than only inside the now-hidden prompt
            card, for the same reason the 'blocked' banners above don't
            depend on whichever card originally triggered them. */}
        {connectionStatus === 'ended' && (
          <View className="mx-6 mt-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            {honestExitSent ? (
              <Text className="text-body text-stone-700 dark:text-stone-300">{HONEST_EXIT_SENDER_TEXT}</Text>
            ) : (
              <Text className="text-body text-stone-600 dark:text-stone-400">
                This connection was deliberately ended, not paused or auto-closed. Messaging isn&apos;t
                available here anymore.
              </Text>
            )}
          </View>
        )}

        {connectionStatus !== 'blocked' && connectionStatus !== 'inactive' && connectionStatus !== 'ended' && (
          <>
            {/* Item 4, 2026-08-16: persistent, always at the top of this
                block regardless of how the date got there (direct
                propose, reschedule, or auto-populated via "Let's plan
                something"), per the given spec literally. */}
            {myId && connectionId && (
              <NextMeetupIndicator
                connectionId={connectionId}
                myId={myId}
                otherName={other?.display_name ?? 'them'}
                status={nextMeetupStatus}
                onChanged={loadNextMeetupStatus}
              />
            )}

            {/* Day-of feeling check: only for a real confirmed date whose
                day, compared using the SAME local y/m/d construction as
                every other date comparison in this feature (never a UTC
                round-trip), is today, and only until this viewer has
                acked it once for this specific date cycle. */}
            {nextMeetupStatus.date &&
              nextMeetupStatus.status === 'confirmed' &&
              !feelingAcked &&
              nextMeetupStatus.date === formatMeetupDate(new Date()) && (
                <View className="px-6 pt-4">
                  <NextMeetupFeelingCard
                    otherName={other?.display_name ?? 'them'}
                    onPick={async (feeling) => {
                      if (!connectionId || !myId || !nextMeetupStatus.date) return;
                      await submitNextMeetupFeeling(connectionId, myId, nextMeetupStatus.date, feeling);
                      if (feeling !== 'nervous') setFeelingAcked(true);
                    }}
                    onDone={() => setFeelingAcked(true)}
                  />
                </View>
              )}

            {/* Fix #2: formal Pause state. Shown right under the header
                whenever this connection is paused, this is what makes Pause
                visible to both participants (not just the one who paused
                it), and gives either side a way back out that doesn't
                require sending a message. */}
            {connectionStatus === 'paused' && (
              <View className="mx-6 mt-4 flex-row items-center justify-between gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="flex-1 text-body text-stone-600 dark:text-stone-400">
                  This connection is paused. No reminders will fire until you resume it.
                </Text>
                <Pressable onPress={handleResume}>
                  <Text className="text-caption font-semibold text-accent-500">Resume</Text>
                </Pressable>
              </View>
            )}

            {honestExitSent ? (
              <View className="px-6 pt-4">
                <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-body text-stone-700 dark:text-stone-300">{HONEST_EXIT_SENDER_TEXT}</Text>
                </View>
              </View>
            ) : (
              noGhostPrompt &&
              myId &&
              connectionId &&
              otherId && (
                <>
                  <View className="px-6 pt-4">
                    <CoachMark
                      markKey="no_ghost_prompt"
                      text="A reply hasn't come yet. This isn't about pressure, delays happen for lots of reasons. This is just a gentle nudge, not a guilt trip."
                    />
                  </View>
                  <View className="px-6 pt-4">
                    <SpotlightTarget markKey="no_ghost_prompt">
                      <ConversationFlowPromptCard
                        prompt={noGhostPrompt}
                        otherName={other?.display_name ?? 'them'}
                        otherId={otherId}
                        viewerId={myId}
                        connectionId={connectionId}
                        recentMessages={replyAssistContext}
                        onResolved={handleNoGhostResolved}
                        onExitConfirmed={handleExitConfirmed}
                        onBlocked={handleBlocked}
                      />
                    </SpotlightTarget>
                  </View>
                </>
              )
            )}

            {/* F19: only shown when no no-ghost prompt is active, a
                connection escalating toward silence takes priority over a
                reflection prompt about a healthy conversation. */}
            {!noGhostPrompt && followUpReflection && (
              <View className="px-6 pt-4">
                <FollowUpReflectionCard
                  reflection={followUpReflection}
                  otherName={other?.display_name ?? 'them'}
                  onHelpMeSayIt={() => setReplyAssistVisible(true)}
                  onResolved={loadFollowUpReflection}
                />
              </View>
            )}

            {/* 2026-07-28 milestone redesign: an unresolved checkin (fired
                either by the elapsed-time cron job, or waiting on this
                user's own answer after the other side already reported)
                takes priority over the outcome card below, there's nothing
                to show a resolved branch for until this resolves. */}
            {checkinStatus && !checkinStatus.my_resolved_at && (
              <>
                <View className="px-6 pt-4">
                  <CoachMark
                    markKey="meetup_checkin"
                    text="This check-in isn't a test. However it went, there's no wrong answer, we just want to help you reflect and remember."
                  />
                </View>
                <View className="px-6 pt-4">
                  <SpotlightTarget markKey="meetup_checkin">
                    <MeetupCheckinCard
                      checkinId={checkinStatus.checkin_id}
                      otherName={other?.display_name ?? 'them'}
                      otherReportedOutcome={checkinStatus.other_reported_outcome}
                      onResolved={loadCheckinStatus}
                    />
                  </SpotlightTarget>
                </View>
              </>
            )}

            {checkinStatus?.branch && !checkinStatus.outcome_dismissed && myId && connectionId && (
              <View className="px-6 pt-4">
                <MeetupOutcomeCard
                  connectionId={connectionId}
                  senderId={myId}
                  otherName={other?.display_name ?? 'them'}
                  branch={checkinStatus.branch}
                  onOpenActivitySuggestions={() => setActivitySuggestionsVisible(true)}
                  onResolved={loadCheckinStatus}
                  onDismiss={handleDismissCheckinOutcome}
                  onExitConfirmed={handleExitConfirmed}
                />
              </View>
            )}

            {/* Graduation foundation: a genuinely separate signal from
                checkinStatus above, can appear regardless of whether this
                viewer's own checkin exists, is unresolved, or already has
                a branch, since it's about confirming the OTHER
                participant's report, not this viewer's own record. */}
            {pendingMeetupConfirmation && (
              <View className="px-6 pt-4">
                <MeetupConfirmationCard
                  requestId={pendingMeetupConfirmation.id}
                  otherName={other?.display_name ?? 'them'}
                  reportedMeetupDate={pendingMeetupConfirmation.reported_meetup_date}
                  onResolved={() => {
                    setPendingMeetupConfirmation(null);
                    loadMeetupLog();
                    checkGraduationEligibility();
                  }}
                  onDismissed={() => setPendingMeetupConfirmation(null)}
                />
              </View>
            )}

            {showMeetupSuggestion && (
              <View className="px-6 pt-4">
                <MeetupSuggestionBanner
                  onYes={handlePlanSomething}
                  onNotYet={handleMeetupSuggestionNotYet}
                  onDontRemindMe={handleMeetupSuggestionDontRemindMe}
                />
              </View>
            )}
          </>
        )}

        <ScrollView ref={scrollRef} contentContainerClassName="gap-3 px-6 py-5">
          {messages.length === 0 && (
            <Text className="text-center text-caption text-stone-400 dark:text-stone-600">
              This is the start of your conversation.
            </Text>
          )}
          {messages.map((m) => {
            const label = dateLabel(m.created_at);
            const showDivider = label !== lastDateLabel;
            lastDateLabel = label;
            const isMine = m.sender_id === myId;
            return (
              <View key={m.id}>
                {showDivider && (
                  <Text className="mb-2 mt-1 text-center text-caption text-stone-400 dark:text-stone-600">
                    {label}
                  </Text>
                )}
                <View className={isMine ? 'items-end' : 'items-start'}>
                  <View
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      isMine
                        ? 'bg-stone-900 dark:bg-stone-50'
                        : 'border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
                    }`}>
                    <Text
                      className={`text-body ${
                        isMine ? 'text-stone-50 dark:text-stone-900' : 'text-stone-700 dark:text-stone-300'
                      }`}>
                      {m.content}
                    </Text>
                  </View>
                  <Text className="mt-1 text-caption text-stone-400 dark:text-stone-600">
                    {timeLabel(m.created_at)}
                  </Text>
                  {/* Honest exit (F29, minimal message-level wiring): the
                      sender already saw their own confirmation text right
                      in the prompt card at send time, this is the
                      receiver's side of it, exact wording from AGENTS.md,
                      shown once per message, right where they'd see it. */}
                  {m.type === 'honest_exit' && !isMine && (
                    <Text className="mt-1 max-w-[80%] text-caption text-stone-400 dark:text-stone-600">
                      {HONEST_EXIT_RECEIVER_TEXT}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View className="gap-2 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-3 dark:border-stone-800 dark:bg-stone-900">
        {connectionStatus === 'blocked' && isBlocker ? (
          <Text className="py-3 text-center text-caption text-stone-400 dark:text-stone-600">
            Messaging is unavailable, this connection is blocked.
          </Text>
        ) : connectionStatus === 'blocked' && !isBlocker ? (
          <Text className="py-3 text-center text-caption text-stone-400 dark:text-stone-600">
            Messaging isn&apos;t available in this conversation.
          </Text>
        ) : connectionStatus === 'inactive' ? (
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This conversation has ended. Say hello again from their profile to start a new one.
            </Text>
            <Pressable
              onPress={() => otherId && router.push({ pathname: '/candidate/[id]', params: { id: otherId } })}
              className="self-start">
              <Text className="text-caption font-semibold text-accent-500">View profile</Text>
            </Pressable>
          </View>
        ) : connectionStatus === 'ended' ? (
          // 'ended' reopens with real friction, unlike 'inactive' above:
          // visiting the profile and tapping "Say hello" still shows this
          // same link, but candidate/[id].tsx's own handleMessage now
          // catches a distinct 'ended' capacity error there and requires
          // an explicit extra confirmation before reinitiate_ended_
          // connection() runs, rather than silently flipping straight
          // back to 'pending' the way a plain reopen does.
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This connection was deliberately ended. Messaging isn&apos;t available here anymore. You can
              visit their profile if you&apos;d like to start over.
            </Text>
            <Pressable
              onPress={() => otherId && router.push({ pathname: '/candidate/[id]', params: { id: otherId } })}
              className="self-start">
              <Text className="text-caption font-semibold text-accent-500">View profile</Text>
            </Pressable>
          </View>
        ) : needsPhotoForFirstMessage ? (
          /* Inline, non-dismissible replacement of the whole compose
             footer, matching the same pattern the blocked state above
             already uses (replace, don't overlay). Deliberately hides
             "Let's plan something" too, since that also leads to a real
             message send (via ActivitySuggestionsModal) and would
             otherwise be a second, ungated way to send this same first
             message. */
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              Add a profile photo before sending your first message here. This only applies to starting a
              new conversation, once you&apos;ve exchanged a first message, replying never needs one.
            </Text>
            <Pressable onPress={() => router.push('/profile-build?from=profile')} className="self-start">
              <Text className="text-caption font-semibold text-accent-500">Add a photo</Text>
            </Pressable>
          </View>
        ) : blockedByPreference ? (
          /* Part 1, 2026-08-14: same replace-the-footer pattern as the
             photo gate above, same "Let's plan something" hide for the
             same reason (it's a second path to the same gated first
             message via ActivitySuggestionsModal). Deliberately doesn't
             say WHICH of the two rules (a specific gender match, or
             "only I message first") blocked it, only that it did,
             matching this app's own established "ambiguous, not
             punitive" precedent from the blocked-user UX work, there's
             nothing actionable for the viewer to do about someone
             else's stated preference, unlike the photo gate. */
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This person has chosen who can message them first, and it isn&apos;t a match right now. This
              only applies to starting a new conversation, if they reach out to you, you&apos;ll be able to
              reply freely.
            </Text>
          </View>
        ) : (
        <>
          {/* "Let's plan something" (renamed from "Plan a meetup",
              2026-07-28). Always available now, no !activeMeetup gate,
              that concept no longer exists, there's no scheduled date to
              conflict with. Routes through handlePlanSomething so the
              first-time milestone fires consistently whether the user
              taps this or the automatic banner's "Yes". */}
          <Pressable onPress={handlePlanSomething} className="self-start">
            <Text className="text-caption font-semibold text-accent-500">Let&apos;s plan something</Text>
          </Pressable>

          {sendError && (
            <Text className="text-caption text-red-600 dark:text-red-400">{sendError}</Text>
          )}

          <View className="flex-row items-end gap-2">
            <View className="relative flex-1">
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Write a message"
                placeholderTextColor={MUTED_ICON_COLOR}
                multiline
                className="max-h-32 rounded-2xl border border-stone-300 px-4 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <MicPlaceholderButton />
            </View>
            <Pressable
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              className={`items-center rounded-full bg-stone-900 px-5 py-3 active:opacity-80 dark:bg-stone-50 ${
                !draft.trim() || sending ? 'opacity-40' : ''
              }`}>
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                Send
              </Text>
            </Pressable>
          </View>

          {/* Universal text box pattern (Part 4): inline under the
              compose field itself rather than behind a modal-opening
              link, matching "buttons below the text field, single row"
              literally for the app's primary message-composition
              surface. */}
          <UniversalTextBox
            value={draft}
            onChangeText={setDraft}
            onRequestDraft={requestComposeDraft}
            situationPrompt="What's the situation, and what do you want to say?"
          />
        </>
        )}
        </View>
      </SafeAreaView>

      <ReplyAssistPanel
        visible={replyAssistVisible}
        onClose={() => setReplyAssistVisible(false)}
        onSend={sendMessage}
        recentMessages={replyAssistContext}
      />

      {connectionId && myId && (
        <FirstMeetupMilestoneModal
          visible={showFirstMilestone}
          connectionId={connectionId}
          userId={myId}
          onClose={handleFirstMilestoneClose}
        />
      )}

      <RememberReminderCard
        visible={Boolean(rememberReminderNote)}
        otherName={other?.display_name ?? 'this person'}
        note={rememberReminderNote ?? ''}
        onContinue={handleRememberReminderContinue}
      />

      {connectionId && (
        <ActivitySuggestionsModal
          visible={activitySuggestionsVisible}
          onClose={() => setActivitySuggestionsVisible(false)}
          connectionId={connectionId}
          onSend={sendMessage}
        />
      )}

      {otherId && (
        <ReportModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
          reportedId={otherId}
          connectionId={connectionId ?? null}
          otherName={other?.display_name ?? 'this person'}
        />
      )}

      {otherId && (
        <BlockConfirmModal
          visible={blockConfirmVisible}
          onClose={() => setBlockConfirmVisible(false)}
          onBlocked={handleBlocked}
          blockedId={otherId}
          otherName={other?.display_name ?? 'this person'}
        />
      )}

      {connectionId && (
        <EndConnectionModal
          visible={endConnectionVisible}
          onClose={() => setEndConnectionVisible(false)}
          onEnded={handleExitConfirmed}
          connectionId={connectionId}
          otherName={other?.display_name ?? 'this person'}
        />
      )}

      {connectionId && (
        <GraduationModal
          visible={graduationModalVisible}
          connectionId={connectionId}
          onKeptOrDeferred={() => setGraduationModalVisible(false)}
          onGraduated={() => {
            setGraduationModalVisible(false);
            loadConnectionStatus();
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
