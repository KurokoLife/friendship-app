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

import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { ChatRemindersSheet } from '@/components/chat-reminders-sheet';
import { EndConnectionModal } from '@/components/end-connection-modal';
import { FirstMeetupMilestoneModal } from '@/components/first-meetup-milestone-modal';
import { MirrorSheet } from '@/components/mirror-sheet';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { NextMeetupIndicatorV2, type EditorPrefill } from '@/components/next-meetup-indicator-v2';
import { PlanBoardCard } from '@/components/plan-board-card';
import { PlanInviteBubble, usePlanInvites } from '@/components/plan-invite';
import { MeetNudgeCard } from '@/components/meet-nudge-card';
import { PauseConnectionModal } from '@/components/pause-connection-modal';
import { PrimaryInterventionCard } from '@/components/primary-intervention-card';
import { RememberReminderCard } from '@/components/remember-reminder-card';
import { ReportModal } from '@/components/report-modal';
import { UniversalTextBox, type CoachContextMessage } from '@/components/universal-text-box';
import { EndedConnectionVideoLink, VideoGuidanceCard } from '@/components/video-guidance-card';
import { fetchConnectionCareStyle } from '@/lib/care-style';
import {
  FriendlyError,
  getActiveIntervention,
  getPauseDetails,
  resumeConnectionEarly,
  type ActiveIntervention,
  type PauseDetails,
} from '@/lib/friendship-journey';
import { recordPlanActivity } from '@/lib/meetup-milestones';
import { getPromptSettings, isOn, type PromptSettings } from '@/lib/prompt-settings';
import { startPlanBoard } from '@/lib/plan-board';
import { goBack } from '@/lib/navigation';
import { HONEST_EXIT_RECEIVER_TEXT, HONEST_EXIT_SENDER_TEXT, senderReassuranceLine } from '@/lib/no-ghost';
import { subscribeToMessages } from '@/lib/realtime-messages';
import { fetchLatestRememberNote } from '@/lib/remember';
import {
  dismissRhythmMismatch,
  hasDismissedRhythmMismatch,
  isReplyingMuchFaster,
  rhythmMismatchNote,
} from '@/lib/rhythm-mismatch';
import {
  connectionHasMutualInterest,
  containsScamSignal,
  SCAM_CHECK_EARLY_MESSAGE_COUNT,
  SCAM_NOTE_COPY,
} from '@/lib/safety';
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

// A match where nobody has said hello yet gets a gentle nudge after 2 days
// and closes quietly at 14 days (run_say_hello_check), so nobody is left
// wondering. Both people see the same note.
const HELLO_NUDGE_AFTER_DAYS = 2;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  // Keeps the sender's "Choosing honesty over silence" confirmation on
  // screen after the chat flips to ended.
  const [honestExitSent, setHonestExitSent] = useState(false);
  const [rhythmNoteDismissed, setRhythmNoteDismissed] = useState(false);
  // "Let's plan something" (2026-10-09): the shared planning card.
  const [planBoardKey, setPlanBoardKey] = useState(0);
  const [planBoardOpenRequest, setPlanBoardOpenRequest] = useState(0);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [mirrorVisible, setMirrorVisible] = useState(false);
  const [otherCareStyle, setOtherCareStyle] = useState<string | null>(null);
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    fetchConnectionCareStyle(connectionId).then((t) => {
      if (!cancelled) setOtherCareStyle(t);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);
  const [showFirstMilestone, setShowFirstMilestone] = useState(false);
  const [rememberReminderNote, setRememberReminderNote] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  // 20260818000000: the standalone Honest Exit entry point, reachable
  // directly from the header at the user's own initiative, independent of
  // any no-ghost escalation or meetup-outcome trigger.
  const [endConnectionVisible, setEndConnectionVisible] = useState(false);
  const [pauseModalVisible, setPauseModalVisible] = useState(false);
  const [pause, setPause] = useState<PauseDetails | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  // Set while this is a match where nobody has written yet.
  const [hello, setHello] = useState<{ opened_at: string; closes_at: string } | null>(null);
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
  // Safety plan (docs/DECISIONS.md section 3): a conversation's first
  // message needs mutual Interested and a passed selfie check. Default to
  // true so the gates never flash before the real values load; the real
  // enforcement is the messages INSERT RLS policy (20261004000000).
  const [mySelfieVerified, setMySelfieVerified] = useState(true);
  // True while a sent selfie waits for review (2026-10-09 (3)).
  const [mySelfiePending, setMySelfiePending] = useState(false);
  const [hasMutualInterest, setHasMutualInterest] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);
  // Friendship Journey: the one reminder or prompt card to show right now
  // (get_active_intervention picks it).
  const [newSystemIntervention, setNewSystemIntervention] = useState<ActiveIntervention | null>(null);
  // 2026-08-12 correction: at most one Limen video guidance offer may be
  // visible at once. Video 3 (NextMeetupIndicatorV2) and Video 6 (inline in
  // PrimaryInterventionCard's PreMeetupSupport) each report upward via a
  // plain callback whenever their own offer becomes visible; VideoGuidanceCard
  // (Videos 2/4/5) is simply not rendered while either is true. Deliberately
  // two separate booleans, not one shared setter both call: either one
  // clearing must not accidentally clear the other's still-active state.
  const [video3OfferActive, setVideo3OfferActive] = useState(false);
  const [video6OfferActive, setVideo6OfferActive] = useState(false);
  // Meetup plans (2026-10-08): prompt cards can open the plan card's editor
  // and ask it to reload after they change the plan.
  const [planEditorRequest, setPlanEditorRequest] = useState<{
    mode: 'change' | 'details' | 'new';
    n: number;
    prefill?: EditorPrefill;
  } | null>(null);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  // Invites to meet sent into the chat (2026-10-10), by message id.
  const { invites: planInvites, reload: reloadPlanInvites } = usePlanInvites(connectionId ?? null, planRefreshKey);
  const scrollRef = useRef<ScrollView>(null);
  // Keep the newest messages (and any card under them) in view, unless the
  // person scrolled up to read.
  const nearBottomRef = useRef(true);
  // Reminder settings for this chat (2026-10-10).
  const [prompts, setPrompts] = useState<PromptSettings | null>(null);
  const [remindersVisible, setRemindersVisible] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);
  const loadPrompts = useCallback(async () => {
    if (!connectionId) return;
    setPrompts(await getPromptSettings(connectionId));
  }, [connectionId]);
  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const loadNewSystemIntervention = useCallback(
    async (viewerId?: string) => {
      const resolvedViewerId = viewerId ?? myId;
      if (!connectionId || !resolvedViewerId) return;
      try {
        setNewSystemIntervention(await getActiveIntervention(connectionId, resolvedViewerId));
      } catch {
        setNewSystemIntervention(null);
      }
    },
    [connectionId, myId]
  );

  const loadPause = useCallback(async () => {
    if (!connectionId) return;
    setPause((await getPauseDetails(connectionId))[0] ?? null);
  }, [connectionId]);

  const loadHello = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase
      .from('new_mutual_connections')
      .select('opened_at, closes_at')
      .eq('connection_id', connectionId)
      .maybeSingle();
    setHello(data?.opened_at && data?.closes_at ? (data as { opened_at: string; closes_at: string }) : null);
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
    await loadPause();
    if (status === 'blocked') {
      const { data: myBlock } = await supabase
        .from('blocks')
        .select('id')
        .eq('blocker_id', myId)
        .eq('blocked_id', otherId)
        .maybeSingle();
      setIsBlocker(Boolean(myBlock));
    }
  }, [connectionId, otherId, myId, loadPause]);

  const handleResume = useCallback(async () => {
    if (!connectionId) return;
    setPauseError(null);
    try {
      await resumeConnectionEarly(connectionId);
    } catch (e) {
      setPauseError(e instanceof FriendlyError ? e.message : "That didn't go through. Please try again.");
    }
    await loadConnectionStatus();
    await loadNewSystemIntervention();
  }, [connectionId, loadConnectionStatus, loadNewSystemIntervention]);

  // Re-reads the messages, for changes made by the server on the person's
  // behalf (the pause note) in case the live update is slow to arrive.
  const reloadMessages = useCallback(async () => {
    if (!connectionId) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('connection_id', connectionId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [connectionId]);

  const handlePaused = useCallback(async () => {
    setPauseModalVisible(false);
    await reloadMessages();
    await loadConnectionStatus();
    await loadNewSystemIntervention();
  }, [reloadMessages, loadConnectionStatus, loadNewSystemIntervention]);

  // Report & Block: blocking is immediate and needs no further
  // confirmation step here, block_user() already did the real work
  // (the RPC call inside BlockConfirmModal), this just re-reads the
  // connection's own status so the thread reflects the block right away,
  // hiding compose and every active prompt card in the same render pass.
  const handleBlocked = useCallback(async () => {
    setBlockConfirmVisible(false);
    await loadConnectionStatus();
  }, [loadConnectionStatus]);

  // Ending the connection flips it to 'ended'; this keeps the sender's
  // confirmation on screen and refreshes everything else.
  const handleExitConfirmed = useCallback(() => {
    setHonestExitSent(true);
    loadConnectionStatus();
  }, [loadConnectionStatus]);

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
    // Originally fixed narrowly, for the realtime message subscription only
    // (a stale invocation's cleanup fires before its own async chain has
    // reached subscribeToMessages, since there are many awaited steps ahead
    // of it, so cleanup is a no-op and the stale invocation's subscription
    // stays registered forever alongside the fresh one, doubling every
    // INSERT event).
    //
    // Broadened (repeat-meetup scheduling investigation, 2026-08-09) after
    // finding the identical root cause producing a second, separate
    // symptom: reloading the same thread repeatedly showed stale/incomplete
    // state (a missing "Propose a date" link, an incomplete "Met N times"
    // list) roughly 1 time in 3, self-correcting on the next reload. Cause
    // is the same double-invocation, just affecting the OTHER setState
    // calls in this same effect, none of which checked whether their own
    // invocation had already been cancelled before committing a result: a
    // stale invocation's slower awaits can resolve AFTER a fresher
    // invocation's already have, and nothing stopped the stale, older data
    // from silently overwriting the fresher data that had already rendered
    // correctly moments earlier. `cancelled` is now checked after every
    // await in this effect, immediately before whatever setState call
    // would otherwise follow it, not just around the one subscription.
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
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
      if (cancelled) return;

      if (!connection) {
        setNotFound(true);
        setLoaded(true);
        return;
      }

      const otherUserId = connection.user_a_id === user.id ? connection.user_b_id : connection.user_a_id;
      setOtherId(otherUserId);
      setConnectionStatus(connection.status);

      const [
        { data: otherProfile },
        { data: existingMessages },
        dismissed,
        { data: myProfile },
        { data: myUserRow },
        mutual,
        { data: selfieDone },
        { data: mySelfieCheck },
      ] = await Promise.all([
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
          supabase.from('users').select('gender_identity, selfie_verified_at').eq('id', user.id).maybeSingle(),
          connectionHasMutualInterest(connectionId),
          // The selfie check is done once per account and only an approved
          // selfie counts (2026-10-09 (3)).
          supabase.rpc('selfie_check_done', { p_user: user.id }),
          supabase.from('selfie_checks').select('status').eq('user_id', user.id).maybeSingle(),
        ]);
      if (cancelled) return;

      setMySelfieVerified(Boolean(myUserRow?.selfie_verified_at) || Boolean(selfieDone));
      setMySelfiePending(mySelfieCheck?.status === 'pending');
      setHasMutualInterest(mutual);

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
        if (cancelled) return;
        setIsBlocker(Boolean(myBlock));
      }

      if (connection.status === 'paused') {
        const [details] = await getPauseDetails(connectionId);
        if (cancelled) return;
        setPause(details ?? null);
      }
      if ((existingMessages ?? []).length === 0) {
        await loadHello();
        if (cancelled) return;
      }

      setLoaded(true);
      await markIncomingRead(user.id);
      if (cancelled) return;
      await loadNewSystemIntervention(user.id);
      if (cancelled) return;

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
          // A new message clears reply reminders on the server
          // (messages_clear_v2_interventions), so re-read the card, and
          // the chat is no longer a match waiting for a hello.
          setHello(null);
          loadNewSystemIntervention(user.id);
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
  }, [connectionId, markIncomingRead, loadNewSystemIntervention, loadHello]);

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
      <View className="flex-1 items-center justify-center gap-4 bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That conversation isn&apos;t available.
        </Text>
        <Pressable onPress={() => goBack('/inbox')}>
          <Text className="text-caption font-semibold text-accent-500">Go back</Text>
        </Pressable>
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

  // Part 1 of tonight's consolidated build: sender-only passive
  // reassurance line, now a single new trigger at 36 hours (was the old
  // two-window 20h/72h version), only shown to whoever sent the last
  // message and is waiting on a reply, never to the recipient (they get
  // the actual prompt card instead, when due). Disappears once a reply
  // lands, or once the real S1 card (125h, the new system's own stored
  // intervention) takes over -- checked directly against
  // newSystemIntervention now, replacing the old, always-null
  // noGhostPrompt check this line used before the cutover (a real gap:
  // that guard was checking a table nothing writes to anymore, so it was
  // vacuously true always, this line was already showing regardless).
  const lastMessage = messages[messages.length - 1];
  const isSenderWaiting = Boolean(lastMessage && myId && lastMessage.sender_id === myId);
  const hoursSinceSent = lastMessage
    ? (Date.now() - new Date(lastMessage.created_at).getTime()) / (60 * 60 * 1000)
    : 0;
  // 2026-10-10: only while just one person has written. Once both have,
  // quiet is normal and nobody is "waiting".
  const bothHaveWritten =
    Boolean(myId) && messages.some((m) => m.sender_id === myId) && messages.some((m) => m.sender_id !== myId);
  const statusLine =
    !conversationEnded &&
    connectionStatus !== 'paused' &&
    !bothHaveWritten &&
    isSenderWaiting &&
    newSystemIntervention?.intervention_type !== 'no_ghost_s1'
      ? senderReassuranceLine(hoursSinceSent)
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

  // 2026-07-28 milestone redesign: both the manual "Let's plan
  // something" button and the automatic banner's "Yes" route through
  // here, so first-time engagement is detected consistently regardless
  // of which entry point the user actually used. record_plan_activity
  // also clears any stale checkin row from a prior planning cycle
  // (a fresh cycle starting over), so checkin state is reloaded after.
  const handlePlanSomething = async () => {
    if (!connectionId) return;
    const isFirstTime = await recordPlanActivity(connectionId);
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
      await openPlanBoard();
    }
  };

  // Opens (or reopens) the shared planning card.
  const openPlanBoard = async () => {
    if (!connectionId) return;
    setPlanNotice(null);
    try {
      await startPlanBoard(connectionId);
      setPlanBoardKey((k) => k + 1);
      setPlanBoardOpenRequest((k) => k + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (/plan_exists/.test(message)) setPlanNotice('You already have a plan. You can change it in the plan card above.');
      else if (/no_messages_yet/.test(message)) setPlanNotice('Say hello first, then you can plan something together.');
      else if (/chat_not_open/.test(message)) setPlanNotice("You can't plan in this chat right now.");
      else setPlanNotice("Couldn't start planning right now. Please try again.");
    }
  };

  const handleRememberReminderContinue = () => {
    setRememberReminderNote(null);
    openPlanBoard();
  };

  const handleFirstMilestoneClose = () => {
    setShowFirstMilestone(false);
    openPlanBoard();
  };

  const handleDismissRhythmNote = async () => {
    if (!connectionId || !myId) return;
    setRhythmNoteDismissed(true);
    await dismissRhythmMismatch(connectionId, myId);
  };

  // F18: last 3-5 messages, in order, as context for the draft. Only
  // sender/content cross into the Edge Function, nothing else about the
  // conversation.
  const replyAssistContext: CoachContextMessage[] = messages.slice(-5).map((m) => ({
    sender: m.sender_id === myId ? 'me' : 'them',
    content: m.content,
  }));


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

  // Safety plan gates for a brand-new conversation, checked before the
  // photo gate: without mutual Interested there's nothing to send yet,
  // and without a passed selfie check the database will refuse the
  // first message anyway.
  const waitingForMutualInterest = messages.length === 0 && !hasMutualInterest;
  const needsSelfieForFirstMessage = messages.length === 0 && !mySelfieVerified;

  // Scam-signal note (section 3, item 4): checked on this phone only,
  // nothing scored or stored. Shown once, under the first early message
  // from the other person that mentions money or moving off the app.
  const scamNoteMessageId =
    messages
      .slice(0, SCAM_CHECK_EARLY_MESSAGE_COUNT)
      .find((m) => m.sender_id !== myId && containsScamSignal(m.content))?.id ?? null;

  let lastDateLabel = '';

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-stone-50 dark:bg-stone-900"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView className="flex-1">
        <View className="gap-1 border-b border-stone-200 px-6 pb-4 pt-4 dark:border-stone-800">
          <View className="flex-row items-center justify-between">
            <Pressable onPress={() => goBack('/inbox')}>
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
              {!conversationEnded && connectionStatus !== 'paused' && messages.length > 0 && (
                <Pressable onPress={() => setPauseModalVisible(true)}>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">Pause</Text>
                </Pressable>
              )}
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
          </Pressable>
          {rhythmNoteText && (
            <View className="mt-1 flex-row items-start gap-2">
              <Text className="flex-1 text-caption text-stone-400 dark:text-stone-600">{rhythmNoteText}</Text>
              <Pressable onPress={handleDismissRhythmNote}>
                <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Dismiss</Text>
              </Pressable>
            </View>
          )}
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
            {/* Video 7 ("When a Friendship Changes or Ends"), 2026-08-11
                video architecture update. Optional, after the fact only --
                never a gate on ending, never shown before Report/Block in
                the header, both of which are completely untouched by this
                and remain reachable regardless of connection status. */}
            <EndedConnectionVideoLink />
          </View>
        )}

        {connectionStatus !== 'blocked' && connectionStatus !== 'inactive' && connectionStatus !== 'ended' && (
          <>
            {connectionStatus === 'paused' && pause && (
              <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body text-stone-700 dark:text-stone-300">
                  {pause.paused_by_me
                    ? `You paused this chat until ${shortDate(pause.paused_until)}.`
                    : `${pause.other_paused_name ?? 'They'} paused this chat until ${shortDate(pause.paused_until)}.`}
                </Text>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  {pause.paused_by_me
                    ? "No reminders, no messages, and it doesn't count toward your 3 active conversations. It opens again on its own on that date."
                    : `It opens again on its own on that date. Until then there are no reminders or messages. If waiting doesn't work for you, you can end the connection.`}
                </Text>
                {pauseError && <Text className="text-caption text-red-600 dark:text-red-400">{pauseError}</Text>}
                <Pressable
                  onPress={pause.paused_by_me ? handleResume : () => setEndConnectionVisible(true)}
                  className="self-start">
                  <Text className="text-caption font-semibold text-accent-500">
                    {pause.paused_by_me ? 'Resume now' : 'End the connection'}
                  </Text>
                </Pressable>
              </View>
            )}
            {messages.length === 0 &&
              hello &&
              hasMutualInterest &&
              Date.now() - new Date(hello.opened_at).getTime() >= HELLO_NUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000 && (
                <View className="mx-6 mt-4 gap-1 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
                  <Text className="text-body text-stone-700 dark:text-stone-300">
                    You and {other?.display_name ?? 'they'} both said Interested. A short hello is plenty, like
                    something on their profile you&apos;re curious about.
                  </Text>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    If neither of you says hello by {shortDate(hello.closes_at)}, this match closes quietly so nobody
                    is left wondering. You can still say hello later from their profile.
                  </Text>
                </View>
              )}
            {myId && connectionId && (
              <NextMeetupIndicatorV2
                connectionId={connectionId}
                myId={myId}
                otherName={other?.display_name ?? 'them'}
                onChanged={() => {
                  loadNewSystemIntervention();
                  // A plan made or withdrawn shows or hides the planning card,
                  // and updates any invite in the chat.
                  setPlanBoardKey((k) => k + 1);
                  reloadPlanInvites();
                }}
                onVideoOfferChange={setVideo3OfferActive}
                refreshKey={planRefreshKey}
                editorRequest={planEditorRequest}
                onEndConnection={() => setEndConnectionVisible(true)}
                calendarAskOn={isOn(prompts, 'calendar')}
                guidesOn={isOn(prompts, 'guides')}
                onPlanState={setHasPlan}
              />
            )}
          </>
        )}

        <ScrollView
          ref={scrollRef}
          contentContainerClassName="gap-3 px-6 py-5"
          scrollEventThrottle={100}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            nearBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
          }}
          onContentSizeChange={() => {
            if (nearBottomRef.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}>
          {messages.length === 0 && (
            <Text className="text-center text-caption text-stone-400 dark:text-stone-600">
              This is the start of your conversation.
            </Text>
          )}
          <Text className="text-center text-caption text-stone-400 dark:text-stone-600">
            Limen is for meeting in person. Chatting is how you get there.
          </Text>
          {messages.map((m) => {
            const label = dateLabel(m.created_at);
            const showDivider = label !== lastDateLabel;
            lastDateLabel = label;
            const isMine = m.sender_id === myId;
            const invite = m.type === 'plan_invite' ? planInvites[m.id] : undefined;
            if (invite && myId) {
              return (
                <View key={m.id}>
                  {showDivider && (
                    <Text className="mb-2 mt-1 text-center text-caption text-stone-400 dark:text-stone-600">
                      {label}
                    </Text>
                  )}
                  <View className={isMine ? 'items-end' : 'items-start'}>
                    <PlanInviteBubble
                      invite={invite}
                      myId={myId}
                      otherName={other?.display_name ?? 'them'}
                      onPickTime={(pick) =>
                        setPlanEditorRequest((r) => ({
                          mode: 'new',
                          n: (r?.n ?? 0) + 1,
                          prefill: { date: pick.date, startTime: pick.startTime, activity: pick.activity, inviteId: pick.inviteId },
                        }))
                      }
                      onSetPlan={(activity) =>
                        setPlanEditorRequest((r) => ({ mode: 'new', n: (r?.n ?? 0) + 1, prefill: { activity } }))
                      }
                    />
                    <Text className="mt-1 text-caption text-stone-400 dark:text-stone-600">{timeLabel(m.created_at)}</Text>
                  </View>
                </View>
              );
            }
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
                  {m.id === scamNoteMessageId && (
                    <View className="mt-2 max-w-[80%] flex-row gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
                      <Text className="flex-1 text-caption text-amber-800 dark:text-amber-200">{SCAM_NOTE_COPY}</Text>
                    </View>
                  )}
                  {m.type === 'honest_exit' && !isMine && (
                    <Text className="mt-1 max-w-[80%] text-caption text-stone-400 dark:text-stone-600">
                      {HONEST_EXIT_RECEIVER_TEXT}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
          {/* Prompt cards sit under the newest message (2026-10-10), so the
              conversation stays in view on a phone. -mx-6 undoes the list's
              own side padding, since the cards bring their own. */}
          {connectionStatus !== 'blocked' && connectionStatus !== 'inactive' && connectionStatus !== 'ended' && (
            <View className="-mx-6">
            {myId && connectionId && (
              <PlanBoardCard
                connectionId={connectionId}
                myId={myId}
                otherName={other?.display_name ?? 'them'}
                refreshKey={planBoardKey + planRefreshKey}
                openRequest={planBoardOpenRequest}
                onStart={openPlanBoard}
                onSent={() => {
                  reloadPlanInvites();
                  reloadMessages();
                }}
              />
            )}
            {/* Gentle nudge to meet in person after weeks of only chatting
                (2026-10-09). Only when no other prompt card is showing. */}
            {myId && connectionId && !newSystemIntervention && (
              <MeetNudgeCard
                connectionId={connectionId}
                otherName={other?.display_name ?? 'them'}
                refreshKey={planBoardKey + planRefreshKey}
                onPlan={handlePlanSomething}
                onEnd={() => setEndConnectionVisible(true)}
                onTurnedOff={loadPrompts}
              />
            )}
            {newSystemIntervention && connectionId && (
              <View className="px-6 pt-2">
                <PrimaryInterventionCard
                  intervention={newSystemIntervention}
                  connectionId={connectionId}
                  otherName={other?.display_name ?? 'them'}
                  onResolved={() => {
                    loadNewSystemIntervention();
                    // "I need more time" pauses the chat from inside the card
                    // and sends the note with it.
                    loadConnectionStatus();
                    reloadMessages();
                    // A card can change the plan or the meetup count ("Did
                    // you meet?" both yes), so the plan card reloads too.
                    setPlanRefreshKey((k) => k + 1);
                  }}
                  onPlanSomething={handlePlanSomething}
                  onVideoOfferChange={setVideo6OfferActive}
                  onEndConnection={() => setEndConnectionVisible(true)}
                  onRequestPlanEditor={(mode) => setPlanEditorRequest((r) => ({ mode, n: (r?.n ?? 0) + 1 }))}
                  onPlanChanged={() => setPlanRefreshKey((k) => k + 1)}
                  onPromptsChanged={loadPrompts}
                />
              </View>
            )}
            {/* Video trigger/placement architecture (2026-08-11), Videos 2/4/5:
                deliberately rendered AFTER PrimaryInterventionCard, never
                instead of it -- optional secondary support only, never the
                primary relational intervention. myId is guaranteed defined
                here, this whole block already requires it above.
                2026-08-12 correction: not rendered at all while Video 3
                (NextMeetupIndicatorV2, above) or Video 6 (inline in
                PrimaryInterventionCard just above) already has its own
                offer visible -- the simplest way to guarantee at most one
                video guidance offer on screen, without a shared resolver or
                new priority system. Nothing about WHEN 2/4/5 would
                individually qualify changes; only whether this component
                mounts at all does. */}
            {myId && connectionId && isOn(prompts, 'guides') && !video3OfferActive && !video6OfferActive && (
              <VideoGuidanceCard
                connectionId={connectionId}
                myId={myId}
                currentInterventionType={newSystemIntervention?.intervention_type}
              />
            )}
            </View>
          )}
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
              This conversation has ended. You can reconnect from their profile.
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
        ) : connectionStatus === 'paused' ? (
          <Text className="py-3 text-center text-caption text-stone-400 dark:text-stone-600">
            {pause?.paused_by_me
              ? 'Messages are paused. Tap "Resume now" above to open the chat again.'
              : 'Messages are paused for now.'}
          </Text>
        ) : waitingForMutualInterest ? (
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This chat opens once you both say Interested. If you haven&apos;t yet, you can from their
              profile. They won&apos;t be told unless they choose you too.
            </Text>
            <Pressable
              onPress={() => otherId && router.push({ pathname: '/candidate/[id]', params: { id: otherId } })}
              className="self-start">
              <Text className="text-caption font-semibold text-accent-500">View profile</Text>
            </Pressable>
          </View>
        ) : needsSelfieForFirstMessage ? (
          <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body text-stone-600 dark:text-stone-400">
              {mySelfiePending
                ? "Your selfie is waiting for our review, usually less than a day. You can send your first message here once it's approved."
                : "Before you send a first message, finish your selfie check. You only do it once, and it confirms you're the person in your photo."}
            </Text>
            <Pressable onPress={() => router.push('/selfie-check')} className="self-start">
              <Text className="text-caption font-semibold text-accent-500">
                {mySelfiePending ? 'See my selfie check' : 'Do my selfie check'}
              </Text>
            </Pressable>
          </View>
        ) : needsPhotoForFirstMessage ? (
          /* Inline, non-dismissible replacement of the whole compose
             footer, matching the same pattern the blocked state above
             already uses (replace, don't overlay). Deliberately hides
             "Let's plan something" too, since that also leads to a real
             message send (via the planning card) and would
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
             message via the planning card). Deliberately doesn't
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
          <View className="flex-row items-center justify-between gap-3">
            {hasPlan ? (
              <View />
            ) : (
              <Pressable onPress={handlePlanSomething}>
                <Text className="text-caption font-semibold text-accent-500">Let&apos;s plan something</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setRemindersVisible(true)} hitSlop={6}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Reminders</Text>
            </Pressable>
          </View>
          {planNotice && <Text className="text-caption text-stone-500 dark:text-stone-400">{planNotice}</Text>}

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
            context="reply"
            recentMessages={replyAssistContext}
            otherCareStyle={otherCareStyle}
            otherName={other?.display_name ?? null}
          />
          <Pressable onPress={() => setMirrorVisible(true)} className="self-start">
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
              Unsure how to read something? Another way to see it
            </Text>
          </Pressable>
        </>
        )}
        </View>
      </SafeAreaView>


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
        <PauseConnectionModal
          visible={pauseModalVisible}
          onClose={() => setPauseModalVisible(false)}
          onPaused={handlePaused}
          connectionId={connectionId}
          otherName={other?.display_name ?? 'They'}
        />
      )}

      {connectionId && (
        <ChatRemindersSheet
          visible={remindersVisible}
          connectionId={connectionId}
          otherName={other?.display_name ?? 'them'}
          onClose={() => setRemindersVisible(false)}
          onChanged={(fresh) => {
            setPrompts(fresh);
            loadNewSystemIntervention();
            setPlanBoardKey((k) => k + 1);
          }}
        />
      )}

      <MirrorSheet
        visible={mirrorVisible}
        onClose={() => setMirrorVisible(false)}
        otherName={other?.display_name ?? null}
      />
    </KeyboardAvoidingView>
  );
}
