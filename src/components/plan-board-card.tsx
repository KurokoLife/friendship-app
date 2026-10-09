import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { StemMessageBox, sendChatMessage } from '@/components/stem-message-box';
import {
  BUDGET_OPTIONS,
  DURATION_OPTIONS,
  PART_LABELS,
  PART_START_TIME,
  PARTS,
  SLOT_LABELS,
  STYLE_LABELS,
  TRAVEL_OPTIONS,
  addOwnIdea,
  closePlanBoard,
  dayLabel,
  getPlanBoard,
  isoDay,
  loadNewIdeas,
  nextTwoWeeks,
  setHomePref,
  setPlanPrefs,
  setTimes,
  slotKey,
  revertPicks,
  savePicks,
  togglePick,
  usualLabel,
  usualTimes,
  type PlanBudget,
  type PlanDuration,
  type PlanIdea,
  type PlanPart,
  type PlanSlot,
  type PlanState,
} from '@/lib/plan-board';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const QUIET_NUDGE_DAYS = 3;
const HOME_WORDS = /\b(home|house|apartment|my place|your place|backyard)\b/i;
// After this many saves with no match, the card suggests starting simple.
const SIMPLE_AFTER_ROUNDS = 2;
const SIMPLE_IDEA = 'Coffee and a short walk';

// "Let's plan something" (2026-10-09): one card both people see.
//   1. The first person picks ideas and marks when they're free, then
//      "Save and send". Their usual times from the profile start filled in.
//   2. The other person sees those picks and times, adds theirs and sends.
//      If an idea and a time match, the person who sent second suggests the
//      plan: the plan editor opens filled in (exact time and place), with
//      an optional note they write themselves.
//   3. The first person confirms the plan in the plan card.
// No match: calm options and starters for asking in the chat. It ends with
// a confirmed plan, "Not now", or 14 quiet days. The AI only suggests the
// starting ideas; the two people decide everything else.

type Props = {
  connectionId: string;
  myId: string;
  otherName: string;
  refreshKey?: number;
  // Bumped when this person taps "Let's plan something": opens the card.
  openRequest?: number;
  onStart: () => void;
  onGoToPlan: (prefill: { date: string; startTime: string; activity: string; note?: string }) => void;
};

function firstName(name: string) {
  return name.split(' ')[0] || name;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-full border px-3 py-1.5 ${
        selected ? 'border-accent-500 bg-accent-500/15' : 'border-stone-300 dark:border-stone-700'
      }`}>
      <Text className="text-caption text-stone-700 dark:text-stone-300">{label}</Text>
    </Pressable>
  );
}

function LinkButton({ label, onPress, disabled, muted }: { label: string; onPress: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className={disabled ? 'opacity-40' : ''}>
      <Text className={`text-caption font-semibold ${muted ? 'text-stone-500 dark:text-stone-400' : 'text-accent-500'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${disabled ? 'opacity-40' : ''}`}>
      <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">{label}</Text>
    </Pressable>
  );
}

export function PlanBoardCard({ connectionId, myId, otherName, refreshKey, openRequest, onStart, onGoToPlan }: Props) {
  const name = firstName(otherName);
  const [state, setState] = useState<PlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [prefsSkipped, setPrefsSkipped] = useState(false);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [homeSkipped, setHomeSkipped] = useState(false);
  const [editingHome, setEditingHome] = useState(false);
  const [ownIdea, setOwnIdea] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const [askSent, setAskSent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lookAgain, setLookAgain] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [pickedIdea, setPickedIdea] = useState<string | null>(null);
  const [pickedTime, setPickedTime] = useState<string | null>(null);
  const [dismissedEnding, setDismissedEnding] = useState<string | null>(null);
  const [myTimes, setMyTimes] = useState<Set<string>>(new Set());
  const [availability, setAvailability] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // True once this person tapped "Let's plan something" here. Their limits
  // (and, after a first meetup, the home question) are asked only then,
  // never when they simply open a card the other person started.
  const [askFlow, setAskFlow] = useState(false);
  const generatedFor = useRef<string | null>(null);
  const autofilledFor = useRef<string | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const next = await getPlanBoard(connectionId);
      setState(next);
      setMyTimes(new Set((next?.board?.my_times ?? []).map(slotKey)));
    } catch {
      setState(null);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (openRequest) {
      setSheetOpen(true);
      setAskFlow(true);
    }
  }, [openRequest]);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('availability')
      .eq('user_id', myId)
      .maybeSingle()
      .then(({ data }) => setAvailability(((data?.availability as string[] | null) ?? []).filter(Boolean)));
  }, [myId]);

  // Live: the other person's marks and times show up without a reload.
  useEffect(() => {
    const channel = supabase.channel(`plan-${connectionId}-${Math.random().toString(36).slice(2)}`);
    for (const table of ['plan_boards', 'plan_ideas', 'plan_picks', 'plan_times', 'plan_saves', 'plan_saved_picks', 'plan_saved_times']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `connection_id=eq.${connectionId}` }, () =>
        load()
      );
    }
    channel.subscribe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    return () => {
      supabase.removeChannel(channel);
      sub.remove();
    };
  }, [connectionId, load]);

  const board = state?.board ?? null;
  const open = board?.status === 'open';
  const meetupCount = state?.meetup_count ?? 0;
  const needsPrefs = open && (editingPrefs || (askFlow && !state?.my_prefs && !prefsSkipped));
  const needsHome = open && !needsPrefs && (editingHome || (askFlow && meetupCount >= 1 && !state?.my_home && !homeSkipped));
  const hasIdeas = (board?.ideas ?? []).some((i) => i.source !== 'own');

  const newIdeas = useCallback(
    async (boardId: string) => {
      setGenerating(true);
      setError(null);
      try {
        const result = await loadNewIdeas(boardId);
        if (result === 'limit') setLimitReached(true);
      } catch {
        setError("Couldn't load ideas right now. You can add your own idea.");
      } finally {
        setGenerating(false);
        await load();
      }
    },
    [load]
  );

  // The first three ideas, once the person's limits are known (or skipped).
  useEffect(() => {
    if (!board || !open || hasIdeas || needsPrefs || needsHome || generating) return;
    if (generatedFor.current === board.id) return;
    // The person who started the card asks for the ideas. If they left
    // before that happened, the other person's app does it after a minute.
    if (board.started_by !== myId && Date.now() - new Date(board.created_at).getTime() < 60000) return;
    generatedFor.current = board.id;
    newIdeas(board.id);
  }, [board, open, hasIdeas, needsPrefs, needsHome, generating, newIdeas, myId]);

  // Usual times from the profile start filled in on someone's first turn.
  // They see them highlighted and can change them before sending.
  useEffect(() => {
    if (!board || !open || board.my_saved_at || availability.length === 0) return;
    if (autofilledFor.current === board.id) return;
    autofilledFor.current = board.id;
    if (board.my_times.length > 0) return;
    const slots = usualTimes(availability);
    if (slots.length === 0) return;
    setMyTimes(new Set(slots.map(slotKey)));
    saveChain.current = saveChain.current.then(() => setTimes(board.id, slots)).catch(() => undefined);
  }, [board, open, availability]);

  const run = async (fn: () => Promise<void>, fail = "That didn't save. Please try again.") => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (/plan_closed|chat_not_open/.test(message)) setError('This plan has ended.');
      else if (/too_many_ideas/.test(message)) setError('That is plenty of added ideas for one plan.');
      else if (/no_picks/.test(message)) setError('Pick at least one idea first.');
      else if (/home_first_meetup/.test(message))
        setError('Before your first meetup, pick a public place, so it feels comfortable for both of you.');
      else setError(fail);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!state || !board || state.has_upcoming_plan || !state.chat_open) return null;

  // ---- Ended ----
  if (!open) {
    if (dismissedEnding === board.id) return null;
    if (board.close_reason !== 'not_now' && board.close_reason !== 'quiet') return null;
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {board.close_reason === 'quiet'
            ? 'This plan closed after 2 quiet weeks. Start again anytime.'
            : 'No plan for now. Start again anytime.'}
        </Text>
        <View className="flex-row gap-4">
          <LinkButton label="Start again" onPress={onStart} />
          <LinkButton label="OK" muted onPress={() => setDismissedEnding(board.id)} />
        </View>
      </View>
    );
  }

  const quietDays = (Date.now() - new Date(board.last_activity_at).getTime()) / 86400000;
  const nudge =
    quietDays >= QUIET_NUDGE_DAYS ? (
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Nothing new for a few days. This plan closes quietly on {shortDate(board.closes_at)} if nobody adds
        anything.
      </Text>
    ) : null;
  // In the chat: a short summary. Tapping it opens the whole card as a
  // sheet, so the messages stay in view.
  const shell = (children: ReactNode, summary: string) => (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        className="mx-6 mt-4 gap-1 rounded-2xl border border-accent-500/40 bg-white p-4 dark:bg-stone-800">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Planning together</Text>
          <Text className="text-caption font-semibold text-accent-500">Open</Text>
        </View>
        <Text className="text-caption text-stone-600 dark:text-stone-300">{summary}</Text>
        {nudge}
      </Pressable>
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View className="flex-1 justify-end bg-black/30">
          <Pressable className="flex-1" onPress={() => setSheetOpen(false)} />
          <View className="max-h-[88%] gap-3 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-title text-stone-900 dark:text-stone-50">Planning together</Text>
              <View className="flex-row gap-4">
                <LinkButton label="Not now" muted disabled={busy} onPress={() => run(() => closePlanBoard(board.id))} />
                <LinkButton label="Close" onPress={() => setSheetOpen(false)} />
              </View>
            </View>
            <ScrollView contentContainerClassName="gap-3 pb-4" keyboardShouldPersistTaps="handled">
              {children}
              {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
              {nudge}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );

  // ---- Limits (asked once, changeable) ----
  if (needsPrefs) {
    return shell(
      <PrefsForm
        initial={state.my_prefs}
        name={name}
        editing={editingPrefs}
        onDone={async (p) => {
          if (p) await run(() => setPlanPrefs(p.budget, p.duration, p.travel));
          else setPrefsSkipped(true);
          setEditingPrefs(false);
        }}
      />,
      'A few quick questions first, then ideas.'
    );
  }

  // ---- Home ideas (asked once per friendship, after the first meetup) ----
  if (needsHome) {
    return shell(
      <HomeForm
        name={name}
        initial={state.my_home}
        onDone={async (host, visit) => {
          if (host !== null) await run(() => setHomePref(connectionId, host, visit));
          else setHomeSkipped(true);
          setEditingHome(false);
        }}
      />,
      'One quick question first, then ideas.'
    );
  }

  const ideas = board.ideas;
  const titlesOf = (list: PlanIdea[]) => list.map((i) => i.title);
  const today = isoDay(new Date());
  const days = nextTwoWeeks();

  // Ideas
  const draft = ideas.filter((i) => i.picked_by_me);
  const savedMine = ideas.filter((i) => i.saved_by_me);
  const theirs = ideas.filter((i) => i.picked_by_other);
  const shared = ideas.filter((i) => i.saved_by_me && i.picked_by_other);

  // Times
  const mySavedTimes = new Set(board.my_saved_times.map(slotKey));
  const otherTimes = new Set(board.other_times.map(slotKey));
  const sharedTimes: PlanSlot[] = board.my_saved_times
    .filter((s) => s.day >= today && otherTimes.has(slotKey(s)))
    .sort((a, b) => a.day.localeCompare(b.day) || PARTS.indexOf(a.part) - PARTS.indexOf(b.part));
  const otherUsualLabel = usualLabel(state.other_usual);
  const otherUsual = new Set(usualTimes(state.other_usual, days).map(slotKey));

  const iSaved = !!board.my_saved_at;
  const theySaved = !!board.other_saved_at;
  const timesChanged = myTimes.size !== mySavedTimes.size || [...myTimes].some((k) => !mySavedTimes.has(k));
  const draftChanged =
    iSaved && (draft.length !== savedMine.length || draft.some((i) => !i.saved_by_me) || timesChanged);
  const picking = !iSaved || editing || draftChanged;
  const secondSaver = iSaved && theySaved && new Date(board.my_saved_at!).getTime() > new Date(board.other_saved_at!).getTime();
  const refreshesLeft = limitReached ? 0 : board.refreshes_left;
  const ownIdeaHomeBlocked = meetupCount === 0 && HOME_WORDS.test(ownIdea);

  const save = () =>
    run(async () => {
      await saveChain.current;
      await savePicks(board.id);
      setEditing(false);
      setLookAgain(false);
      setAskOpen(false);
      setAskSent(false);
    });

  const saveTimes = (next: Set<string>) => {
    setMyTimes(next);
    const slots = [...next].map((k) => {
      const [day, part] = k.split('|');
      return { day, part: part as PlanPart };
    });
    saveChain.current = saveChain.current
      .then(() => setTimes(board.id, slots))
      .catch(() => setError("Couldn't save your times. Please try again."));
  };

  const editLink = (
    <LinkButton
      label="Edit my picks and times"
      muted
      disabled={busy}
      onPress={() => {
        setEditing(true);
        setLookAgain(false);
      }}
    />
  );
  const listLine = (label: string, list: PlanIdea[]) =>
    list.length > 0 ? (
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {label}: {titlesOf(list).join(', ')}
      </Text>
    ) : null;
  const slotLabel = (s: PlanSlot) => `${dayLabel(s.day)}, ${PART_LABELS[s.part].toLowerCase()}`;
  const timesLine = (label: string, list: PlanSlot[]) => {
    const future = list.filter((s) => s.day >= today);
    if (future.length === 0) return null;
    const shown = future.slice(0, 4).map(slotLabel).join('; ');
    return (
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {label}: {shown}
        {future.length > 4 ? `, and ${future.length - 4} more` : ''}
      </Text>
    );
  };

  // "Ask in the chat": a short message they finish in their own words.
  const askBox = (stems: string[], label: string) =>
    askSent ? (
      <Text className="text-caption text-stone-500 dark:text-stone-400">Sent. Keep talking it over in the chat.</Text>
    ) : askOpen ? (
      <StemMessageBox
        stems={stems}
        onSend={async (text) => {
          const ok = await sendChatMessage(connectionId, text);
          if (ok) setAskSent(true);
          return ok;
        }}
        onCancel={() => setAskOpen(false)}
      />
    ) : (
      <Chip label={label} selected={false} onPress={() => setAskOpen(true)} />
    );

  // ---- Your turn: ideas and times together, then one save ----
  if (picking) {
    // Their picks first, so the second person sees them straight away.
    const ordered = theySaved ? [...theirs, ...ideas.filter((i) => !i.picked_by_other)] : ideas;
    let intro: ReactNode;
    if (lookAgain && theySaved) {
      intro = (
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Anything of {name}&apos;s you&apos;d be open to? It doesn&apos;t have to be your favorite. Mark it, then send.
        </Text>
      );
    } else if (theySaved) {
      intro = (
        <Text className="text-body text-stone-700 dark:text-stone-300">
          {name} picked {theirs.length === 1 ? theirs[0].title : `${theirs.length} ideas`} and marked when they&apos;re
          free. Pick any ideas you&apos;d enjoy, theirs or others, and mark your times.
        </Text>
      );
    } else if (iSaved) {
      intro = <Text className="text-body text-stone-700 dark:text-stone-300">Change your picks or times, then send again.</Text>;
    } else {
      intro = (
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Pick any ideas you&apos;d enjoy and mark when you&apos;re free. Then send, and {name} does the same.
        </Text>
      );
    }
    const summary = draftChanged && !editing
      ? "You changed your picks but haven't sent them."
      : theySaved && !iSaved
        ? `${name} picked ${theirs.length === 1 ? theirs[0].title : `${theirs.length} ideas`}. Your turn.`
        : generating && !hasIdeas
          ? 'Finding a few ideas...'
          : 'Pick ideas and times, then send.';
    const askStems = theySaved
      ? [
          ...(theirs.length > 0 ? [`What made you pick "${theirs[0].title}"? `] : []),
          'None of these are quite me. How about ',
          'What do you usually like to do on weekends? ',
        ]
      : ["Is there anything you've been wanting to try? ", 'What do you usually like to do on weekends? '];
    return shell(
      <>
        {intro}
        {draftChanged && !editing && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            You changed your picks or times but haven&apos;t sent them yet. {name} still sees what you sent before.
          </Text>
        )}

        <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">1. What</Text>
        {generating && !hasIdeas ? (
          <View className="flex-row items-center gap-2 py-2">
            <ActivityIndicator color={MUTED_ICON_COLOR} />
            <Text className="text-caption text-stone-500 dark:text-stone-400">Finding a few ideas...</Text>
          </View>
        ) : (
          <View className="gap-2">
            {ordered.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} name={name} myId={myId} meetupCount={meetupCount} disabled={busy}
                onToggle={() => run(() => togglePick(idea.id))} />
            ))}
          </View>
        )}
        {refreshesLeft > 0 ? (
          <LinkButton
            label={generating && hasIdeas ? 'Finding new ideas...' : `Show new ideas (${refreshesLeft} left)`}
            disabled={generating || busy}
            onPress={() => newIdeas(board.id)}
          />
        ) : (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            That&apos;s all the new ideas for this plan. Add your own idea, or ask {name} in the chat.
          </Text>
        )}
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={ownIdea}
              onChangeText={setOwnIdea}
              placeholder="Add your own idea"
              placeholderTextColor={MUTED_ICON_COLOR}
              maxLength={80}
              className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
            <LinkButton
              label="Add"
              disabled={busy || ownIdea.trim().length < 2 || ownIdeaHomeBlocked}
              onPress={() =>
                run(async () => {
                  await addOwnIdea(board.id, ownIdea);
                  setOwnIdea('');
                })
              }
            />
          </View>
          {ownIdeaHomeBlocked && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Before your first meetup, pick a public place, so it feels comfortable for both of you.
            </Text>
          )}
        </View>
        {askBox(askStems, `Not sure? Ask ${name} in the chat`)}

        <Text className="mt-2 text-caption font-semibold text-stone-600 dark:text-stone-300">2. When are you free?</Text>
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Rough times over the next 2 weeks. You&apos;ll pick the exact time at the end.
        </Text>
        {otherUsualLabel.length > 0 && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            {name} is usually free: {otherUsualLabel}.
          </Text>
        )}
        {availability.length > 0 && (
          <LinkButton
            label="Use my usual times"
            onPress={() => {
              const next = new Set(myTimes);
              for (const s of usualTimes(availability, days)) next.add(slotKey(s));
              saveTimes(next);
            }}
          />
        )}
        <Text className="text-caption text-stone-400 dark:text-stone-500">
          {theySaved && otherTimes.size > 0
            ? `Filled: you're free. Orange outline: ${name} is free. Orange: you're both free.`
            : otherUsual.size > 0
              ? `Filled: you're free. Dotted: when ${name} is usually free.`
              : "Filled: you're free."}
        </Text>
        <View className="gap-1.5">
          {days.map((day) => (
            <View key={day} className="flex-row items-center gap-2">
              <Text className="w-24 text-caption text-stone-600 dark:text-stone-300">{dayLabel(day)}</Text>
              {PARTS.map((part) => {
                const k = slotKey({ day, part });
                const mine = myTimes.has(k);
                const theirsFree = theySaved && otherTimes.size > 0 ? otherTimes.has(k) : false;
                const usual = !(theySaved && otherTimes.size > 0) && otherUsual.has(k);
                const cls =
                  mine && theirsFree
                    ? 'border-accent-500 bg-accent-500'
                    : mine
                      ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                      : theirsFree
                        ? 'border-accent-500'
                        : usual
                          ? 'border-dashed border-accent-500/60'
                          : 'border-stone-300 dark:border-stone-700';
                const textCls =
                  mine && theirsFree
                    ? 'text-white'
                    : mine
                      ? 'text-stone-50 dark:text-stone-900'
                      : 'text-stone-600 dark:text-stone-300';
                return (
                  <Pressable
                    key={part}
                    accessibilityLabel={`${dayLabel(day)} ${PART_LABELS[part]}`}
                    accessibilityState={{ selected: mine }}
                    onPress={() => {
                      const next = new Set(myTimes);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      saveTimes(next);
                    }}
                    className={`flex-1 items-center rounded-lg border py-1.5 ${cls}`}>
                    <Text className={`text-caption ${textCls}`}>{PART_LABELS[part]}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View className="mt-2 gap-1">
          <View className="flex-row items-center gap-4">
            <PrimaryButton
              label={iSaved ? 'Send my changes' : `Save and send to ${name}`}
              disabled={busy || draft.length === 0}
              onPress={save}
            />
            {iSaved && (
              <LinkButton
                label="Cancel"
                muted
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    await saveChain.current;
                    await revertPicks(board.id);
                    setEditing(false);
                    setLookAgain(false);
                  })
                }
              />
            )}
          </View>
          <Text className="text-caption text-stone-400 dark:text-stone-500">
            {draft.length === 0
              ? 'Pick at least one idea to send.'
              : myTimes.size === 0
                ? `${draft.length} picked, no times yet. Adding a few times makes it easier to find one together.`
                : `${draft.length} picked, ${myTimes.size} times. ${name} sees them once you send.`}
          </Text>
        </View>

        <View className="flex-row flex-wrap gap-4">
          <LinkButton label="My limits" muted onPress={() => setEditingPrefs(true)} />
          {meetupCount >= 1 && <LinkButton label="Home ideas" muted onPress={() => setEditingHome(true)} />}
        </View>
      </>,
      summary
    );
  }

  // Sent, waiting for the other person.
  if (!theySaved) {
    const quietSinceSave = (Date.now() - new Date(board.my_saved_at!).getTime()) / 86400000;
    return shell(
      <>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          Sent. {name} will see your picks and times and add theirs. They can pick any of yours or suggest something
          else.
        </Text>
        {listLine('Your picks', savedMine)}
        {timesLine('Your times', board.my_saved_times)}
        {quietSinceSave >= QUIET_NUDGE_DAYS &&
          askBox(
            ['No rush, I saved a few ideas for us when you have a moment. ', 'Did any of the ideas sound good to you? '],
            `Send ${name} a short note`
          )}
        {editLink}
      </>,
      `Sent. Waiting for ${name}.`
    );
  }

  // An idea and a time in common: suggest the plan. The person who sent
  // second suggests it; the other one can step in.
  if (shared.length > 0 && sharedTimes.length > 0) {
    const idea = shared.find((i) => i.id === pickedIdea) ?? shared[0];
    const slot = sharedTimes.find((s) => slotKey(s) === pickedTime) ?? sharedTimes[0];
    const goToPlan = (note?: string) => {
      setSheetOpen(false);
      setNoteOpen(false);
      onGoToPlan({ date: slot.day, startTime: PART_START_TIME[slot.part], activity: idea.title, note });
    };
    return shell(
      <>
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
          {shared.length === 1 && sharedTimes.length === 1
            ? `You both picked ${idea.title}, and you're both free ${slotLabel(slot)}.`
            : shared.length === 1
              ? `You both picked ${idea.title}, and you have ${sharedTimes.length} times in common.`
              : `You both picked ${shared.length} ideas, and you have ${sharedTimes.length === 1 ? 'a time' : 'times'} in common.`}
        </Text>
        {shared.length > 1 && (
          <View className="gap-1">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Which idea?</Text>
            <View className="flex-row flex-wrap gap-2">
              {shared.map((i) => (
                <Chip key={i.id} label={i.title} selected={i.id === idea.id} onPress={() => setPickedIdea(i.id)} />
              ))}
            </View>
          </View>
        )}
        {sharedTimes.length > 1 && (
          <View className="gap-1">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Which time? You&apos;re both free:</Text>
            <View className="flex-row flex-wrap gap-2">
              {sharedTimes.slice(0, 8).map((s) => (
                <Chip key={slotKey(s)} label={slotLabel(s)} selected={slotKey(s) === slotKey(slot)} onPress={() => setPickedTime(slotKey(s))} />
              ))}
            </View>
          </View>
        )}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {secondSaver
            ? `You sent second, so you can suggest the plan. Next you pick the exact time and the place, and ${name} confirms.`
            : `${name} will likely suggest the plan. You can also do it: pick the exact time and the place, and ${name} confirms.`}
        </Text>
        {noteOpen ? (
          <StemMessageBox
            stems={[`Looking forward to "${idea.title}"! `, `"${idea.title}" sounds fun because `, 'I could also do ']}
            sendLabel="Next: time and place"
            onSend={async (text) => {
              goToPlan(text);
              return true;
            }}
            onCancel={() => setNoteOpen(false)}
          />
        ) : (
          <View className="gap-2">
            <PrimaryButton label="Suggest this plan" disabled={busy} onPress={() => goToPlan()} />
            <LinkButton label={`Add a note for ${name} (optional)`} muted onPress={() => setNoteOpen(true)} />
          </View>
        )}
        {listLine('Your other picks', savedMine.filter((i) => !i.picked_by_other))}
        {listLine(`${name}'s other picks`, theirs.filter((i) => !i.saved_by_me))}
        {editLink}
      </>,
      secondSaver ? `You matched: ${idea.title}. Suggest the plan.` : `You matched: ${idea.title}.`
    );
  }

  // An idea in common, but no time yet.
  if (shared.length > 0) {
    const myTurn = !secondSaver;
    return shell(
      <>
        <Text className="text-body text-stone-700 dark:text-stone-300">
          You both picked {titlesOf(shared).join(', ')}. No time in common yet.
        </Text>
        {timesLine(`${name} is free`, board.other_times)}
        {timesLine('You are free', board.my_saved_times)}
        {board.other_times.length === 0 && otherUsualLabel.length > 0 && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            {name} is usually free: {otherUsualLabel}.
          </Text>
        )}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {myTurn ? 'Add a few more times, or ask in the chat.' : `${name} will see your times. Meanwhile:`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip
            label="Mark more times"
            selected={false}
            onPress={() => {
              setEditing(true);
              setLookAgain(false);
            }}
          />
        </View>
        {askBox(['What days usually work for you? ', 'Would a weekend work for you? ', 'I could do '], 'Ask in the chat')}
      </>,
      myTurn ? 'Same idea, no time in common yet.' : `Same idea. ${name} will see your times.`
    );
  }

  // Both sent, no idea in common yet. Every way forward is offered equally.
  const myTurn = !secondSaver;
  const askStems = [
    'None of those are quite me. How about ',
    ...(theirs.length > 0 ? [`What draws you to "${theirs[0].title}"? `] : []),
  ];
  return shell(
    <>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        No match yet. That&apos;s common. Different tastes are part of getting to know someone.
      </Text>
      {listLine('Your picks', savedMine)}
      {listLine(`${name}'s picks`, theirs)}
      {board.no_match_rounds >= SIMPLE_AFTER_ROUNDS && (
        <View className="gap-2 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
          <Text className="text-caption text-stone-600 dark:text-stone-300">
            A coffee or a walk is a fine plan too. The bigger idea can come later.
          </Text>
          <LinkButton
            label="Add coffee and a walk to my picks"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const existing = ideas.find((i) => i.title.toLowerCase() === SIMPLE_IDEA.toLowerCase());
                if (existing) {
                  if (!existing.picked_by_me) await togglePick(existing.id);
                } else {
                  await addOwnIdea(board.id, SIMPLE_IDEA);
                }
                await saveChain.current;
                await savePicks(board.id);
              })
            }
          />
        </View>
      )}
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {myTurn ? `${name} picked different ideas. A few ways forward:` : `${name} will see your picks. Meanwhile:`}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label={`Look at ${name}'s picks again`}
          selected={false}
          onPress={() => {
            setEditing(true);
            setLookAgain(true);
          }}
        />
        <Chip
          label="Add your own or see new ideas"
          selected={false}
          onPress={() => {
            setEditing(true);
            setLookAgain(false);
          }}
        />
      </View>
      {askBox(askStems, 'Ask in the chat')}
    </>,
    myTurn ? `No match yet. Take a look at ${name}'s picks.` : `No match yet. ${name} will see your picks.`
  );
}

function IdeaRow({
  idea,
  name,
  myId,
  meetupCount,
  disabled,
  onToggle,
}: {
  idea: PlanIdea;
  name: string;
  myId: string;
  meetupCount: number;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tags = [
    idea.home_of ? (idea.home_of === myId ? 'At your place' : `At ${name}'s place`) : null,
    idea.cost_label,
    idea.duration_label,
    idea.style ? STYLE_LABELS[idea.style] : null,
    meetupCount === 0 && idea.first_meetup_ok ? 'Good for a first meetup' : null,
  ].filter(Boolean);
  const heading =
    idea.slot === 'own'
      ? `Added by ${idea.added_by === myId ? 'you' : name}`
      : idea.slot === 'both_like'
        ? // "You both like walking" or "David likes golf"; never claims a
          // shared interest that isn't there.
          idea.interest_note || 'An idea for you two'
        : [SLOT_LABELS[idea.slot], idea.interest_note].filter(Boolean).join(' · ');
  const marks =
    idea.picked_by_me && idea.picked_by_other
      ? 'You both picked this'
      : idea.picked_by_me
        ? "You'd like this"
        : idea.picked_by_other
          ? `${name} picked this`
          : null;
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: idea.picked_by_me }}
      className={`flex-row gap-3 rounded-xl border p-3 ${
        idea.picked_by_me ? 'border-accent-500 bg-accent-500/5' : 'border-stone-200 dark:border-stone-700'
      }`}>
      <View
        className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${
          idea.picked_by_me ? 'border-accent-500 bg-accent-500' : 'border-stone-300 dark:border-stone-600'
        }`}>
        {idea.picked_by_me && <Text className="text-caption font-semibold text-white">✓</Text>}
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-caption text-stone-400 dark:text-stone-500">{heading}</Text>
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{idea.title}</Text>
        {idea.description && <Text className="text-caption text-stone-600 dark:text-stone-300">{idea.description}</Text>}
        {tags.length > 0 && <Text className="text-caption text-stone-500 dark:text-stone-400">{tags.join(' · ')}</Text>}
        {marks && <Text className="text-caption font-semibold text-accent-500">{marks}</Text>}
      </View>
    </Pressable>
  );
}

function PrefsForm({
  initial,
  name,
  editing,
  onDone,
}: {
  initial: PlanState['my_prefs'];
  name: string;
  editing: boolean;
  onDone: (p: { budget: PlanBudget; duration: PlanDuration; travel: number } | null) => void;
}) {
  const [budget, setBudget] = useState<PlanBudget | null>(initial?.budget ?? null);
  const [duration, setDuration] = useState<PlanDuration | null>(initial?.duration ?? null);
  const [travel, setTravel] = useState<number | null>(initial?.travel_minutes ?? null);
  const ready = budget && duration && travel;
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-body text-stone-700 dark:text-stone-300">So ideas fit you (optional)</Text>
        <LinkButton label={editing ? 'Cancel' : 'Skip'} onPress={() => onDone(null)} />
      </View>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Ideas use whichever answer is lower for the two of you. {name} never sees your answers.
      </Text>
      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Spending per meetup</Text>
      <View className="flex-row flex-wrap gap-2">
        {BUDGET_OPTIONS.map((o) => (
          <Chip key={o.value} label={o.label} selected={budget === o.value} onPress={() => setBudget(o.value)} />
        ))}
      </View>
      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">How long</Text>
      <View className="flex-row flex-wrap gap-2">
        {DURATION_OPTIONS.map((o) => (
          <Chip key={o.value} label={o.label} selected={duration === o.value} onPress={() => setDuration(o.value)} />
        ))}
      </View>
      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Travel time, one way</Text>
      <View className="flex-row flex-wrap gap-2">
        {TRAVEL_OPTIONS.map((o) => (
          <Chip key={o.value} label={o.label} selected={travel === o.value} onPress={() => setTravel(o.value)} />
        ))}
      </View>
      <View className="mt-1 flex-row items-center gap-4">
        <PrimaryButton
          label={editing ? 'Save' : 'Show ideas'}
          disabled={!ready}
          onPress={() => ready && onDone({ budget: budget!, duration: duration!, travel: travel! })}
        />
        <Text className="flex-1 text-caption text-stone-400 dark:text-stone-500">Change these anytime in My limits.</Text>
      </View>
    </View>
  );
}

function HomeForm({
  name,
  initial,
  onDone,
}: {
  name: string;
  initial: PlanState['my_home'];
  onDone: (host: boolean | null, visit: boolean) => void;
}) {
  const [host, setHost] = useState(initial?.can_host ?? false);
  const [visit, setVisit] = useState(initial?.can_visit ?? false);
  return (
    <View className="gap-3">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Now that you&apos;ve met, would you like ideas at home with {name} sometimes?
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Only you see this answer. A home idea shows up only if one of you is happy to host and the other is happy
        to go. You can change this anytime.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="I'm happy to host" selected={host} onPress={() => setHost((v) => !v)} />
        <Chip label="I'm happy to go to theirs" selected={visit} onPress={() => setVisit((v) => !v)} />
      </View>
      <View className="flex-row items-center gap-4">
        <PrimaryButton label="Save" disabled={!host && !visit} onPress={() => onDone(host, visit)} />
        <LinkButton label="Not yet" muted onPress={() => onDone(false, false)} />
      </View>
    </View>
  );
}
