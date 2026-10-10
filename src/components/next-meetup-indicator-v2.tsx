import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { DateField, FieldLabel, TimeField } from '@/components/date-time-field';
import { LogMeetupForm } from '@/components/log-meetup-form';
import { FirstMeetupHomeNote, SafetyTipsLink, looksLikeHome } from '@/components/safety-tips';
import { EMPTY_PLACE, PlaceField, type PlaceValue } from '@/components/place-field';
import { StemMessageBox, sendChatMessage } from '@/components/stem-message-box';
import { getSeenCoachMarks, markCoachMarkSeen } from '@/lib/coach-marks';
import {
  acceptPlanInvite,
  addMeetupDetails,
  cancelMeetup,
  confirmMeetup,
  getMeetupPlan,
  getPaceSummary,
  PACE_LABELS,
  proposeMeetup,
  respondToMeetupPrompt,
  submitRhythmPreference,
  updateMeetupActivity,
  type MeetupPlan,
  type PaceKey,
} from '@/lib/friendship-journey';
import {
  downloadIcs,
  formatWhen,
  isValidIsoDate,
  mapLinks,
  openGoogleCalendar,
  openUrl,
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
  // prefill (2026-10-09): the planning card hands over the idea and day
  // it settled on, so a new plan starts filled in.
  editorRequest?: {
    mode: 'change' | 'details' | 'new';
    n: number;
    prefill?: EditorPrefill;
  } | null;
  onEndConnection?: () => void;
  // Reminder settings (2026-10-10): the calendar question and the short
  // guide offer can be turned off.
  calendarAskOn?: boolean;
  guidesOn?: boolean;
  // Tells the thread whether a plan exists (to hide "Let's plan something").
  onPlanState?: (hasPlan: boolean) => void;
};

type EditMode = 'new' | 'change' | 'details';
type Panel = 'none' | 'calendar' | 'cancel' | 'late' | 'leave_open' | 'log';

// inviteId (2026-10-10): the other person picked a time from an invite in
// the chat; saving sets the plan from that invite.
export type EditorPrefill = { date?: string; startTime?: string; activity?: string; note?: string; inviteId?: string };

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
  calendarAskOn = true,
  guidesOn = true,
  onPlanState,
}: Props) {
  const [plan, setPlan] = useState<MeetupPlan | null>(null);
  const [meetupCount, setMeetupCount] = useState(0);
  const [localToday, setLocalToday] = useState<string>(toIsoDate(new Date()));
  const [loaded, setLoaded] = useState(false);
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const [place, setPlace] = useState<PlaceValue>(EMPTY_PLACE);
  const [activityText, setActivityText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFirstMeetupOffer, setShowFirstMeetupOffer] = useState(false);
  // A note the person wrote in the planning card. It goes to the other
  // person together with the plan, once the plan is sent.
  const [noteToSend, setNoteToSend] = useState<string | null>(null);
  const [inviteId, setInviteId] = useState<string | null>(null);
  // Calendar asks already answered for this plan (by details key).
  const [calendarAsked, setCalendarAsked] = useState<Set<string> | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  // 2026-10-10: a slim bar by default, so the conversation stays in view on
  // a phone. Tap it to see the whole plan.
  const [expanded, setExpanded] = useState(false);

  const onPlanStateRef = useRef(onPlanState);
  onPlanStateRef.current = onPlanState;

  const load = useCallback(async () => {
    try {
      const result = await getMeetupPlan(connectionId);
      setPlan(result.meetup);
      onPlanStateRef.current?.(Boolean(result.meetup));
      setMeetupCount(result.meetupCount);
      if (result.localToday) setLocalToday(result.localToday);

      if (result.meetup?.status === 'confirmed') {
        const { data: asks, error: asksError } = await supabase
          .from('meetup_calendar_asks')
          .select('details_key')
          .eq('meetup_id', result.meetup.id)
          .eq('user_id', myId);
        setCalendarAsked(asksError ? null : new Set(((asks ?? []) as { details_key: string }[]).map((a) => a.details_key)));
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
  }, [connectionId, myId]);

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

  const firstMeetupOfferVisible =
    guidesOn && expanded && showFirstMeetupOffer && !editMode && plan?.status === 'confirmed' && plan.date !== localToday;
  useEffect(() => {
    onVideoOfferChange?.(firstMeetupOfferVisible);
  }, [firstMeetupOfferVisible, onVideoOfferChange]);

  const openEditor = useCallback(
    (mode: EditMode, prefill?: EditorPrefill) => {
      setError(null);
      setPanel('none');
      setSavedNotice(null);
      setNoteToSend(mode === 'new' ? prefill?.note?.trim() || null : null);
      setInviteId(mode === 'new' ? prefill?.inviteId ?? null : null);
      if (mode === 'new') {
        setDateText(prefill?.date ?? '');
        setTimeText(prefill?.startTime ?? '');
        setPlace(EMPTY_PLACE);
        setActivityText((prefill?.activity ?? '').slice(0, 120));
      } else if (plan) {
        setDateText(plan.date);
        setTimeText(plan.start_time ?? '');
        setPlace({
          name: plan.place ?? '',
          address: plan.place_address ?? null,
          lat: plan.place_lat ?? null,
          lng: plan.place_lng ?? null,
        });
        setActivityText(plan.activity ?? '');
        if (mode === 'details') {
          setTimeText('');
          setPlace(EMPTY_PLACE);
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
    if (!plan || editorRequest.mode === 'new') openEditor('new', editorRequest.prefill);
    else openEditor(editorRequest.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRequest?.n]);

  const afterChange = async () => {
    setEditMode(null);
    setPanel('none');
    setExpanded(true);
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
      if (!time.value && !place.name.trim() && !activityText.trim()) {
        setError('Add at least one detail.');
        return;
      }
      setBusy(true);
      try {
        await addMeetupDetails(plan.id, {
          startTime: time.value,
          place: place.name,
          activity: activityText,
          placeAddress: place.address,
          placeLat: place.lat,
          placeLng: place.lng,
        });
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
    const sameWhenWhere =
      editMode === 'change' &&
      plan &&
      dateText === plan.date &&
      (time.value ?? null) === (plan.start_time ?? null) &&
      (place.name.trim() || null) === (plan.place ?? null) &&
      (place.address ?? null) === (plan.place_address ?? null);
    if (sameWhenWhere && (activityText.trim() || null) === (plan.activity ?? null)) {
      setError('Nothing has changed yet.');
      return;
    }
    setBusy(true);
    try {
      if (editMode === 'new' && inviteId) {
        const result = await acceptPlanInvite(inviteId, {
          date: dateText,
          startTime: time.value,
          place: place.name,
          activity: activityText,
          placeAddress: place.address,
          placeLat: place.lat,
          placeLng: place.lng,
        });
        setInviteId(null);
        if (result.status === 'proposed') setSavedNotice(`Sent to ${otherName} to confirm, since it's a different time from the invite.`);
        await afterChange();
        return;
      }
      // Only "what you'll do" changed: update it in place. Date, time and
      // place are the same, so there's nothing to confirm again (2026-10-09).
      if (sameWhenWhere && plan) {
        await updateMeetupActivity(plan.id, activityText);
        await afterChange();
        return;
      }
      await proposeMeetup(connectionId, {
        date: dateText,
        startTime: time.value,
        place: place.name,
        activity: activityText,
        placeAddress: place.address,
        placeLat: place.lat,
        placeLng: place.lng,
      });
      if (noteToSend && editMode === 'new') {
        await sendChatMessage(connectionId, noteToSend);
        setNoteToSend(null);
      }
      await afterChange();
    } catch (e) {
      const message = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
      if (/invite_closed/.test(message)) setError('That invite was already answered or replaced. Plan a meetup instead.');
      else setError("Couldn't save the plan. Please try again.");
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
    placeAddress: p.place_address ?? null,
    activity: p.activity,
    otherName,
  });

  const paceLine = <PaceLine connectionId={connectionId} meetupCount={meetupCount} refreshKey={refreshKey} />;
  const firstMeetup = meetupCount === 0;
  const hideLink = (
    <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Hide</Text>
    </Pressable>
  );
  const bar = (summary: string, attention: string | null, action: ReactNode, tone: 'plain' | 'accent' = 'plain') => (
    <Pressable
      onPress={() => setExpanded(true)}
      accessibilityRole="button"
      accessibilityLabel={`${summary}. Show the plan`}
      className={`mx-6 mt-3 flex-row items-center gap-3 rounded-2xl border px-4 py-2.5 ${
        tone === 'accent' ? 'border-accent-500/40 bg-accent-500/5' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800'
      }`}>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-caption text-stone-700 dark:text-stone-300">
          {summary}
        </Text>
        {attention && (
          <Text numberOfLines={1} className="text-caption font-semibold text-accent-500">
            {attention}
          </Text>
        )}
      </View>
      {action}
    </Pressable>
  );

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
      editMode === 'new' && inviteId
        ? `Set the plan from ${otherName}'s invite`
        : editMode === 'new'
        ? `Plan your ${ordinal(meetupCount + 1)} meetup`
        : editMode === 'change'
          ? 'Change the plan'
          : 'Add the missing details';
    return (
      <View className="mx-6 mt-3 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{title}</Text>
        {editMode === 'new' && noteToSend && (
          <View className="gap-1 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
            <Text className="text-caption text-stone-500 dark:text-stone-400">Your note, sent with the plan:</Text>
            <Text className="text-body text-stone-700 dark:text-stone-300">{noteToSend}</Text>
            <Pressable onPress={() => setNoteToSend(null)} className="self-start">
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Remove note</Text>
            </Pressable>
          </View>
        )}
        {editMode === 'new' && inviteId && (
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Keep the day and part of the day {otherName} offered, and the plan is set right away. A different time goes
            to {otherName} to confirm.
          </Text>
        )}
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
            <PlaceField value={place} onChange={setPlace} disabled={busy} />
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
        {firstMeetup && (looksLikeHome(place.name) || looksLikeHome(activityText)) && <FirstMeetupHomeNote />}
        {firstMeetup && editMode !== 'details' && <SafetyTipsLink />}
        {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={handleSave}
            disabled={busy}
            className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${busy ? 'opacity-40' : ''}`}>
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
              {busy ? 'Saving...' : editMode === 'details' ? 'Save' : inviteId ? 'Set the plan' : `Send to ${otherName}`}
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
    if (!expanded && panel === 'none' && !savedNotice) {
      return bar(
        meetupCount > 0 ? `No meetup planned yet · Met ${meetupCount} ${meetupCount === 1 ? 'time' : 'times'}` : 'No meetup planned yet',
        null,
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => openEditor('new')} hitSlop={6}>
            <Text className="text-caption font-semibold text-accent-500">Plan a meetup</Text>
          </Pressable>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">More</Text>
        </View>
      );
    }
    return (
      <View className="mx-6 mt-3 gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="text-caption text-stone-400 dark:text-stone-500">No meetup planned yet</Text>
          <View className="flex-row items-center gap-4">
            <Pressable onPress={() => openEditor('new')}>
              <Text className="text-caption font-semibold text-accent-500">Plan a meetup</Text>
            </Pressable>
            {hideLink}
          </View>
        </View>
        {savedNotice && <Text className="text-caption text-stone-600 dark:text-stone-300">{savedNotice}</Text>}
        {panel === 'log' ? (
          <View className="border-t border-stone-200 pt-3 dark:border-stone-700">
            <LogMeetupForm
              connectionId={connectionId}
              otherName={otherName}
              onCancel={() => setPanel('none')}
              onDone={async () => {
                setPanel('none');
                setSavedNotice(`Added. ${otherName} will be asked to confirm.`);
                await load();
                onChanged();
              }}
            />
          </View>
        ) : (
          <Pressable onPress={() => setPanel('log')} className="self-start">
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Met up already? Add it</Text>
          </Pressable>
        )}
        {paceLine}
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
      {plan.place_address && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">{plan.place_address}</Text>
      )}
      {plan.place && (
        <View className="flex-row gap-3 pt-0.5">
          <Pressable
            onPress={() => openUrl(mapLinks(plan.place!, plan.place_address, plan.place_lat, plan.place_lng).google)}>
            <Text className="text-caption font-semibold text-accent-500">Google Maps</Text>
          </Pressable>
          <Pressable
            onPress={() => openUrl(mapLinks(plan.place!, plan.place_address, plan.place_lat, plan.place_lng).apple)}>
            <Text className="text-caption font-semibold text-accent-500">Apple Maps</Text>
          </Pressable>
        </View>
      )}
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
    if (!expanded && panel === 'none') {
      return bar(
        `${prev ? 'Plan being moved' : iAmProposer ? 'Your plan' : `${otherName} suggested`}: ${formatWhen(plan.date, plan.start_time)}${
          plan.place ? ` · ${plan.place}` : ''
        }`,
        iAmProposer ? `Waiting for ${otherName} to confirm` : 'Does it work for you? Tap to answer',
        <Text className="text-caption font-semibold text-accent-500">Open</Text>
      );
    }
    return (
      <View className="mx-6 mt-3 gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-caption font-semibold text-stone-500 dark:text-stone-400">
            {prev
              ? 'Plan being moved'
              : iAmProposer
                ? `Your plan for your ${ordinal(meetupCount + 1)} meetup`
                : `${otherName} suggested a meetup`}
          </Text>
          {hideLink}
        </View>
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
        {savedNotice && iAmProposer && (
          <Text className="text-caption text-stone-600 dark:text-stone-300">{savedNotice}</Text>
        )}
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
        {firstMeetup && <SafetyTipsLink label="Safety tips for meeting someone new" />}
        {paceLine}
        {historyLink}
      </View>
    );
  }

  // ---- Confirmed ----
  // Asked once per agreed plan whether to add it to a calendar, and again
  // whenever the date, time, place or activity changes (2026-10-10).
  const detailsKey = `${plan.date}|${plan.start_time ?? ''}|${plan.place ?? ''}|${plan.activity ?? ''}`;
  const askCalendar = calendarAskOn && calendarAsked !== null && !calendarAsked.has(detailsKey);
  const recordCalendar = async (answer: 'added' | 'not_now') => {
    setCalendarAsked((prev) => new Set([...(prev ?? []), detailsKey]));
    await supabase
      .from('meetup_calendar_asks')
      .upsert({ meetup_id: plan.id, user_id: myId, details_key: detailsKey, answer }, { ignoreDuplicates: true });
  };
  const calendarAsk = askCalendar ? (
    <View className="gap-2 rounded-xl border border-accent-500/40 bg-white p-3 dark:bg-stone-800">
      <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
        {plan.move_count > 0 || (calendarAsked?.size ?? 0) > 0
          ? 'The plan changed. Update your calendar?'
          : "You're both set. Add it to your calendar?"}
      </Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        {[plan.activity ? `${plan.activity} with ${otherName}` : `Meet ${otherName}`, formatWhen(plan.date, plan.start_time), plan.place]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          onPress={() => {
            openGoogleCalendar(calendarPlan(plan));
            recordCalendar('added');
          }}
          className="rounded-full border border-stone-300 px-3 py-1.5 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">Google Calendar</Text>
        </Pressable>
        {Platform.OS === 'web' && (
          <Pressable
            onPress={() => {
              downloadIcs(calendarPlan(plan));
              recordCalendar('added');
            }}
            className="rounded-full border border-stone-300 px-3 py-1.5 dark:border-stone-700">
            <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">Apple or Outlook</Text>
          </Pressable>
        )}
        <Pressable onPress={() => recordCalendar('not_now')} className="px-1 py-1.5">
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  if (!expanded && panel === 'none') {
    return bar(
      `${isToday ? 'Meeting today' : 'Next meetup'}: ${formatWhen(plan.date, plan.start_time)}${plan.place ? ` · ${plan.place}` : ''}`,
      askCalendar
        ? plan.move_count > 0 || (calendarAsked?.size ?? 0) > 0
          ? 'The plan changed. Update your calendar?'
          : 'Add it to your calendar?'
        : plan.other_still_on
          ? `✓ ${otherName} said it's still on`
          : null,
      <Text className="text-caption font-semibold text-accent-500">Open</Text>,
      'accent'
    );
  }

  return (
    <View className="mx-6 mt-3 gap-3 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-caption font-semibold text-accent-500">{isToday ? 'Meeting today' : 'Next meetup'}</Text>
        {hideLink}
      </View>
      {details}
      {calendarAsk}
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
      {firstMeetup && <SafetyTipsLink label="Safety tips for meeting someone new" />}
      {/* On the day itself the morning-of card offers the same guide. */}
      {guidesOn && showFirstMeetupOffer && !isToday && (
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
      {paceLine}
      {historyLink}
    </View>
  );
}

// Meeting pace in the chat (2026-10-09). Each person picks privately how
// often they'd like to meet. You always see your own answer; when you both
// picked the same pace, you both see that you agree. A different answer is
// never shown to the other person.
const PACE_ORDER: PaceKey[] = ['weekly', 'few_weeks', 'monthly', 'occasional', 'not_sure'];

function PaceLine({
  connectionId,
  meetupCount,
  refreshKey,
  hideAsk,
}: {
  connectionId: string;
  meetupCount: number;
  refreshKey?: number;
  hideAsk?: boolean;
}) {
  const [pace, setPace] = useState<{ mine: PaceKey | null; bothSame: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPace(await getPaceSummary(connectionId));
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!pace) return null;
  // Asked once you've met; before that, only shown if already answered.
  if (!pace.mine && (meetupCount < 1 || hideAsk)) return null;

  if (picking) {
    return (
      <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
        <Text className="text-caption text-stone-600 dark:text-stone-300">
          How often would you like to get together? Only you see your answer. If you both pick the same pace, you&apos;ll
          both see that you agree.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {PACE_ORDER.map((k) => (
            <Pressable
              key={k}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await submitRhythmPreference(connectionId, k);
                  await load();
                  setPicking(false);
                } finally {
                  setBusy(false);
                }
              }}
              className={`rounded-full border px-3 py-1.5 ${
                pace.mine === k ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-700'
              }`}>
              <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">{PACE_LABELS[k]}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => setPicking(false)} className="self-start">
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
      <Text className="text-caption text-stone-600 dark:text-stone-300">
        {!pace.mine
          ? 'How often would you like to meet?'
          : pace.bothSame
            ? `You both said: ${PACE_LABELS[pace.mine].toLowerCase()}`
            : `Your pace: ${pace.mine === 'not_sure' ? 'not sure yet' : PACE_LABELS[pace.mine].toLowerCase()} (only you see this)`}
      </Text>
      <Pressable onPress={() => setPicking(true)}>
        <Text className="text-caption font-semibold text-accent-500">{pace.mine ? 'Change' : 'Set your pace'}</Text>
      </Pressable>
    </View>
  );
}

