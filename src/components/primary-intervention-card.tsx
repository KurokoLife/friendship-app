import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { getSeenCoachMarks, markCoachMarkSeen } from '@/lib/coach-marks';
import {
  cancelMeetup,
  confirmMeetup,
  pauseConnectionWithDuration,
  proposeMeetupDateResolution,
  reportMeetupOccurrence,
  resolveMeetupDateResolution,
  submitGraduationReadiness,
  submitMeetupCancellationReason,
  submitPostMeetupReflection,
  submitRhythmPreference,
  submitSecondLookResponse,
  type ActiveIntervention,
  type MeetupCancellationReason,
  type PauseDuration,
} from '@/lib/friendship-journey';
import { supabase } from '@/lib/supabase';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { UniversalTextBox } from '@/components/universal-text-box';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  intervention: ActiveIntervention;
  connectionId: string;
  otherName: string;
  onResolved: () => void;
  // 2026-08-12 correction: at most one Limen video guidance offer may be
  // visible at once. Only PreMeetupSupport ever shows an inline video
  // (Video 6); every other case here ignores this prop. See the matching
  // note on NextMeetupIndicatorV2's own onVideoOfferChange -- same
  // mechanism, not a new priority system, just a one-way "something is
  // showing" signal up to thread/[id].tsx.
  onVideoOfferChange?: (active: boolean) => void;
  // Part 3 of tonight's consolidated build: threaded down from
  // thread/[id].tsx's own real handlePlanSomething, so the redesigned
  // post-meetup flow's "Let's plan something" link does the exact same
  // real thing the always-visible compose-footer link already does
  // (first-time milestone / Remember reminder / activity suggestions
  // branching, unchanged), not a second, simplified reimplementation.
  onPlanSomething?: () => void;
};

// Friendship Journey rebuild — the single card this app now renders, driven
// entirely by get_active_intervention()'s one returned type (design doc §6).
// Replaces the old pattern of thread/[id].tsx independently evaluating and
// rendering up to six competing cards at once.
//
// __DEV__-gated only, see thread/[id].tsx's own comment for why: this is
// real, tested code, not a stub, but it is not yet the default experience
// for a real production user — that is the deliberate cutover step.
export function PrimaryInterventionCard({ intervention, connectionId, otherName, onResolved, onVideoOfferChange, onPlanSomething }: Props) {
  switch (intervention.intervention_type) {
    case 'no_ghost_r1':
      return <NoGhostR1 connectionId={connectionId} onResolved={onResolved} />;
    case 'no_ghost_r2':
      return <NoGhostR2R3 connectionId={connectionId} intervention={intervention} escalation="perspective" onResolved={onResolved} />;
    case 'no_ghost_r3':
      return <NoGhostR2R3 connectionId={connectionId} intervention={intervention} escalation="accountability" onResolved={onResolved} />;
    case 'no_ghost_s1':
      return <NoGhostS1 connectionId={connectionId} onResolved={onResolved} />;
    case 'meetup_confirm_needed':
      return <MeetupConfirmNeeded intervention={intervention} otherName={otherName} onResolved={onResolved} />;
    case 'pre_meetup_support':
      return (
        <PreMeetupSupport
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onVideoOfferChange={onVideoOfferChange}
        />
      );
    case 'meetup_occurrence_check':
      return (
        <MeetupOccurrenceCheck
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onPlanSomething={onPlanSomething}
        />
      );
    case 'post_meetup_reflection':
      return <PostMeetupReflectionPrompt intervention={intervention} otherName={otherName} onResolved={onResolved} />;
    case 'second_look_prompt':
      return <SecondLookPrompt connectionId={connectionId} otherName={otherName} onResolved={onResolved} />;
    case 'conversation_restart_prompt':
      return <ConversationRestartPrompt onResolved={onResolved} />;
    case 'rhythm_reminder':
      return <RhythmReminder connectionId={connectionId} intervention={intervention} onResolved={onResolved} />;
    case 'graduation_checkpoint':
      return <GraduationCheckpoint connectionId={connectionId} onResolved={onResolved} />;
    case 'meetup_date_reconciliation':
      return <MeetupDateReconciliation intervention={intervention} onResolved={onResolved} />;
    default:
      return null;
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      {children}
    </View>
  );
}

function OptionPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">{label}</Text>
    </Pressable>
  );
}

// ---- R1 (SUPPORT), design doc §8 ----
// Part 1 of tonight's consolidated build: "Help me reply" now actually
// does something once the user has typed. Both "Reply" and "Help me
// reply" reveal the identical compose box (there's only one field to type
// into either way); the real fix is that UniversalTextBox is now wired in
// underneath it with no onRequestDraft/draftPurpose supplied, which means
// its own "Help me write" (generate from nothing) branch never renders --
// only the "Clean up" branch, gated on hasContent, ever shows. Relabeled
// to "Help me reply" via the new cleanupActionLabel prop, so what the
// user sees matches what actually happens: this polishes what they've
// already written, it never invents a reply from an empty box.
function NoGhostR1({ connectionId, onResolved }: { connectionId: string; onResolved: () => void }) {
  const [showCompose, setShowCompose] = useState(false);
  const [draft, setDraft] = useState('');

  const send = async () => {
    if (!draft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('messages').insert({ connection_id: connectionId, sender_id: user.id, content: draft.trim(), type: 'text' });
    onResolved();
  };

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">Still meaning to reply?</Text>
      {showCompose ? (
        <View className="gap-2">
          {/* Copy adapted from the old system's own R1 awareness text
              ("You do not need a perfect reply. A short, honest response
              helps the other person know where things stand."), per
              explicit instruction to use it as a starting point rather
              than inventing new copy. */}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            You don&apos;t need a perfect reply. A short, honest response helps the other person know where
            things stand. Write what you&apos;re thinking, Help me reply can clean it up once you have.
          </Text>
          <View className="relative">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write your reply"
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <MicPlaceholderButton />
          </View>
          <UniversalTextBox value={draft} onChangeText={setDraft} cleanupActionLabel="Help me reply" />
          <Pressable onPress={send} disabled={!draft.trim()} className="self-start rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Reply" onPress={() => setShowCompose(true)} />
          <OptionPill label="Help me reply" onPress={() => setShowCompose(true)} />
          <OptionPill label="I'll come back to this" onPress={onResolved} />
        </View>
      )}
    </Card>
  );
}

// ---- R2 (PERSPECTIVE) / R3 (ACCOUNTABILITY), design doc §8 ----
function NoGhostR2R3({
  connectionId,
  intervention,
  escalation,
  onResolved,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  escalation: 'perspective' | 'accountability';
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'reply' | 'defer'>('none');
  const [draft, setDraft] = useState('');

  const awareness =
    escalation === 'perspective'
      ? "They're still waiting to know where things stand."
      : "You don't have to continue this connection. But leaving someone without an answer can leave them unsure about what happened.";
  const supporting =
    escalation === 'perspective'
      ? 'Sometimes life gets busy, or it becomes harder to know what to say after some time has passed.'
      : null;

  const send = async () => {
    if (!draft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('messages').insert({ connection_id: connectionId, sender_id: user.id, content: draft.trim(), type: 'text' });
    onResolved();
  };

  const pause = async (duration: PauseDuration) => {
    await pauseConnectionWithDuration(connectionId, duration);
    onResolved();
  };

  const endConnection = async () => {
    if (!draft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.rpc('end_connection_with_message', { p_connection_id: connectionId, p_content: draft.trim() });
    onResolved();
  };

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">{awareness}</Text>
      {supporting && <Text className="text-body text-stone-600 dark:text-stone-400">{supporting}</Text>}
      {mode === 'none' && (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Reply" onPress={() => setMode('reply')} />
          <OptionPill label="Help me get back into the conversation" onPress={() => setMode('reply')} />
          <OptionPill label="I need more time" onPress={() => setMode('defer')} />
          <OptionPill label="I don't want to continue" onPress={() => setMode('reply')} />
        </View>
      )}
      {mode === 'defer' && (
        <View className="gap-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            The other participant will never see which of these you picked.
          </Text>
          <OptionPill label="A couple of days" onPress={() => pause('couple_days')} />
          <OptionPill label="About a week" onPress={() => pause('about_a_week')} />
          <OptionPill label="I'll come back when I'm ready" onPress={() => pause('indefinite')} />
        </View>
      )}
      {mode === 'reply' && (
        <View className="gap-2">
          {/* Same adapted old-system framing as R1, "write first" rather
              than offering to generate something from nothing. */}
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            You don&apos;t need a perfect reply. Write what you&apos;re thinking, Help me reply can clean it
            up once you have.
          </Text>
          <View className="relative">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write what you want to say"
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <MicPlaceholderButton />
          </View>
          <UniversalTextBox value={draft} onChangeText={setDraft} cleanupActionLabel="Help me reply" />
          <View className="flex-row gap-2">
            <Pressable onPress={send} disabled={!draft.trim()} className="rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
            </Pressable>
            <Pressable onPress={endConnection} disabled={!draft.trim()} className="rounded-full border border-red-300 px-4 py-2 dark:border-red-800">
              <Text className="text-caption font-semibold text-red-600 dark:text-red-400">End connection instead</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}

// ---- S1 (AGENCY), sender-only, design doc §8 ----
function NoGhostS1({ connectionId, onResolved }: { connectionId: string; onResolved: () => void }) {
  const [showCompose, setShowCompose] = useState(false);
  const [draft, setDraft] = useState('');

  const send = async () => {
    if (!draft.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('messages').insert({ connection_id: connectionId, sender_id: user.id, content: draft.trim(), type: 'text' });
    onResolved();
  };

  const closeAndMakeRoom = async () => {
    await supabase.rpc('set_connection_inactive', { p_connection_id: connectionId });
    onResolved();
  };

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">It's been quiet for a while. What would feel right for you?</Text>
      {showCompose ? (
        <View className="gap-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            You don&apos;t need a perfect message. Write what you&apos;re thinking, Help me write can clean
            it up once you have.
          </Text>
          <View className="relative">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Write your message"
              placeholderTextColor={MUTED_ICON_COLOR}
              multiline
              className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <MicPlaceholderButton />
          </View>
          <UniversalTextBox value={draft} onChangeText={setDraft} cleanupActionLabel="Help me write" />
          <Pressable onPress={send} disabled={!draft.trim()} className="self-start rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Send one more message" onPress={() => setShowCompose(true)} />
          <OptionPill label="Give it more time" onPress={onResolved} />
          <OptionPill label="Close and make room" onPress={closeAndMakeRoom} />
        </View>
      )}
    </Card>
  );
}

function MeetupConfirmNeeded({
  intervention,
  otherName,
  onResolved,
}: {
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
}) {
  const meetupId = intervention.intervention_id as string;
  const proposedDate = intervention.payload.proposed_date as string;

  const confirm = async () => {
    await confirmMeetup(meetupId);
    onResolved();
  };
  const decline = async () => {
    await cancelMeetup(meetupId);
    onResolved();
  };

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        {otherName} proposed meeting on {proposedDate}. Does that work for you?
      </Text>
      <View className="flex-row gap-2">
        <OptionPill label="Confirm" onPress={confirm} />
        <OptionPill label="Not this time" onPress={decline} />
      </View>
    </Card>
  );
}

function PreMeetupSupport({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onVideoOfferChange,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onVideoOfferChange?: (active: boolean) => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const [mode, setMode] = useState<'none' | 'concern'>('none');
  // Video 6 ("When Something Feels Off: Ask, Repair, and Give It Room"),
  // 2026-08-11 video architecture update. Attached inline here rather than
  // the shared VideoGuidanceCard: its two triggers are this card's own
  // local concern state (entering `mode === 'concern'` IS the private
  // difficulty-reflection signal the approved spec names) and repeated
  // cancellation on this connection, both already-supported friction
  // signals, nothing invented. Deliberately placed AFTER the existing
  // safety-pointer line, never instead of it or above it -- per explicit
  // instruction, safety controls always outrank this video.
  const [videoDismissed, setVideoDismissed] = useState(false);
  const [videoAlreadySeen, setVideoAlreadySeen] = useState(true);
  const [repeatedCancellations, setRepeatedCancellations] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await getSeenCoachMarks();
      if (cancelled) return;
      setVideoAlreadySeen(seen.has('video_something_off'));

      const { count } = await supabase
        .from('meetups')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', connectionId)
        .eq('status', 'cancelled');
      if (cancelled) return;
      setRepeatedCancellations((count ?? 0) >= 2);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const cancel = async () => {
    await cancelMeetup(meetupId, 'cancelled');
    onResolved();
  };

  const dismissVideo = async () => {
    await markCoachMarkSeen('video_something_off');
    setVideoDismissed(true);
  };

  const showVideoOffer = (mode === 'concern' || repeatedCancellations) && !videoAlreadySeen && !videoDismissed;

  useEffect(() => {
    onVideoOfferChange?.(showVideoOffer);
  }, [showVideoOffer, onVideoOfferChange]);

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">How are you feeling about meeting {otherName}?</Text>
      {mode === 'none' && (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Looking forward to it" onPress={onResolved} />
          <OptionPill label="A little nervous" onPress={onResolved} />
          <OptionPill label="I'm thinking about cancelling" onPress={() => setMode('concern')} />
        </View>
      )}
      {mode === 'concern' && (
        <View className="gap-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            That's okay. If something feels unsafe, use Report or Block from the thread header — you don't need to explain why here.
          </Text>
          <OptionPill label="I'll go anyway" onPress={onResolved} />
          <OptionPill label="Cancel this one" onPress={cancel} />
        </View>
      )}
      {/* Rendered at the card's own top level, not nested inside either
          mode: repeatedCancellations can be true while mode is still
          'none' (the user hasn't necessarily said anything is wrong THIS
          time, the pattern itself is what's worth gently surfacing). Always
          after the safety-pointer text above when both are visible. */}
      {showVideoOffer && (
        <View className="flex-row flex-wrap items-center gap-3 border-t border-stone-200 pt-2 dark:border-stone-700">
          <Text className="text-caption text-stone-400 dark:text-stone-600">A short guide, if it helps.</Text>
          <Pressable
            onPress={() => {
              dismissVideo();
              router.push({ pathname: '/guide/[id]', params: { id: 'video_something_off' } });
            }}>
            <Text className="text-caption font-semibold text-accent-500">Watch</Text>
          </Pressable>
          <Pressable onPress={dismissVideo}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}

function formatMeetupDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

const CANCELLATION_REASON_OPTIONS: { key: MeetupCancellationReason; label: string }[] = [
  { key: 'schedule_conflict', label: 'Something came up' },
  { key: 'circumstances_changed', label: 'Things changed on my end' },
  { key: 'lost_interest', label: "It didn't feel like the right fit anymore" },
  { key: 'other', label: 'Other' },
];

type OccurrenceMode =
  | 'ask'
  | 'yes_date'
  | 'no_followup'
  | 'cancelled_reason'
  | 'cancelled_reschedule_ask'
  | 'cancelled_reschedule_compose'
  | 'rescheduled_done'
  | 'cancelled_done';

// Part 3 of tonight's consolidated build: replaces the old plain
// Yes/No-plus-re-asked-date card with a real branching post-meetup flow.
// The real date is read directly from the intervention's own payload
// (confirmed_date, added to run_meetup_occurrence_check_v2's own
// raise_intervention call this same session), never re-asked of the user.
// "Yes" still flows through the same real reportMeetupOccurrence
// mechanism as before (preserving meetup_count/friendship_stage
// integrity), and once both participants say yes, the existing
// post_meetup_reflection intervention (rank 4, right below this one)
// naturally becomes the next thing shown -- that IS the "How did it go?"
// step, reusing the real, already-built reflection options rather than
// inventing a second, parallel one.
//
// "No" also calls reportMeetupOccurrence(false) immediately (keeping that
// same real mechanism intact regardless of which sub-branch is chosen
// next), but deliberately does NOT call onResolved() until the whole
// rescheduled/cancelled sub-flow finishes -- calling it early would let
// thread/[id].tsx re-fetch and potentially swap this card out from under
// the user mid-flow if something else is now higher-priority, the same
// local-state-until-truly-done pattern MeetupOutcomeCard's own exitMode
// already established.
function MeetupOccurrenceCheck({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onPlanSomething,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onPlanSomething?: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const confirmedDate = intervention.payload.confirmed_date as string | undefined;
  const dateLabel = confirmedDate ? formatMeetupDisplayDate(confirmedDate) : null;

  const [mode, setMode] = useState<OccurrenceMode>('ask');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<MeetupCancellationReason | null>(null);
  const [draft, setDraft] = useState('');
  const [draftEdited, setDraftEdited] = useState(false);

  const handleDraftChange = (text: string) => {
    setDraft(text);
    setDraftEdited(true);
  };

  const answerYes = async () => {
    setBusy(true);
    try {
      await reportMeetupOccurrence(meetupId, true, confirmedDate ?? null);
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  // Real bug found and fixed during this session's own live verification,
  // not assumed correct from reading the code: reportMeetupOccurrence's own
  // SQL marks the underlying connection_interventions row resolved as a
  // side effect of ANY report, regardless of yes/no. Calling it the moment
  // "No" was tapped (the first version of this flow) meant a page reload
  // partway through the rescheduled/cancelled sub-flow lost the whole
  // card -- get_active_intervention had nothing left to return, since the
  // row was already resolved, even though the richer follow-up (reason,
  // reschedule intent) was still mid-flow. Fixed by deferring the actual
  // reportMeetupOccurrence(false) call to each branch's own terminal step
  // (pickRescheduled, and the reschedule-intent answer for the cancelled
  // branch) instead of firing it immediately on "No", so the underlying
  // row -- and therefore this whole card -- stays reload-resumable for as
  // long as the user is still actively answering it.
  const answerNo = () => {
    setMode('no_followup');
  };

  const pickRescheduled = async () => {
    setBusy(true);
    try {
      await reportMeetupOccurrence(meetupId, false);
      setMode('rescheduled_done');
    } finally {
      setBusy(false);
    }
  };

  const pickCancelled = () => setMode('cancelled_reason');

  const submitReason = (r: MeetupCancellationReason) => {
    setReason(r);
    setMode('cancelled_reschedule_ask');
  };

  const answerRescheduleWanted = async (wants: boolean) => {
    if (!reason) return;
    setBusy(true);
    try {
      await submitMeetupCancellationReason(meetupId, reason, wants);
      await reportMeetupOccurrence(meetupId, false);
      setMode(wants ? 'cancelled_reschedule_compose' : 'cancelled_done');
    } finally {
      setBusy(false);
    }
  };

  const sendRescheduleMessage = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('messages').insert({ connection_id: connectionId, sender_id: user.id, content: draft.trim(), type: 'text' });
      setMode('cancelled_done');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'ask') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {dateLabel ? `Did you meet ${otherName} on ${dateLabel}?` : `Did you meet with ${otherName}?`}
        </Text>
        <View className="flex-row gap-2">
          <OptionPill label="Yes" onPress={answerYes} />
          <OptionPill label="No" onPress={answerNo} />
        </View>
      </Card>
    );
  }

  if (mode === 'no_followup') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">Was it rescheduled, or cancelled?</Text>
        <View className="flex-row gap-2">
          <OptionPill label="Rescheduled" onPress={pickRescheduled} />
          <OptionPill label="Cancelled" onPress={pickCancelled} />
        </View>
      </Card>
    );
  }

  if (mode === 'rescheduled_done') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          No problem. Use the meetup card above whenever you&apos;re ready to propose a new date.
        </Text>
        <Pressable onPress={onResolved} className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Got it</Text>
        </Pressable>
      </Card>
    );
  }

  if (mode === 'cancelled_reason') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">Why was it cancelled?</Text>
        <View className="gap-2">
          {CANCELLATION_REASON_OPTIONS.map((o) => (
            <Pressable
              key={o.key}
              onPress={() => submitReason(o.key)}
              disabled={busy}
              className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
              <Text className="text-body text-stone-900 dark:text-stone-50">{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
    );
  }

  if (mode === 'cancelled_reschedule_ask') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">Do you want to propose rescheduling?</Text>
        <View className="flex-row gap-2">
          <OptionPill label="Yes" onPress={() => answerRescheduleWanted(true)} />
          <OptionPill label="No" onPress={() => answerRescheduleWanted(false)} />
        </View>
      </Card>
    );
  }

  if (mode === 'cancelled_reschedule_compose') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          You don&apos;t need a perfect message. Write what you&apos;re thinking, Help me reply can clean it
          up once you have.
        </Text>
        <View className="relative">
          <TextInput
            value={draft}
            onChangeText={handleDraftChange}
            onFocus={() => setDraftEdited(true)}
            placeholder="Write what you want to say"
            placeholderTextColor={MUTED_ICON_COLOR}
            multiline
            className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 pr-12 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
          />
          <MicPlaceholderButton />
        </View>
        <UniversalTextBox value={draft} onChangeText={handleDraftChange} cleanupActionLabel="Help me reply" disabled={busy} />
        <View className="flex-row flex-wrap items-center gap-3">
          <Pressable
            onPress={sendRescheduleMessage}
            disabled={busy || !draftEdited || !draft.trim()}
            className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
              busy || !draftEdited || !draft.trim() ? 'opacity-40' : ''
            }`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
          </Pressable>
          {/* The same real "Let's plan something" handler the always-visible
              compose-footer link already calls, threaded down from
              thread/[id].tsx, not a second, simplified reimplementation. */}
          <Pressable
            onPress={() => {
              setMode('cancelled_done');
              onPlanSomething?.();
            }}
            disabled={busy}>
            <Text className="text-caption font-semibold text-accent-500">Let&apos;s plan something</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  // cancelled_done
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Thanks for letting us know. No further action needed.
      </Text>
      <Pressable onPress={onResolved} className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
        <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Close</Text>
      </Pressable>
    </Card>
  );
}

function PostMeetupReflectionPrompt({
  intervention,
  otherName,
  onResolved,
}: {
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const options: { key: 'know_better' | 'open_to_another' | 'still_figuring' | 'dont_continue'; label: string }[] = [
    { key: 'know_better', label: `I'd like to know ${otherName} better` },
    { key: 'open_to_another', label: "I'd be open to another meetup" },
    { key: 'still_figuring', label: "I'm still figuring it out" },
    { key: 'dont_continue', label: "I don't want to continue" },
  ];
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">How are you feeling about getting to know {otherName}?</Text>
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Only you will ever see this answer.</Text>
      <View className="gap-2">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={async () => {
              await submitPostMeetupReflection(meetupId, o.key);
              onResolved();
            }}
            className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
            <Text className="text-body text-stone-900 dark:text-stone-50">{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function SecondLookPrompt({
  connectionId,
  otherName,
  onResolved,
}: {
  connectionId: string;
  otherName: string;
  onResolved: () => void;
}) {
  const pick = async (r: 'yes' | 'maybe_later' | 'no') => {
    await submitSecondLookResponse(connectionId, r);
    onResolved();
  };
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Would you be open to giving this connection with {otherName} a little more time?
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <OptionPill label="Yes" onPress={() => pick('yes')} />
        <OptionPill label="Maybe later" onPress={() => pick('maybe_later')} />
        <OptionPill label="No" onPress={() => pick('no')} />
      </View>
    </Card>
  );
}

function ConversationRestartPrompt({ onResolved }: { onResolved: () => void }) {
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">It's been a little while. Want help picking the conversation back up?</Text>
      <View className="flex-row flex-wrap gap-2">
        <OptionPill label="Help me restart" onPress={onResolved} />
        <OptionPill label="I'll reach out myself" onPress={onResolved} />
        <OptionPill label="Not right now" onPress={onResolved} />
        <OptionPill label="I don't want to continue" onPress={onResolved} />
      </View>
    </Card>
  );
}

function RhythmReminder({
  connectionId,
  intervention,
  onResolved,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  onResolved: () => void;
}) {
  const isInitial = intervention.payload.mode === 'initial';
  const options: { key: 'weekly' | 'few_weeks' | 'monthly' | 'occasional' | 'not_sure'; label: string }[] = [
    { key: 'weekly', label: 'Every week or two' },
    { key: 'few_weeks', label: 'Every few weeks' },
    { key: 'monthly', label: 'About once a month' },
    { key: 'occasional', label: 'Occasionally' },
    { key: 'not_sure', label: "I'm not sure yet" },
  ];
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        {isInitial ? 'What kind of rhythm would feel natural to you?' : 'You mentioned a pace that felt right before. Want to make a plan?'}
      </Text>
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Private to you — never shown to the other person.</Text>
      <View className="gap-2">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={async () => {
              await submitRhythmPreference(connectionId, o.key);
              onResolved();
            }}
            className="rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700">
            <Text className="text-body text-stone-900 dark:text-stone-50">{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function GraduationCheckpoint({ connectionId, onResolved }: { connectionId: string; onResolved: () => void }) {
  const pick = async (r: 'still_helpful' | 'mostly_on_our_own' | 'not_sure') => {
    await submitGraduationReadiness(connectionId, r);
    onResolved();
  };
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">Does this connection still need Limen to keep moving?</Text>
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Private — shared only if you both say the same thing.</Text>
      <View className="gap-2">
        <OptionPill label="Limen is still helpful" onPress={() => pick('still_helpful')} />
        <OptionPill label="We mostly connect on our own now" onPress={() => pick('mostly_on_our_own')} />
        <OptionPill label="I'm not sure yet" onPress={() => pick('not_sure')} />
      </View>
    </Card>
  );
}

function MeetupDateReconciliation({ intervention, onResolved }: { intervention: ActiveIntervention; onResolved: () => void }) {
  const meetupId = intervention.payload.meetup_id as string;
  const [date, setDate] = useState('');

  const propose = async () => {
    if (!date) return;
    await proposeMeetupDateResolution(meetupId, date);
    onResolved();
  };

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        You both confirmed you met, but the exact date is unclear. Want to help pin it down?
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        This is optional and low-stakes — it only affects your shared history, nothing else.
      </Text>
      <View className="gap-2">
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={MUTED_ICON_COLOR}
          className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
        <View className="flex-row gap-2">
          <Pressable onPress={propose} disabled={!date} className="rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Suggest this date</Text>
          </Pressable>
          <OptionPill label="Not now" onPress={onResolved} />
        </View>
      </View>
    </Card>
  );
}

// Exported for the meetup-history screen's own approve/decline UI.
export async function resolveMeetupDateReconciliation(resolutionId: string, approve: boolean): Promise<void> {
  await resolveMeetupDateResolution(resolutionId, approve);
}
