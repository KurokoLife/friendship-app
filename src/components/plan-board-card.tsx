import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { LogMeetupForm } from '@/components/log-meetup-form';
import { RememberAsksLine } from '@/components/remember-bar';
import {
  BUDGET_OPTIONS,
  DURATION_OPTIONS,
  PART_LABELS,
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
  sendPlanInvite,
  setHomePref,
  setPlanPrefs,
  setTimes,
  slotKey,
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
import { loadDraft, saveDraft } from '@/lib/held-card';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const QUIET_NUDGE_DAYS = 3;
const HOME_WORDS = /\b(home|house|apartment|my place|your place|backyard)\b/i;
const NOTE_MAX = 600;

// "Let's plan something" (2026-10-10): one person's private draft that
// ends in ONE invite sent into the chat.
//   1. Pick any ideas you'd enjoy and mark when you're free. The card shows
//      when the other person is usually free. Your own usual times start
//      filled in.
//   2. Add a note in your own words if you like (starters you finish
//      yourself; the app never writes it), then send the invite.
//   3. The invite shows in the chat. The other person replies there, or
//      taps "Pick a time that works" on it (see plan-invite.tsx).
// The AI only suggests the starting ideas. The card ends when the invite
// is sent, "Not now", or 14 quiet days.

type Props = {
  connectionId: string;
  myId: string;
  otherName: string;
  refreshKey?: number;
  // Bumped when this person taps "Let's plan something": opens the card.
  openRequest?: number;
  onStart: () => void;
  onSent?: () => void;
  // A meetup made outside the app was added from this window.
  onMeetupAdded?: () => void;
  // Your own "next time, ask..." notes, shown while picking (2026-10-10).
  notesOn?: boolean;
};

const NOTE_STEMS = [
  'Would any of these work for you? ',
  "I'd really like to ",
  'No pressure at all, ',
  "Is there anything you've been wanting to try? ",
  'What do you usually like to do on weekends? ',
];

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
      className={`max-w-full rounded-2xl border px-3 py-1.5 ${
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

export function PlanBoardCard({ connectionId, myId, otherName, refreshKey, openRequest, onStart, onSent, onMeetupAdded, notesOn = true }: Props) {
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
  const [myTimes, setMyTimes] = useState<Set<string>>(new Set());
  const [availability, setAvailability] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteStem, setNoteStem] = useState<string | null>(null);
  // True once this person tapped "Let's plan something" here. The card is
  // their own draft: someone who never opened it doesn't see it.
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

  useEffect(() => {
    const channel = supabase.channel(`plan-${connectionId}-${Math.random().toString(36).slice(2)}`);
    for (const table of ['plan_boards', 'plan_ideas']) {
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
  const ideas = board?.ideas ?? [];
  const mine =
    !!board &&
    (board.started_by === myId || askFlow || ideas.some((i) => i.picked_by_me) || (board.my_times ?? []).length > 0);
  const meetupCount = state?.meetup_count ?? 0;
  const needsPrefs = open && mine && (editingPrefs || (askFlow && !state?.my_prefs && !prefsSkipped));
  const needsHome =
    open && mine && !needsPrefs && (editingHome || (askFlow && meetupCount >= 1 && !state?.my_home && !homeSkipped));
  const hasIdeas = ideas.some((i) => i.source !== 'own');

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
    if (!board || !open || !mine || hasIdeas || needsPrefs || needsHome || generating) return;
    if (generatedFor.current === board.id) return;
    generatedFor.current = board.id;
    newIdeas(board.id);
  }, [board, open, mine, hasIdeas, needsPrefs, needsHome, generating, newIdeas]);

  // An unsent note survives a refresh (same 3-day draft store as notes).
  const noteLoadedFor = useRef<string | null>(null);
  const boardId = state?.board?.status === 'open' ? state.board.id : null;
  useEffect(() => {
    if (!boardId || noteLoadedFor.current === boardId) return;
    noteLoadedFor.current = boardId;
    loadDraft(`plan-note:${boardId}`).then((saved) => {
      if (saved) setNote((current) => current || saved);
    });
  }, [boardId]);

  // Your usual times from the profile start filled in. You can change them.
  useEffect(() => {
    if (!board || !open || !askFlow || availability.length === 0) return;
    if (autofilledFor.current === board.id) return;
    autofilledFor.current = board.id;
    if (board.my_times.length > 0) return;
    const slots = usualTimes(availability);
    if (slots.length === 0) return;
    setMyTimes(new Set(slots.map(slotKey)));
    saveChain.current = saveChain.current.then(() => setTimes(board.id, slots)).catch(() => undefined);
  }, [board, open, askFlow, availability]);

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
      else if (/no_times/.test(message)) setError('Mark at least one time when you are free.');
      else if (/note_too_long/.test(message)) setError('That note is a bit long. Keep it short.');
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
  // 2026-10-22 (founder): nothing about an unsent invite ever shows in the
  // chat. A cancelled or quietly closed draft simply goes away.
  if (!open) return null;

  // Someone else's draft: private to them.
  if (!mine) return null;

  const quietDays = (Date.now() - new Date(board.last_activity_at).getTime()) / 86400000;
  const nudge =
    quietDays >= QUIET_NUDGE_DAYS ? (
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Not sent yet. This draft closes quietly on {shortDate(board.closes_at)} if nothing changes.
      </Text>
    ) : null;
  // 2026-10-22 (founder): the invite lives only in this window. Nothing shows
  // in the chat while it's unsent. "Save for later" (or tapping outside)
  // keeps the draft, and "Let's plan something" opens it again where it was
  // left. "Cancel" throws the draft away.
  const shell = (children: ReactNode, _summary: string) => (
    <>
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <View className="flex-1 justify-end bg-black/30">
          <Pressable className="flex-1" onPress={() => setSheetOpen(false)} accessibilityLabel="Save for later" />
          <View className="max-h-[88%] gap-3 rounded-t-3xl border-t border-stone-200 bg-stone-50 px-6 pb-8 pt-5 dark:border-stone-800 dark:bg-stone-900">
            <View className="h-1 w-10 self-center rounded-full bg-stone-300 dark:bg-stone-700" />
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-title text-stone-900 dark:text-stone-50">Plan something</Text>
              <View className="flex-row gap-4">
                <LinkButton
                  label="Cancel"
                  muted
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      await closePlanBoard(board.id);
                      setSheetOpen(false);
                      setNote('');
                      setNoteStem(null);
                      saveDraft(`plan-note:${board.id}`, null);
                    })
                  }
                />
                <LinkButton label="Save for later" onPress={() => setSheetOpen(false)} />
              </View>
            </View>
            <ScrollView contentContainerClassName="gap-3 pb-4" keyboardShouldPersistTaps="handled">
              {/* 2026-10-23: adding a meetup made outside the app lives here
                  now (it used to be in the plan bar). */}
              {logOpen ? (
                <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                  <LogMeetupForm
                    connectionId={connectionId}
                    otherName={otherName}
                    onCancel={() => setLogOpen(false)}
                    onDone={() => {
                      setLogOpen(false);
                      setSheetOpen(false);
                      onMeetupAdded?.();
                    }}
                  />
                </View>
              ) : (
                <Pressable onPress={() => setLogOpen(true)} className="self-start" hitSlop={6}>
                  <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                    Met up already? Add it
                  </Text>
                </Pressable>
              )}
              <RememberAsksLine connectionId={connectionId} otherName={otherName} notesOn={notesOn} withIdeas />
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

  const days = nextTwoWeeks();
  const today = isoDay(new Date());
  const draft = ideas.filter((i) => i.picked_by_me);
  const otherUsualLabel = usualLabel(state.other_usual);
  const otherUsual = new Set(usualTimes(state.other_usual, days).map(slotKey));
  const refreshesLeft = limitReached ? 0 : board.refreshes_left;
  const ownIdeaHomeBlocked = meetupCount === 0 && HOME_WORDS.test(ownIdea);
  const chosenTimes: PlanSlot[] = [...myTimes]
    .map((k) => {
      const [day, part] = k.split('|');
      return { day, part: part as PlanPart };
    })
    .filter((s) => s.day >= today)
    .sort((a, b) => a.day.localeCompare(b.day) || PARTS.indexOf(a.part) - PARTS.indexOf(b.part));
  const slotLabel = (s: PlanSlot) => `${dayLabel(s.day)}, ${PART_LABELS[s.part].toLowerCase()}`;
  const ready = draft.length > 0 && chosenTimes.length > 0;
  const summary =
    draft.length > 0 || chosenTimes.length > 0
      ? `Your invite: ${draft.length} ${draft.length === 1 ? 'idea' : 'ideas'}, ${chosenTimes.length} ${
          chosenTimes.length === 1 ? 'time' : 'times'
        }. Not sent yet.`
      : generating && !hasIdeas
        ? 'Finding a few ideas...'
        : 'Pick ideas and times, then send an invite.';

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

  // One screen, top to bottom (2026-10-13): what, when, an optional note
  // in your own words, then one Send. Questions for the other person (like
  // "anything you've been wanting to try?") are starters for this same
  // note, so there's only one place to write and one button that sends.
  const trimmed = note.trim();
  const stemOnly = !!noteStem && (trimmed === noteStem.trim() || trimmed.length <= noteStem.trim().length + 1);
  const send = () =>
    run(async () => {
      await saveChain.current;
      await sendPlanInvite(board.id, trimmed || null);
      setSheetOpen(false);
      setNote('');
      setNoteStem(null);
      saveDraft(`plan-note:${board.id}`, null);
      setAskFlow(false);
      onSent?.();
    }, "That didn't send. Please try again.");
  const changeNote = (value: string) => {
    setNote(value);
    saveDraft(`plan-note:${board.id}`, value || null);
  };

  return shell(
    <>
      <Text className="text-body text-stone-700 dark:text-stone-300">
        Pick any ideas you&apos;d enjoy, mark when you&apos;re free, and add a note if you like. Then send {name} one
        invite.
      </Text>
      {/* 2026-10-18: only before the first meetup. People expect a "no" more
          than they get one. */}
      {(state?.meetup_count ?? 0) === 0 && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Most people are glad to be asked, even when they can&apos;t make it that time.
        </Text>
      )}

      <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">1. What would you enjoy?</Text>
      {generating && !hasIdeas ? (
        <View className="flex-row items-center gap-2 py-2">
          <ActivityIndicator color={MUTED_ICON_COLOR} />
          <Text className="text-caption text-stone-500 dark:text-stone-400">Finding a few ideas...</Text>
        </View>
      ) : (
        <View className="gap-2">
          {ideas.map((idea) => (
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
          That&apos;s all the new ideas for now. Add your own idea, or ask {name} in your note.
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

      <Text className="mt-2 text-caption font-semibold text-stone-600 dark:text-stone-300">2. When are you free?</Text>
      <View className="gap-1 rounded-xl border border-accent-500/50 bg-accent-500/10 p-3">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
          {otherUsualLabel.length > 0 ? `${name} is usually free: ${otherUsualLabel}` : `${name} hasn't said when they're usually free`}
        </Text>
        <Text className="text-caption text-stone-600 dark:text-stone-300">
          {otherUsualLabel.length > 0
            ? `Those times have an orange outline below. Pick as many times as work for you.`
            : `Pick as many times as work for you. ${name} can say what suits them in the chat.`}
        </Text>
      </View>
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
        {otherUsual.size > 0
          ? `Filled: you're free. Orange outline: ${name} is usually free. Orange: both.`
          : "Filled: you're free."}
      </Text>
      <View className="gap-1.5">
        {days.map((day) => (
          <View key={day} className="flex-row items-center gap-2">
            <Text className="w-24 text-caption text-stone-600 dark:text-stone-300">{dayLabel(day)}</Text>
            {PARTS.map((part) => {
              const k = slotKey({ day, part });
              const chosen = myTimes.has(k);
              const usual = otherUsual.has(k);
              const cls =
                chosen && usual
                  ? 'border-accent-500 bg-accent-500'
                  : chosen
                    ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                    : usual
                      ? 'border-2 border-accent-500'
                      : 'border-stone-300 dark:border-stone-700';
              const textCls =
                chosen && usual ? 'text-white' : chosen ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300';
              return (
                <Pressable
                  key={part}
                  accessibilityLabel={`${dayLabel(day)} ${PART_LABELS[part]}`}
                  accessibilityState={{ selected: chosen }}
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

      <Text className="mt-2 text-caption font-semibold text-stone-600 dark:text-stone-300">
        3. Add a note (optional)
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Not sure what {name} would enjoy? Ask in your note. Tap a starter and finish it in your own words.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {NOTE_STEMS.map((s) => (
          <Chip
            key={s}
            label={`${s.trim()}...`}
            selected={noteStem === s}
            onPress={() => {
              setNoteStem(s);
              changeNote(s);
            }}
          />
        ))}
      </View>
      <TextInput
        value={note}
        onChangeText={changeNote}
        placeholder="Write it in your own words"
        placeholderTextColor={MUTED_ICON_COLOR}
        multiline
        maxLength={NOTE_MAX}
        accessibilityLabel="Note to send with your invite"
        className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
      />
      {stemOnly && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Finish it in your own words, or clear it to send without a note.
        </Text>
      )}

      <View className="mt-2 gap-1">
        <PrimaryButton
          label={busy ? 'Sending...' : `Send invite to ${name}`}
          disabled={busy || !ready || stemOnly}
          onPress={send}
        />
        <Text className="text-caption text-stone-400 dark:text-stone-500">
          {draft.length === 0
            ? 'Pick at least one idea.'
            : chosenTimes.length === 0
              ? 'Mark at least one time when you are free.'
              : `${draft.length} ${draft.length === 1 ? 'idea' : 'ideas'}, ${chosenTimes.length} ${
                  chosenTimes.length === 1 ? 'time' : 'times'
                }${trimmed && !stemOnly ? ' and your note' : ''}. Only you see this until you send it. ${name} can reply in the chat, or pick a time that works.`}
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
  const marks = idea.picked_by_me ? 'In your invite' : null;
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
