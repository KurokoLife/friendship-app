import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  cancelMeetup,
  confirmMeetup,
  dismissIntervention,
  FriendlyError,
  proposeMeetupDateResolution,
  reportMeetupOccurrence,
  resolveMeetupDateResolution,
  submitGraduationReadiness,
  submitMeetupCancellationReason,
  submitPostMeetupReflection,
  submitSecondLookResponse,
  respondToMeetupPrompt,
  remindMeToShare,
  type ActiveIntervention,
  type MeetupCancellationReason,
  type PostMeetupReflectionResponse,
} from '@/lib/friendship-journey';
import { supabase } from '@/lib/supabase';
import { getActingAs } from '@/lib/test-mode';
import { formatMeetupDay, formatMeetupTime, formatWhen } from '@/lib/meetup-format';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { StemMessageBox, sendChatMessage } from '@/components/stem-message-box';
import { UniversalTextBox } from '@/components/universal-text-box';
import { TurnOffForChatLink } from '@/components/chat-reminders-sheet';
import { SafetyTipsLink } from '@/components/safety-tips';
import { RememberAsksLine } from '@/components/remember-bar';
import { nameThenPeriod } from '@/lib/names';

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
  // (first-time milestone / activity suggestions
  // branching, unchanged), not a second, simplified reimplementation.
  onPlanSomething?: () => void;
  // Limen v2: the graduation decision point's "Close honestly" option
  // opens the thread's existing Honest Exit modal.
  onEndConnection?: () => void;
  // Meetup plans (2026-10-08): prompt cards can open the plan card's
  // editor ("Need to move it", "Add details") and tell the thread the plan
  // changed (cancelled from the morning-of card).
  onRequestPlanEditor?: (mode: 'change' | 'details') => void;
  onPlanChanged?: () => void;
  // Your own "next time, ask..." notes in the check-in (2026-10-10).
  notesOn?: boolean;
  // A card turned itself off for this chat ("Turn these off"): the thread
  // reloads its reminder settings.
  onPromptsChanged?: () => void;
};

// Friendship Journey rebuild — the single card this app now renders, driven
// entirely by get_active_intervention()'s one returned type (design doc §6).
// Replaces the old pattern of thread/[id].tsx independently evaluating and
// rendering up to six competing cards at once.
//
// __DEV__-gated only, see thread/[id].tsx's own comment for why: this is
// real, tested code, not a stub, but it is not yet the default experience
// for a real production user — that is the deliberate cutover step.
export function PrimaryInterventionCard({
  intervention,
  connectionId,
  otherName,
  onResolved,
  onVideoOfferChange,
  onPlanSomething,
  onEndConnection,
  onRequestPlanEditor,
  onPlanChanged,
  onPromptsChanged,
  notesOn,
}: Props) {
  switch (intervention.intervention_type) {
    case 'no_ghost_r1':
      return (
        <NoGhostR1
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onEndConnection={onEndConnection}
        />
      );
    case 'no_ghost_s1':
      return (
        <NoGhostS1
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onEndConnection={onEndConnection}
        />
      );
    case 'meetup_confirm_needed':
      return <MeetupConfirmNeeded intervention={intervention} otherName={otherName} onResolved={onResolved} />;
    case 'meetup_still_on':
      return (
        <MeetupStillOn
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onRequestPlanEditor={onRequestPlanEditor}
        />
      );
    case 'pre_meetup_support':
      return (
        <PreMeetupSupport
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onVideoOfferChange={onVideoOfferChange}
          onRequestPlanEditor={onRequestPlanEditor}
          onPlanChanged={onPlanChanged}
          onPromptsChanged={onPromptsChanged}
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
          onSuggestAnotherDay={onRequestPlanEditor ? () => onRequestPlanEditor('change') : undefined}
          onEndConnection={onEndConnection}
        />
      );
    case 'post_meetup_reflection':
      return (
        <PostMeetupReflectionPrompt
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onPlanNext={onRequestPlanEditor ? () => onRequestPlanEditor('change') : undefined}
          onEndConnection={onEndConnection}
        />
      );
    case 'share_reminder':
      return (
        <ShareReminderPrompt
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
        />
      );
    case 'second_look_prompt':
      return <SecondLookPrompt connectionId={connectionId} otherName={otherName} onResolved={onResolved} />;
    case 'conversation_restart_prompt':
      return (
        <CheckInPrompt
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          notesOn={notesOn}
          onResolved={onResolved}
          onPromptsChanged={onPromptsChanged}
        />
      );
    case 'graduation_checkpoint':
      return (
        <GraduationCheckpoint
          connectionId={connectionId}
          intervention={intervention}
          otherName={otherName}
          onResolved={onResolved}
          onEndConnection={onEndConnection}
        />
      );
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

// ---- Getting started (rebuilt 2026-10-10) ----
// Only while just one person has written in a chat. The other person gets
// ONE gentle note at their own reply pace (no second or third reminder).
// The person who wrote gets "It's been quiet" at 5 days, and a chat nobody
// answered closes quietly after 7. Once both have written, quiet is just
// quiet: no reply reminders at all (see the check-in card instead).
const REPLY_STEMS = ['Hi! Sorry for the slow reply, ', 'Good to hear from you, ', "It's been a busy few days, "];
const ONE_MORE_STEMS = ['Just checking in, ', 'No pressure at all, ', 'Hope things are okay, '];

function useCardAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const errorText = error ? <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text> : null;
  return { busy, run, errorText };
}

function NoGhostR1({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onEndConnection,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onEndConnection?: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const { busy, run, errorText } = useCardAction();

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        {otherName} said hello and hasn&apos;t heard back yet.
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        A short reply is plenty, even just to say you&apos;re busy. If it&apos;s not for you, a kind note is better than
        silence. Only you see this, and it won&apos;t ask again.
      </Text>
      {errorText}
      {replying ? (
        <StemMessageBox
          stems={REPLY_STEMS}
          onCancel={() => setReplying(false)}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) onResolved();
            return ok;
          }}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Reply" onPress={() => setReplying(true)} />
          <OptionPill
            label="Later"
            onPress={() =>
              !busy &&
              run(async () => {
                if (intervention.intervention_id) await dismissIntervention(intervention.intervention_id);
                onResolved();
              })
            }
          />
          {onEndConnection && <OptionPill label="Not for me" onPress={onEndConnection} />}
        </View>
      )}
    </Card>
  );
}

function NoGhostS1({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onEndConnection,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onEndConnection?: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const { busy, run, errorText } = useCardAction();

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        It&apos;s been quiet since your hello to {nameThenPeriod(otherName)} What would feel right for you?
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Silence usually isn&apos;t about you. If {otherName} doesn&apos;t write back, this chat closes quietly after 7
        days, with no penalty for you.
      </Text>
      {errorText}
      {writing ? (
        <StemMessageBox
          stems={ONE_MORE_STEMS}
          onCancel={() => setWriting(false)}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) onResolved();
            return ok;
          }}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Send one more message" onPress={() => setWriting(true)} />
          <OptionPill
            label="Give it more time"
            onPress={() =>
              !busy &&
              run(async () => {
                if (intervention.intervention_id) await dismissIntervention(intervention.intervention_id, 48);
                onResolved();
              })
            }
          />
          <OptionPill
            label="Close and make room"
            onPress={() =>
              !busy &&
              run(async () => {
                const { error } = await supabase.rpc('set_connection_inactive', { p_connection_id: connectionId });
                if (error) throw error;
                onResolved();
              })
            }
          />
          {onEndConnection && <OptionPill label="End kindly" onPress={onEndConnection} />}
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

const MOVE_STEMS = ['I need to move our plan, ', "Something came up and I can't make it, ", 'Could we find another day? '];
const DAY_OF_CANCEL_STEMS = [
  "Sorry, I need to cancel today, ",
  "Something came up and I can't make it today, ",
  "I'm not able to make it after all, ",
];

function planLine(payload: Record<string, unknown>): string | null {
  const time = formatMeetupTime(payload.start_time as string | null | undefined);
  const place = (payload.place as string | null | undefined) ?? null;
  if (time && place) return `${time} · ${place}`;
  return time ?? place ?? null;
}

// ---- The day before: "Still on?" (2026-10-08) ----
// Shown to each person the day before a confirmed meetup, until they
// answer. "Still on" is shown to the other person on the plan card.
// "Need to move it" stays private and opens the change editor, with an
// optional short message in their own words.
function MeetupStillOn({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onRequestPlanEditor,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onRequestPlanEditor?: (mode: 'change' | 'details') => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const line = planLine(intervention.payload);
  const missingDetails = !intervention.payload.start_time || !intervention.payload.place;
  const [mode, setMode] = useState<'ask' | 'move'>('ask');
  const [busy, setBusy] = useState(false);

  const answer = async (value: 'still_on' | 'needs_move') => {
    setBusy(true);
    try {
      await respondToMeetupPrompt(meetupId, 'still_on', value);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'move') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Moving it is kind. Let {otherName} know, then pick a new day.
        </Text>
        <StemMessageBox
          stems={MOVE_STEMS}
          sendLabel="Send, then pick a new day"
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) {
              onRequestPlanEditor?.('change');
              onResolved();
            }
            return ok;
          }}
        />
        <Pressable
          onPress={() => {
            onRequestPlanEditor?.('change');
            onResolved();
          }}
          className="self-start">
          <Text className="text-caption font-semibold text-accent-500">Just pick a new day</Text>
        </Pressable>
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">Tomorrow with {nameThenPeriod(otherName)} Still on?</Text>
      {line && <Text className="text-caption text-stone-500 dark:text-stone-400">{line}</Text>}
      {missingDetails && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Did you settle a {!intervention.payload.start_time && !intervention.payload.place ? 'time and place' : !intervention.payload.start_time ? 'time' : 'place'}?
          Adding it helps you both show up at the same spot.
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <OptionPill
          label="Still on"
          onPress={async () => {
            if (busy) return;
            await answer('still_on');
            onResolved();
          }}
        />
        <OptionPill
          label="Need to move it"
          onPress={async () => {
            if (busy) return;
            await answer('needs_move');
            setMode('move');
          }}
        />
        {missingDetails && (
          <OptionPill
            label="Add details"
            onPress={() => onRequestPlanEditor?.('details')}
          />
        )}
      </View>
    </Card>
  );
}

type DayOfMode = 'ask' | 'nervous' | 'why' | 'nerves' | 'came_up' | 'move' | 'cancel';

// ---- The morning of (rebuilt 2026-10-08) ----
// Private. Before, "A little nervous" just closed the card with no support,
// and the card came back on every reload. Now each answer leads somewhere
// useful and is remembered (meetup_prompt_responses), so it shows once.
// Cancelling always goes with a short message in their own words: never a
// silent no-show.
function PreMeetupSupport({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onVideoOfferChange,
  onRequestPlanEditor,
  onPlanChanged,
  onPromptsChanged,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onVideoOfferChange?: (active: boolean) => void;
  onRequestPlanEditor?: (mode: 'change' | 'details') => void;
  onPlanChanged?: () => void;
  onPromptsChanged?: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const firstMeetup = intervention.payload.first_meetup === true;
  const line = planLine(intervention.payload);
  const [mode, setMode] = useState<DayOfMode>('ask');

  const showsGuide = mode === 'nervous' || mode === 'nerves';
  useEffect(() => {
    onVideoOfferChange?.(showsGuide);
  }, [showsGuide, onVideoOfferChange]);
  useEffect(() => () => onVideoOfferChange?.(false), [onVideoOfferChange]);

  const answer = (value: string) => respondToMeetupPrompt(meetupId, 'feeling', value).catch(() => undefined);

  const support = (
    <View className="gap-2">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Totally normal. Most people enjoy meeting more than they expect to, and {otherName} is probably a bit nervous
        too.
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        One thing that helps: have one question ready that you&apos;re genuinely curious to ask.
      </Text>
      <Pressable
        onPress={() => router.push({ pathname: '/guide/[id]', params: { id: 'guide_meetup_anxiety' } })}
        className="self-start">
        <Text className="text-caption font-semibold text-accent-500">Watch a 2-minute guide</Text>
      </Pressable>
    </View>
  );

  if (mode === 'ask') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          How are you feeling about meeting {otherName} today?
        </Text>
        {line && <Text className="text-caption text-stone-500 dark:text-stone-400">{line}</Text>}
        <Text className="text-caption italic text-stone-400 dark:text-stone-500">Only you see this.</Text>
        <View className="flex-row flex-wrap gap-2">
          <OptionPill
            label="Looking forward to it"
            onPress={async () => {
              await answer('looking_forward');
              onResolved();
            }}
          />
          <OptionPill
            label="A little nervous"
            onPress={async () => {
              await answer('nervous');
              setMode('nervous');
            }}
          />
          <OptionPill label="Thinking about cancelling" onPress={() => setMode('why')} />
        </View>
        {firstMeetup && <SafetyTipsLink label="Safety tips for meeting someone new" />}
        <TurnOffForChatLink
          connectionId={connectionId}
          kind="morning_of"
          label="Don't ask me this on meetup days in this chat"
          onDone={() => {
            onPromptsChanged?.();
            onResolved();
          }}
        />
      </Card>
    );
  }

  if (mode === 'nervous') {
    return (
      <Card>
        {support}
        <Pressable onPress={onResolved} className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Thanks</Text>
        </Pressable>
      </Card>
    );
  }

  if (mode === 'why') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">Is it nerves, or did something come up?</Text>
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Nerves" onPress={() => setMode('nerves')} />
          <OptionPill label="Something came up" onPress={() => setMode('came_up')} />
        </View>
        <Text className="text-caption text-stone-400 dark:text-stone-500">
          If something feels unsafe, use Report or Block at the top of the chat. You don&apos;t need to explain.
        </Text>
      </Card>
    );
  }

  if (mode === 'nerves') {
    return (
      <Card>
        {support}
        <View className="flex-row flex-wrap gap-2">
          <OptionPill
            label="I'll still go"
            onPress={async () => {
              await answer('going_anyway');
              onResolved();
            }}
          />
          <OptionPill label="Move it to another day" onPress={() => setMode('move')} />
        </View>
      </Card>
    );
  }

  if (mode === 'came_up') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That happens. If you&apos;d still like to meet, moving it is kinder than cancelling.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Move it" onPress={() => setMode('move')} />
          <OptionPill label="Cancel" onPress={() => setMode('cancel')} />
        </View>
      </Card>
    );
  }

  if (mode === 'move') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Let {otherName} know, then pick a new day.
        </Text>
        <StemMessageBox
          stems={MOVE_STEMS}
          sendLabel="Send, then pick a new day"
          onCancel={() => setMode('ask')}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) {
              await answer('moving');
              onRequestPlanEditor?.('change');
              onResolved();
            }
            return ok;
          }}
        />
      </Card>
    );
  }

  // cancel
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Let {otherName} know with a short message. The plan is cancelled when you send it.
      </Text>
      <StemMessageBox
        stems={DAY_OF_CANCEL_STEMS}
        sendLabel="Send and cancel"
        onCancel={() => setMode('came_up')}
        onSend={async (text) => {
          const ok = await sendChatMessage(connectionId, text);
          if (!ok) return false;
          try {
            await answer('cancelling');
            await cancelMeetup(meetupId, 'cancelled');
            onPlanChanged?.();
            onResolved();
            return true;
          } catch {
            return false;
          }
        }}
      />
    </Card>
  );
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
  | 'cancelled_done'
  | 'no_show'
  | 'yes_waiting'
  | 'logged_no';

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
function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

function OccurrenceError({ error, detail }: { error: string | null; detail: string | null }) {
  if (!error) return null;
  return (
    <View className="gap-0.5">
      <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>
      {detail ? <Text className="text-caption text-stone-400 dark:text-stone-500">Test account detail: {detail}</Text> : null}
    </View>
  );
}

function MeetupOccurrenceCheck({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onPlanSomething,
  onSuggestAnotherDay,
  onEndConnection,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onPlanSomething?: () => void;
  onSuggestAnotherDay?: () => void;
  onEndConnection?: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const confirmedDate = intervention.payload.confirmed_date as string | undefined;
  const dateLabel = confirmedDate
    ? formatWhen(confirmedDate, intervention.payload.start_time as string | null | undefined)
    : null;

  // 2026-10-10: the other person added this meetup ("We met up"), so the
  // question is whether that's right, not whether a plan happened.
  const loggedByOther = typeof intervention.payload.logged_by === 'string';
  const loggedActivity = intervention.payload.activity as string | null | undefined;
  const [mode, setMode] = useState<OccurrenceMode>('ask');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<MeetupCancellationReason | null>(null);
  const [draft, setDraft] = useState('');
  const [draftEdited, setDraftEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [actingAs, setActingAs] = useState<string | null>(null);
  useEffect(() => {
    getActingAs().then(setActingAs);
  }, []);
  // Any failed step shows a message instead of silently doing nothing
  // (2026-10-08: "didn't show up" failed silently).
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof FriendlyError ? e.message : "That didn't go through. Please try again.");
      // Test accounts also see the technical reason, so a problem on the
      // live site can be traced (2026-10-10).
      setErrorDetail(!(e instanceof FriendlyError) && actingAs ? errorText(e) : null);
    } finally {
      setBusy(false);
    }
  };

  const handleDraftChange = (text: string) => {
    setDraft(text);
    setDraftEdited(true);
  };

  const answerYes = async () => {
    await attempt(async () => {
      const result = await reportMeetupOccurrence(meetupId, true, confirmedDate ?? null);
      if (result.resolved) onResolved();
      else setMode('yes_waiting');
    });
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
    await attempt(async () => {
      await reportMeetupOccurrence(meetupId, false);
      setMode('rescheduled_done');
    });
  };

  const pickCancelled = () => setMode('cancelled_reason');

  // 2026-10-08: "They didn't show up". Recorded privately, nobody is
  // accused, and the person who waited gets a kind note and real choices.
  const pickNoShow = async () => {
    await attempt(async () => {
      await submitMeetupCancellationReason(meetupId, 'no_show');
      await reportMeetupOccurrence(meetupId, false);
      setMode('no_show');
    });
  };

  const submitReason = (r: MeetupCancellationReason) => {
    setReason(r);
    setMode('cancelled_reschedule_ask');
  };

  const answerRescheduleWanted = async (wants: boolean) => {
    if (!reason) return;
    await attempt(async () => {
      await submitMeetupCancellationReason(meetupId, reason, wants);
      await reportMeetupOccurrence(meetupId, false);
      setMode(wants ? 'cancelled_reschedule_compose' : 'cancelled_done');
    });
  };

  const sendRescheduleMessage = async () => {
    if (!draft.trim()) return;
    await attempt(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error: sendError } = await supabase
        .from('messages')
        .insert({ connection_id: connectionId, sender_id: user.id, content: draft.trim(), type: 'text' });
      if (sendError) throw sendError;
      setMode('cancelled_done');
    });
  };

  if (mode === 'ask' && loggedByOther) {
    return (
      <Card>
        <OccurrenceError error={error} detail={errorDetail} />
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {otherName} added a meetup: you two met on {dateLabel ?? 'a recent day'}
          {loggedActivity ? ` (${loggedActivity})` : ''}. Is that right?
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Yes, we met" onPress={answerYes} />
          <OptionPill
            label="No, that's not right"
            onPress={() =>
              attempt(async () => {
                const result = await reportMeetupOccurrence(meetupId, false);
                if (result.resolved && result.status === 'stale') onResolved();
                else setMode('logged_no');
              })
            }
          />
        </View>
      </Card>
    );
  }

  if (mode === 'logged_no') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Okay, it won&apos;t be counted. If the day was just off, you can add it with the right day from the plan card.
        </Text>
        <OptionPill label="Close" onPress={onResolved} />
      </Card>
    );
  }

  if (mode === 'ask') {
    return (
      <Card>
        <OccurrenceError error={error} detail={errorDetail} />
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

  if (mode === 'yes_waiting') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Thanks. It counts once {otherName} says yes too. If they don&apos;t answer within a week, it counts anyway.
        </Text>
        <OptionPill label="Close" onPress={onResolved} />
      </Card>
    );
  }

  if (mode === 'no_followup') {
    return (
      <Card>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-body text-stone-700 dark:text-stone-300">What happened?</Text>
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="We moved it" onPress={pickRescheduled} />
          <OptionPill label="It was cancelled" onPress={pickCancelled} />
          <OptionPill label={`${otherName} didn't show up`} onPress={pickNoShow} />
        </View>
      </Card>
    );
  }

  if (mode === 'no_show') {
    return (
      <Card>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That&apos;s disappointing, and it isn&apos;t on you. Sometimes people get overwhelmed or something comes
          up. You can suggest another day, or end things kindly.
        </Text>
        <Text className="text-caption italic text-stone-400 dark:text-stone-500">Only you see this.</Text>
        <View className="flex-row flex-wrap gap-2">
          {onSuggestAnotherDay && (
            <OptionPill
              label="Suggest another day"
              onPress={() => {
                onSuggestAnotherDay();
                onResolved();
              }}
            />
          )}
          {onEndConnection && <OptionPill label="End kindly" onPress={onEndConnection} />}
          <OptionPill label="Not now" onPress={onResolved} />
        </View>
      </Card>
    );
  }

  if (mode === 'rescheduled_done') {
    return (
      <Card>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-body text-stone-700 dark:text-stone-300">
          No problem. Add the new day to the plan so your reminders follow it.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {onSuggestAnotherDay && (
            <OptionPill
              label="Plan the new day"
              onPress={() => {
                onSuggestAnotherDay();
                onResolved();
              }}
            />
          )}
          <OptionPill label="Later" onPress={onResolved} />
        </View>
      </Card>
    );
  }

  if (mode === 'cancelled_reason') {
    return (
      <Card>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
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
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
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
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <Text className="text-body text-stone-700 dark:text-stone-300">
          You don&apos;t need a perfect message. Write what you&apos;re thinking, in your own words.
          {/* Limen v2: AI no longer cleans up or rewrites messages. */}
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
        <UniversalTextBox value={draft} onChangeText={handleDraftChange} disabled={busy} />
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
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Thanks for letting us know. No further action needed.
      </Text>
      <Pressable onPress={onResolved} className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
        <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Close</Text>
      </Pressable>
    </Card>
  );
}

// "How did it go?" (rebuilt 2026-10-08). Shown to each person once both
// said the meetup happened. Private. Used to be followed by a second card
// ("Would you be open to giving this connection a little more time?") that
// asked the same thing again; that question is gone. Now a good answer
// leads straight to planning the next meetup while it's fresh, and "I
// don't think we'll continue" offers the kind way to end things.
const SHARE_STEMS = ['I really enjoyed ', 'Thanks for today, ', 'It was good to see you, '];

// "Remind me later" (2026-10-10). The person picks when the private "tell
// them how it was" card should come back. It comes back once, in this chat
// only, and only the person sees it.
const REMIND_OPTIONS: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
];

function reminderDayLabel(at: string | null): string {
  if (!at) return 'then';
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function RemindLaterChoice({
  meetupId,
  otherName,
  doneAt,
  onPicked,
  onBack,
  onClose,
}: {
  meetupId: string;
  otherName: string;
  doneAt: string | null;
  onPicked: (at: string | null) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (doneAt !== null) {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Okay. On {reminderDayLabel(doneAt)}, this chat will ask again if you&apos;d like to tell {otherName} how it was.
          Only you&apos;ll see it.
        </Text>
        <OptionPill label="Close" onPress={onClose} />
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">When should we ask you again?</Text>
      <View className="flex-row flex-wrap gap-2">
        {REMIND_OPTIONS.map((o) => (
          <OptionPill
            key={o.days}
            label={o.label}
            onPress={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                onPicked(await remindMeToShare(meetupId, o.days));
              } catch {
                setError("That didn't save. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          />
        ))}
        <OptionPill label="Back" onPress={onBack} />
      </View>
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
    </Card>
  );
}

// The reminder the person asked for, back on the day they chose.
function ShareReminderPrompt({
  connectionId,
  intervention,
  otherName,
  onResolved,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const meetupDate = intervention.payload.meetup_date as string | null;
  const [mode, setMode] = useState<'ask' | 'sharing' | 'shared' | 'remind' | 'reminded'>('ask');
  const [remindAt, setRemindAt] = useState<string | null>(null);

  // The card is put away (resolved) as soon as the person does anything with
  // it; what they see next is just this card's own follow-up.
  const putAway = async () => {
    if (intervention.intervention_id) {
      try {
        await dismissIntervention(intervention.intervention_id);
      } catch {
        // Best effort: the card still closes.
      }
    }
  };

  if (mode === 'remind' || mode === 'reminded') {
    return (
      <RemindLaterChoice
        meetupId={meetupId}
        otherName={otherName}
        doneAt={mode === 'reminded' ? remindAt : null}
        onPicked={(at) => {
          setRemindAt(at);
          setMode('reminded');
        }}
        onBack={() => setMode('ask')}
        onClose={onResolved}
      />
    );
  }

  if (mode === 'sharing') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">In your own words, a line or two is plenty.</Text>
        <StemMessageBox
          stems={SHARE_STEMS}
          onCancel={() => setMode('ask')}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) {
              await putAway();
              setMode('shared');
            }
            return ok;
          }}
        />
      </Card>
    );
  }

  if (mode === 'shared') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">Sent.</Text>
        <OptionPill label="Close" onPress={onResolved} />
      </Card>
    );
  }

  const when = meetupDate ? ` on ${formatMeetupDay(meetupDate)}` : '';
  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        You asked to be reminded. Would you like to tell {otherName} how your meetup{when} was for you? Only if you want
        to.
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">If you already have, you can close this.</Text>
      <View className="flex-row flex-wrap gap-2">
        <OptionPill label={`Tell ${otherName}`} onPress={() => setMode('sharing')} />
        <OptionPill label="Remind me later" onPress={() => setMode('remind')} />
        <OptionPill
          label="Not now"
          onPress={async () => {
            await putAway();
            onResolved();
          }}
        />
      </View>
    </Card>
  );
}

function PostMeetupReflectionPrompt({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onPlanNext,
  onEndConnection,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onPlanNext?: () => void;
  onEndConnection?: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
  const [after, setAfter] = useState<'none' | 'went_well' | 'sharing' | 'shared' | 'remind' | 'reminded' | 'thanks' | 'ending'>('none');
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options: { key: PostMeetupReflectionResponse; label: string }[] = [
    { key: 'know_better', label: `Really good, I'd like to see ${otherName} again` },
    { key: 'open_to_another', label: 'Good, I\'m open to another meetup' },
    { key: 'still_figuring', label: "I'm not sure yet" },
    { key: 'dont_continue', label: "I don't think we'll continue" },
  ];

  const pick = async (key: PostMeetupReflectionResponse) => {
    if (busy) return;
    setBusy(true);
    try {
      await submitPostMeetupReflection(meetupId, key);
      setAfter(key === 'know_better' || key === 'open_to_another' ? 'went_well' : key === 'dont_continue' ? 'ending' : 'thanks');
    } finally {
      setBusy(false);
    }
  };

  // 2026-10-10: after a good meetup, the person decides what (if anything)
  // to do with that. Telling the other person how it was, planning again,
  // or nothing are equal choices; the app doesn't push any of them.
  if (after === 'went_well' || after === 'shared') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {after === 'shared'
            ? 'Sent.'
            : `Glad it went well. Would you like to tell ${otherName} how it was for you? Only if you want to.`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {after === 'went_well' && <OptionPill label={`Tell ${otherName}`} onPress={() => setAfter('sharing')} />}
          {after === 'went_well' && <OptionPill label="Remind me later" onPress={() => setAfter('remind')} />}
          {onPlanNext && (
            <OptionPill
              label="Plan another meetup"
              onPress={() => {
                onPlanNext();
                onResolved();
              }}
            />
          )}
          <OptionPill label={after === 'shared' ? 'Close' : 'Not now'} onPress={onResolved} />
        </View>
      </Card>
    );
  }

  if (after === 'remind' || after === 'reminded') {
    return (
      <RemindLaterChoice
        meetupId={meetupId}
        otherName={otherName}
        doneAt={after === 'reminded' ? remindAt : null}
        onPicked={(at) => {
          setRemindAt(at);
          setAfter('reminded');
        }}
        onBack={() => setAfter('went_well')}
        onClose={onResolved}
      />
    );
  }

  if (after === 'sharing') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">In your own words, a line or two is plenty.</Text>
        <StemMessageBox
          stems={SHARE_STEMS}
          onCancel={() => setAfter('went_well')}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) setAfter('shared');
            return ok;
          }}
        />
      </Card>
    );
  }

  if (after === 'ending') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That&apos;s okay. Not every meetup turns into a friendship. If you&apos;re ready, a short, kind message is
          better than going quiet.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {onEndConnection && <OptionPill label="End kindly" onPress={onEndConnection} />}
          <OptionPill label="Not now" onPress={onResolved} />
        </View>
      </Card>
    );
  }

  if (after === 'thanks') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That&apos;s normal. There&apos;s no rush. You can plan another whenever it feels right.
        </Text>
        <OptionPill label="Close" onPress={onResolved} />
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">How did it go with {otherName}?</Text>
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Only you see this answer.</Text>
      <View className="gap-2">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => pick(o.key)}
            disabled={busy}
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

// Check-in (2026-10-10, replaces "Pick it back up?"). Shown privately to
// each person once both have written and the chat has been quiet for 5
// days, once per quiet stretch. It never says "your turn": a conversation
// that ended is fine. It only offers a chance to say hi. Can be turned off.
const CHECK_IN_STEMS = ['Hi! Just checking in, ', 'Hope your week is going okay, ', 'Thinking of you, '];

function CheckInPrompt({
  connectionId,
  intervention,
  otherName,
  notesOn = true,
  onResolved,
  onPromptsChanged,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  notesOn?: boolean;
  onResolved: () => void;
  onPromptsChanged?: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const { busy, run, errorText } = useCardAction();

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        It&apos;s been quiet with {otherName} for a bit. That&apos;s normal. If you&apos;d like, say hi or see how
        they&apos;re doing.
      </Text>
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Only you see this.</Text>
      <RememberAsksLine connectionId={connectionId} otherName={otherName} notesOn={notesOn} />
      {errorText}
      {writing ? (
        <StemMessageBox
          stems={CHECK_IN_STEMS}
          onCancel={() => setWriting(false)}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) onResolved();
            return ok;
          }}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Say hi" onPress={() => setWriting(true)} />
          <OptionPill
            label="Not now"
            onPress={() =>
              !busy &&
              run(async () => {
                if (intervention.intervention_id) await dismissIntervention(intervention.intervention_id);
                onResolved();
              })
            }
          />
        </View>
      )}
      <TurnOffForChatLink
        connectionId={connectionId}
        kind="check_in"
        label="Turn off check-ins for this chat"
        onDone={() => {
          onPromptsChanged?.();
          onResolved();
        }}
      />
    </Card>
  );
}

// Limen v2 (2026-10-03) graduation spec, see docs/LIMEN_V2_DECISIONS.md.
// get_active_intervention returns payload.stage:
//   - 'ready_check': earliest point (6+ meetups over 8+ weeks, both people
//     have proposed at least 2 plans, a rhythm is set). Asked privately.
//   - 'decision_point': 10 meetups or 6 months since matching. A choice is
//     required: graduate together, keep going here for now (with a short
//     private reason), or close honestly.
// Answers are private. Nobody ever sees the other person's answer; only a
// mutual "yes" is revealed, by graduating the connection for both.
function GraduationCheckpoint({
  connectionId,
  intervention,
  otherName,
  onResolved,
  onEndConnection,
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onEndConnection?: () => void;
}) {
  const stage = (intervention.payload?.stage as string | undefined) ?? 'ready_check';
  const meetups = intervention.payload?.meetup_count as number | undefined;
  const [mode, setMode] = useState<'ask' | 'reason' | 'graduated' | 'waiting'>('ask');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (r: 'still_helpful' | 'mostly_on_our_own' | 'not_sure', note?: string) => {
    setBusy(true);
    try {
      const graduated = await submitGraduationReadiness(connectionId, r, note);
      if (graduated) {
        setMode('graduated');
        return;
      }
      if (r === 'mostly_on_our_own') {
        setMode('waiting');
        return;
      }
      onResolved();
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'graduated') {
    return (
      <Card>
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">You both said yes.</Text>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          You and {otherName} have a rhythm and you both make plans. That&apos;s what it takes to keep a friendship
          going. If you haven&apos;t yet, swap numbers so you can keep going outside Limen. This chat stays available.
        </Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Friendships still need tending. Limen will check in privately in a month, and again in three.
        </Text>
        <OptionPill label="Done" onPress={onResolved} />
      </Card>
    );
  }

  if (mode === 'waiting') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Thanks. Your answer stays private. If {otherName} feels the same, you&apos;ll both see it.
        </Text>
        <OptionPill label="OK" onPress={onResolved} />
      </Card>
    );
  }

  if (mode === 'reason') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          What is Limen still helping with? This is just for you, nobody else sees it.
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="In your own words"
          placeholderTextColor={MUTED_ICON_COLOR}
          multiline
          className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
        />
        <View className="flex-row gap-2">
          <OptionPill label="Save" onPress={() => pick('still_helpful', reason.trim() || undefined)} />
          <OptionPill label="Back" onPress={() => setMode('ask')} />
        </View>
      </Card>
    );
  }

  if (stage === 'decision_point') {
    return (
      <Card>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {meetups && meetups >= 10
            ? `You and ${otherName} have met ${meetups} times.`
            : `It's been about six months since you and ${otherName} connected.`}{' '}
          It&apos;s time to decide where this goes next.
        </Text>
        <Text className="text-caption text-stone-400 dark:text-stone-600">
          Private. {otherName} only sees an outcome if you both choose to graduate.
        </Text>
        <View className="gap-2">
          <OptionPill label="Graduate, we can keep this going ourselves" onPress={() => !busy && pick('mostly_on_our_own')} />
          <OptionPill label="Keep going here for now" onPress={() => setMode('reason')} />
          <OptionPill
            label="Close this honestly"
            onPress={() => {
              if (onEndConnection) onEndConnection();
              else onResolved();
            }}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        You and {otherName} both make plans and you have a rhythm. Could you two keep this going outside Limen?
      </Text>
      <Text className="text-caption text-stone-400 dark:text-stone-600">
        Private. Nobody sees your answer. If you both say yes, you graduate together.
      </Text>
      <View className="gap-2">
        <OptionPill label="Yes" onPress={() => !busy && pick('mostly_on_our_own')} />
        <OptionPill label="Not yet" onPress={() => !busy && pick('still_helpful')} />
        <OptionPill label="I'm not sure this is a friendship" onPress={() => !busy && pick('not_sure')} />
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
        This is optional and low-stakes. It only affects your shared history, nothing else.
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
