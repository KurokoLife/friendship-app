import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { DateField, FieldLabel, TimeField } from '@/components/date-time-field';
import { StemMessageBox, sendChatMessage } from '@/components/stem-message-box';
import { getSeenCoachMarks, markCoachMarkSeen } from '@/lib/coach-marks';
import {
  addMeetupDetails,
  cancelMeetup,
  confirmMeetup,
  getMeetupPlan,
  proposeMeetup,
  respondToMeetupPrompt,
  type MeetupPlan,
} from '@/lib/friendship-journey';
import {
  downloadIcs,
  formatMeetupTime,
  formatWhen,
  isValidIsoDate,
  openGoogleCalendar,
  parseTimeInput,
  toIsoDate,
  type CalendarPlan,
} from '@/lib/meetup-format';
import { supabase } from '@/lib/supabase';
import { nameThenPeriod } from '@/lib/names';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type Props = {
  connectionId: string;
  myId: string;
  otherName: string;
  onChanged: () => void;
  // At most one Limen video guidance offer may be visible at once; this
  // card reports when its own first-meetup video offer is showing.
  onVideoOfferChange?: (active: boolean) => void;
  // Bumped by the thread when a prompt card changed the plan (for example
  // cancelling from the morning-of card), so this card reloads.
  refreshKey?: number;
  // Set by the thread when a prompt card asks to move the plan ("Need to
  // move it") or add missing details; opens that editor here. `n` changes
  // on every request so the same mode can be asked for twice.
  editorRequest?: { mode: 'change' | 'details'; n: number } | null;
  onEndConnection?: () => void;
};

type EditMode = 'new' | 'change' | 'details';
type Panel = 'none' | 'calendar' | 'cancel' | 'late' | 'leave_open';

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const CANCEL_STEMS = [
  "Sorry, I need to cancel our plan, ",
  "Something came up and I can't make it, ",
  "I'm not able to make it after all, ",
];
const LATE_STEMS = ['Running about 10 minutes late, ', 'On my way, ', 'Just got here, '];
const LEAVE_OPEN_STEMS = ["Let's leave the date open for now, ", "Plans keep shifting on my end, "];

// The meetup plan card (rebuilt 2026-10-08). One card per chat, always
// visible above the conversation: plan a meetup, confirm it, change it any
// number of times, add it to a calendar, or cancel it with a short message.
// Every change of an agreed plan goes back to the other person for one tap.
export function NextMeetupIndicatorV2({
  connectionId,
  myId,
  otherName,
  onChanged,
  onVideoOfferChange,
  refreshKey,
  editorRequest,
  onEndConnection,
}: Props) {
  const [plan, setPlan] = useState<MeetupPlan | null>(null);
  const [meetupCount, setMeetupCount] = useState(0);
  const [localToday, setLocalToday] = useState<string>(toIsoDate(new Date()));
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const [placeText, setPlaceText] = useState('');
  const [activityText, setActivityText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFirstMeetupOffer, setShowFirstMeetupOffer] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getMeetupPlan(connectionId);
      setPlan(result.meetup);
      setMeetupCount(result.meetupCount);
      if (result.localToday) setLocalToday(result.localToday);

      if (result.meetup?.status === 'confirmed') {
        const seen = await getSeenCoachMarks();
        if (!seen.has('video_first_meetup')) {
          const { count } = await supabase
            .from('meetups')
            .select('id', { count: 'exact', head: true })
            .eq('connection_id', connectionId)
            .eq('status', 'occurred');
          setShowFirstMeetupOffer((count ?? 0) === 0);
        } else {
          setShowFirstMeetupOffer(false);
        }
      } else {
        setShowFirstMeetupOffer(false);
      }
    } catch {
      setPlan(null);
    } finally {
      setLoaded(true);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Live updates (2026-10-08): when the other person proposes, confirms,
  // changes or cancels, this card (and the prompt card under it) update
  // without reloading the page. Also reloads when the person comes back to
  // the tab or app.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => {
    const channel = supabase
      .channel(`meetups-${connectionId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meetups', filter: `connection_id=eq.${connectionId}` },
        () => {
          load();
          onChangedRef.current();
        }
      )
      .subscribe();
    const onAppState = (state: string) => {
      if (state === 'active') {
        load();
        onChangedRef.current();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      supabase.removeChannel(channel);
      sub.remove();
    };
  }, [connectionId, load]);

  const firstMeetupOfferVisible = showFirstMeetupOffer && !editMode && plan?.status === 'confirmed' && plan.date !== localToday;
  useEffect(() => {
    onVideoOfferChange?.(firstMeetupOfferVisible);
  }, [firstMeetupOfferVisible, onVideoOfferChange]);

  const openEditor = useCallback(
    (mode: EditMode) => {
      setError(null);
      setPanel('none');
      if (mode === 'new') {
        setDateText('');
        setTimeText('');
        setPlaceText('');
        setActivityText('');
      } else if (plan) {
        setDateText(plan.date);
        setTimeText(plan.start_time ?? '');
        setPlaceText(plan.place ?? '');
        setActivityText(plan.activity ?? '');
        if (mode === 'details') {
          setTimeText('');
          setPlaceText('');
          setActivityText('');
        }
      }
      setEditMode(mode);
    },
    [plan]
  );

  // "Need to move it" / "Add details" from a prompt card opens the editor.
  useEffect(() => {
    if (!editorRequest) return;
    if (!plan) openEditor('new');
    else openEditor(editorRequest.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRequest?.n]);

  const afterChange = async () => {
    setEditMode(null);
    setPanel('none');
    await load();
    onChanged();
  };

  const readTime = (): { ok: boolean; value: string | null } => {
    if (!timeText.trim()) return { ok: true, value: null };
    const parsed = /^\d{2}:\d{2}$/.test(timeText) ? timeText : parseTimeInput(timeText);
    return parsed ? { ok: true, value: parsed } : { ok: false, value: null };
  };

  const handleSave = async () => {
    setError(null);
    const time = readTime();
    if (!time.ok) {
      setError('Pick a time, or leave it empty.');
      return;
    }
    if (editMode === 'details') {
      if (!plan) return;
      if (!time.value && !placeText.trim() && !activityText.trim()) {
        setError('Add at least one detail.');
        return;
      }
      setBusy(true);
      try {
        await addMeetupDetails(plan.id, { startTime: time.value, place: placeText, activity: activityText });
        await afterChange();
      } catch {
        setError("Couldn't save that. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!isValidIsoDate(dateText)) {
      setError('Pick a date.');
      return;
    }
    if (dateText < localToday) {
      setError('Pick today or a later date.');
      return;
    }
    if (
      editMode === 'change' &&
      plan &&
      dateText === plan.date &&
      (time.value ?? null) === (plan.start_time ?? null) &&
      (placeText.trim() || null) === (plan.place ?? null) &&
      (activityText.trim() || null) === (plan.activity ?? null)
    ) {
      setError('Nothing has changed yet.');
      return;
    }
    setBusy(true);
    try {
      await proposeMeetup(connectionId, {
        date: dateText,
        startTime: time.value,
        place: placeText,
        activity: activityText,
      });
      await afterChange();
    } catch {
      setError("Couldn't save the plan. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<void>, failMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await afterChange();
    } catch {
      setError(failMessage);
    } finally {
      setBusy(false);
    }
  };

  const calendarPlan = (p: MeetupPlan): CalendarPlan => ({
    planId: p.plan_root_id,
    version: p.move_count,
    date: p.date,
    startTime: p.start_time,
    timeZone: p.time_zone,
    place: p.place,
    activity: p.activity,
    otherName,
  });

  const historyLink =
    meetupCount > 0 ? (
      <Pressable
        onPress={() => router.push({ pathname: '/meetup-history/[connectionId]', params: { connectionId } })}
        className="self-start">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
          Met {meetupCount} {meetupCount === 1 ? 'time' : 'times'} · See history
        </Text>
      </Pressable>
    ) : null;

  if (!loaded) return null;

  // ---- Editor ----
  if (editMode) {
    const title =
      editMode === 'new'
        ? `Plan your ${ordinal(meetupCount + 1)} meetup`
        : editMode === 'change'
          ? 'Change the plan'
          : 'Add the missing details';
    return (
      <View className="mx-6 mt-4 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{title}</Text>
        {editMode === 'change' && plan?.status === 'confirmed' && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            {otherName} will need to confirm the new plan. Until then, the current plan is on hold.
          </Text>
        )}
        {editMode !== 'details' && (
          <View className="gap-1">
            <FieldLabel label="Date" />
            <DateField value={dateText} onChange={setDateText} min={localToday} disabled={busy} />
          </View>
        )}
        {(editMode !== 'details' || !plan?.start_time) && (
          <View className="gap-1">
            <FieldLabel label="Time" optional={editMode !== 'details'} />
            <TimeField value={timeText} onChange={setTimeText} disabled={busy} />
          </View>
        )}
        {(editMode !== 'details' || !plan?.place) && (
          <View className="gap-1">
            <FieldLabel label="Place" optional={editMode !== 'details'} />
            <TextInput
              value={placeText}
              onChangeText={setPlaceText}
              placeholder="e.g. Blue Bottle on 3rd St"
              placeholderTextColor={MUTED_ICON_COLOR}
              maxLength={120}
              editable={!busy}
              className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
          </View>
        )}
        {(editMode !== 'details' || !plan?.activity) && (
          <View className="gap-1">
            <FieldLabel label="What you'll do" optional />
            <TextInput
              value={activityText}
              onChangeText={setActivityText}
              placeholder="e.g. Coffee, then a walk"
              placeholderTextColor={MUTED_ICON_COLOR}
              maxLength={120}
              editable={!busy}
              className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
            />
          </View>
        )}
        {editMode === 'new' && (
          <Text className="text-caption text-stone-400 dark:text-stone-500">
            Add a time and place so it&apos;s easy to show up.
          </Text>
        )}
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={handleSave}
            disabled={busy}
            className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
              {busy ? 'Saving...' : editMode === 'details' ? 'Save' : `Send to ${otherName}`}
            </Text>
          </Pressable>
          <Pressable onPress={() => setEditMode(null)} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- No plan ----
  if (!plan) {
    return (
      <View className="mx-6 mt-4 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-caption text-stone-400 dark:text-stone-500">No meetup planned yet</Text>
          <Pressable onPress={() => openEditor('new')}>
            <Text className="text-caption font-semibold text-accent-500">Plan a meetup</Text>
          </Pressable>
        </View>
        {historyLink}
      </View>
    );
  }

  const iAmProposer = plan.proposed_by === myId;
  const isToday = plan.date === localToday;
  const missingDetails = !plan.start_time || !plan.place;

  const details = (
    <View className="gap-0.5">
      <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
        {formatWhen(plan.date, plan.start_time)}
      </Text>
      {plan.place && <Text className="text-body text-stone-700 dark:text-stone-300">{plan.place}</Text>}
      {plan.activity && <Text className="text-caption text-stone-500 dark:text-stone-400">{plan.activity}</Text>}
      {plan.move_count > 0 && (
        <Text className="text-caption text-stone-400 dark:text-stone-500">
          Moved {plan.move_count === 1 ? 'once' : plan.move_count === 2 ? 'twice' : `${plan.move_count} times`}
        </Text>
      )}
    </View>
  );

  // Private note after the plan has moved 3 times, once per plan.
  const manyMovesNote =
    plan.move_count >= 3 && !plan.many_moves_answered ? (
      <View className="gap-2 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
        <Text className="text-caption text-stone-600 dark:text-stone-300">
          Plans shift, that&apos;s normal. Still want to meet, or would a looser plan help? Only you see this.
        </Text>
        <View className="flex-row flex-wrap gap-3">
          <Pressable
            onPress={() =>
              runAction(() => respondToMeetupPrompt(plan.plan_root_id, 'many_moves', 'keep'), 'Please try again.')
            }>
            <Text className="text-caption font-semibold text-accent-500">Still want to meet</Text>
          </Pressable>
          <Pressable onPress={() => setPanel('leave_open')}>
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
              Leave the date open for now
            </Text>
          </Pressable>
          {onEndConnection && (
            <Pressable
              onPress={async () => {
                await respondToMeetupPrompt(plan.plan_root_id, 'many_moves', 'end').catch(() => undefined);
                onEndConnection();
              }}>
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">End kindly</Text>
            </Pressable>
          )}
        </View>
      </View>
    ) : null;

  const messagePanel =
    panel === 'cancel' || panel === 'leave_open' ? (
      <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
        <Text className="text-caption text-stone-600 dark:text-stone-300">
          {panel === 'cancel'
            ? `Let ${otherName} know with a short message. The plan is cancelled when you send it.`
            : `A short message to ${nameThenPeriod(otherName)} The date is taken off when you send it, and you can plan again anytime.`}
        </Text>
        <StemMessageBox
          stems={panel === 'cancel' ? CANCEL_STEMS : LEAVE_OPEN_STEMS}
          sendLabel={panel === 'cancel' ? 'Send and cancel' : 'Send'}
          onCancel={() => setPanel('none')}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (!ok) return false;
            try {
              if (panel === 'leave_open') {
                await respondToMeetupPrompt(plan.plan_root_id, 'many_moves', 'leave_open').catch(() => undefined);
              }
              await cancelMeetup(plan.id);
              await afterChange();
              return true;
            } catch {
              return false;
            }
          }}
        />
      </View>
    ) : panel === 'late' ? (
      <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
        <StemMessageBox
          stems={LATE_STEMS}
          onCancel={() => setPanel('none')}
          onSend={async (text) => {
            const ok = await sendChatMessage(connectionId, text);
            if (ok) setPanel('none');
            return ok;
          }}
        />
      </View>
    ) : panel === 'calendar' ? (
      <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            onPress={() => openGoogleCalendar(calendarPlan(plan))}
            className="rounded-full border border-stone-300 px-3 py-1.5 dark:border-stone-700">
            <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">Google Calendar</Text>
          </Pressable>
          {Platform.OS === 'web' && (
            <Pressable
              onPress={() => downloadIcs(calendarPlan(plan))}
              className="rounded-full border border-stone-300 px-3 py-1.5 dark:border-stone-700">
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">Apple or Outlook</Text>
            </Pressable>
          )}
        </View>
        <Text className="text-caption text-stone-400 dark:text-stone-500">
          If the plan moves, add it again. Apple and Outlook update the same event. In Google, delete the old one.
        </Text>
      </View>
    ) : null;

  // ---- Waiting for a confirm ----
  if (plan.status === 'proposed') {
    const prev = plan.previous;
    return (
      <View className="mx-6 mt-4 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
          {prev
            ? 'Plan being moved'
            : iAmProposer
              ? `Your plan for your ${ordinal(meetupCount + 1)} meetup`
              : `${otherName} suggested a meetup`}
        </Text>
        {details}
        {prev && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Was {formatWhen(prev.date, prev.start_time)}
            {prev.place ? ` at ${prev.place}` : ''}. Reminders are paused until you both agree.
          </Text>
        )}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          {iAmProposer ? `Waiting for ${otherName} to confirm.` : `Does this work for you?`}
        </Text>
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        {manyMovesNote}
        <View className="flex-row flex-wrap items-center gap-4">
          {!iAmProposer && (
            <Pressable
              onPress={() => runAction(() => confirmMeetup(plan.id), "Couldn't confirm right now. Please try again.")}
              disabled={busy}
              className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                {busy ? 'Confirming...' : 'Confirm'}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => openEditor('change')} disabled={busy}>
            <Text className="text-caption font-semibold text-accent-500">
              {iAmProposer ? 'Edit' : 'Suggest a change'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => runAction(() => cancelMeetup(plan.id), "Couldn't do that right now. Please try again.")}
            disabled={busy}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
              {iAmProposer ? 'Withdraw' : 'Not this time'}
            </Text>
          </Pressable>
        </View>
        {messagePanel}
        {historyLink}
      </View>
    );
  }

  // ---- Confirmed ----
  return (
    <View className="mx-6 mt-4 gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
      <Text className="text-caption font-semibold text-accent-500">
        {isToday ? 'Meeting today' : 'Next meetup'}
      </Text>
      {details}
      {plan.other_still_on && (
        <Text className="text-caption text-stone-600 dark:text-stone-300">✓ {otherName} said it&apos;s still on</Text>
      )}
      {missingDetails && (
        <Pressable onPress={() => openEditor('details')} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">
            {!plan.start_time && !plan.place ? 'Add a time and place' : !plan.start_time ? 'Add a time' : 'Add a place'}
          </Text>
        </Pressable>
      )}
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
      {manyMovesNote}
      <View className="flex-row flex-wrap items-center gap-4">
        <Pressable onPress={() => openEditor('change')} disabled={busy}>
          <Text className="text-caption font-semibold text-accent-500">Change plan</Text>
        </Pressable>
        <Pressable onPress={() => setPanel(panel === 'calendar' ? 'none' : 'calendar')} disabled={busy}>
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Add to calendar</Text>
        </Pressable>
        {isToday && (
          <Pressable onPress={() => setPanel(panel === 'late' ? 'none' : 'late')} disabled={busy}>
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Running late?</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setPanel(panel === 'cancel' ? 'none' : 'cancel')} disabled={busy}>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel plan</Text>
        </Pressable>
      </View>
      {messagePanel}
      {/* On the day itself the morning-of card offers the same guide. */}
      {showFirstMeetupOffer && !isToday && (
        <View className="flex-row flex-wrap items-center gap-3 border-t border-accent-500/20 pt-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            First meetup coming up? A short guide if it helps.
          </Text>
          <Pressable
            onPress={() => {
              markCoachMarkSeen('video_first_meetup');
              setShowFirstMeetupOffer(false);
              router.push({ pathname: '/guide/[id]', params: { id: 'guide_meetup_anxiety' } });
            }}>
            <Text className="text-caption font-semibold text-accent-500">Watch</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              markCoachMarkSeen('video_first_meetup');
              setShowFirstMeetupOffer(false);
            }}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
          </Pressable>
        </View>
      )}
      {historyLink}
    </View>
  );
}

