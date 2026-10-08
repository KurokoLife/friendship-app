import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
  respondToMeetupPrompt,
  type ActiveIntervention,
  type MeetupCancellationReason,
  type PauseDuration,
} from '@/lib/friendship-journey';
import { supabase } from '@/lib/supabase';
import { formatMeetupTime, formatWhen } from '@/lib/meetup-format';
import { MicPlaceholderButton } from '@/components/mic-placeholder-button';
import { StemMessageBox, sendChatMessage } from '@/components/stem-message-box';
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
  // Limen v2: the graduation decision point's "Close honestly" option
  // opens the thread's existing Honest Exit modal.
  onEndConnection?: () => void;
  // Meetup plans (2026-10-08): prompt cards can open the plan card's
  // editor ("Need to move it", "Add details") and tell the thread the plan
  // changed (cancelled from the morning-of card).
  onRequestPlanEditor?: (mode: 'change' | 'details') => void;
  onPlanChanged?: () => void;
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
}: Props) {
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
      return <PostMeetupReflectionPrompt intervention={intervention} otherName={otherName} onResolved={onResolved} />;
    case 'second_look_prompt':
      return <SecondLookPrompt connectionId={connectionId} otherName={otherName} onResolved={onResolved} />;
    case 'conversation_restart_prompt':
      return <ConversationRestartPrompt onResolved={onResolved} />;
    case 'rhythm_reminder':
      return <RhythmReminder connectionId={connectionId} intervention={intervention} onResolved={onResolved} />;
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
            things stand. Write what you&apos;re thinking, in your own words.
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
          <UniversalTextBox value={draft} onChangeText={setDraft} />
          <Pressable onPress={send} disabled={!draft.trim()} className="self-start rounded-full bg-stone-900 px-4 py-2 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Send</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <OptionPill label="Reply" onPress={() => setShowCompose(true)} />
          <OptionPill label="Reflect, then reply" onPress={() => setShowCompose(true)} />
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
            You don&apos;t need a perfect reply. Write what you&apos;re thinking, in your own words.
            {/* Limen v2: AI no longer cleans up or rewrites messages. */}
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
          <UniversalTextBox value={draft} onChangeText={setDraft} />
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
            You don&apos;t need a perfect message. Write what you&apos;re thinking, in your own words.
            {/* Limen v2: AI no longer cleans up or rewrites messages. */}
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
          <UniversalTextBox value={draft} onChangeText={setDraft} />
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
      <Text className="text-body text-stone-700 dark:text-stone-300">Tomorrow with {otherName}. Still on?</Text>
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
}: {
  connectionId: string;
  intervention: ActiveIntervention;
  otherName: string;
  onResolved: () => void;
  onVideoOfferChange?: (active: boolean) => void;
  onRequestPlanEditor?: (mode: 'change' | 'details') => void;
  onPlanChanged?: () => void;
}) {
  const meetupId = intervention.payload.meetup_id as string;
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
  | 'no_show';

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

  // 2026-10-08: "They didn't show up". Recorded privately, nobody is
  // accused, and the person who waited gets a kind note and real choices.
  const pickNoShow = async () => {
    setBusy(true);
    try {
      await submitMeetupCancellationReason(meetupId, 'no_show');
      await reportMeetupOccurrence(meetupId, false);
      setMode('no_show');
    } finally {
      setBusy(false);
    }
  };

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
      <Text className="text-caption italic text-stone-400 dark:text-stone-600">Private to you. Never shown to the other person.</Text>
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
