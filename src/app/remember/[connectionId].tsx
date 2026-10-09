import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { RememberEntryComposer } from '@/components/remember-entry-composer';
import {
  deleteAllEntriesForConnection,
  deleteRememberEntry,
  fetchTimelineEntries,
  formatMeetupDate,
  parseMeetupDate,
  RememberBlockedError,
  summarizeRememberTimeline,
  updateRememberEntry,
  type RememberEntry,
  type RememberPerson,
} from '@/lib/remember';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

function meetupLabel(n: number): string {
  if (n <= 0) return 'Before your first meetup';
  return `After meetup ${n}`;
}

// Prefers the user's own picked meetup_date (when they set one) over the
// save-time created_at, per the "Add an entry" date picker. created_at
// itself is untouched as the record of when the entry was actually
// written, this only changes what's shown, never what's stored for
// ordering (still meetup_number_at_entry then created_at).
//
// Item 2, 2026-08-15 fix: meetup_date is a plain date-only string
// ("2026-07-20", no time or timezone component). new Date(iso) on a
// string in exactly that shape is parsed by JS as UTC midnight (per the
// ECMAScript spec's date-only ISO handling), which toLocaleDateString
// then formats back out in the browser's own LOCAL timezone, rolling it
// back a full calendar day for anyone west of UTC (most of the US, this
// app's own stated primary market). Storage was always correct, only
// this display step was wrong. Fixed by parsing the y/m/d components
// directly and constructing the Date with the local-time constructor
// (new Date(year, month, day), never new Date(isoString)), the same
// construction parseMeetupDate/formatMeetupDate already use elsewhere
// in this feature, so there's no UTC round-trip for a date-only value
// at all. created_at is a real full timestamp (with its own timezone
// offset already embedded), so it's left on the original, already-
// correct new Date(iso) path, only meetup_date needed this fix.
function dateLabel(entry: RememberEntry): string {
  if (entry.meetup_date) {
    const [y, m, d] = entry.meetup_date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  }
  return new Date(entry.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// Friendship Timeline. Ordered by real, mutually-confirmed meetup number
// (connections.meetup_count at the time each entry was written, set
// server-side, see the migration), not raw date, per the milestone
// system this was rebuilt against, there is no reliably meaningful
// scheduled date anywhere in this app anymore. Both the user's own raw
// entry and the AI-organized version (when they chose to organize one)
// are shown together for each entry, never just one or the other.
export default function RememberTimelineScreen() {
  const { connectionId } = useLocalSearchParams<{ connectionId: string }>();
  const [loaded, setLoaded] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [person, setPerson] = useState<RememberPerson | null>(null);
  const [entries, setEntries] = useState<RememberEntry[]>([]);
  const [composerVisible, setComposerVisible] = useState(false);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // "Summarize for me": explicit, user-tapped, never ambient (same choice
  // pattern as "Organize with AI" on a single entry). Regenerated fresh
  // on every tap, nothing is cached, so this is plain local state, not
  // persisted anywhere, see the edge function's own header comment for
  // why fresh-every-tap was chosen over caching.
  const [timelineSummary, setTimelineSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // 2026-08-12: only true for a real free-tier cap/pool block, same bug
  // class fixed on remember-entry-composer.tsx alongside this, this
  // surface's bare `catch {}` used to swallow the real blocked message
  // entirely too.
  const [summaryShowUpgrade, setSummaryShowUpgrade] = useState(false);
  // Item 1, 2026-08-15: real edit for an already-saved entry. Direct
  // edit, not the create flow's raw-vs-Organize-with-AI choice, see the
  // reasoning in updateRememberEntry's own comment. All four fields
  // (raw text, organized text and follow-up when present, and the date)
  // are independently editable in place, one entry at a time.
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editRawText, setEditRawText] = useState('');
  const [editOrganizedText, setEditOrganizedText] = useState('');
  const [editFollowUpText, setEditFollowUpText] = useState('');
  const [editDateText, setEditDateText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !connectionId) {
      setLoaded(true);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoaded(true);
      return;
    }
    setMyId(user.id);

    const [{ data: personRow }, timelineEntries] = await Promise.all([
      supabase.from('remember_people').select('*').eq('connection_id', connectionId).maybeSingle(),
      fetchTimelineEntries(connectionId),
    ]);
    setPerson((personRow as RememberPerson) ?? null);
    setEntries(timelineEntries);
    setLoaded(true);
  }, [connectionId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleDeleteEntry = async (entryId: string) => {
    setPendingDelete(entryId);
    await deleteRememberEntry(entryId);
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    setPendingDelete(null);
    // An old summary could reference an entry that no longer exists, and
    // this feature is deliberately never cached, so clear it rather than
    // leave a stale result standing after the underlying entries changed.
    setTimelineSummary(null);
    setSummaryError(null);
  };

  const handleStartEdit = (entry: RememberEntry) => {
    setEditingEntryId(entry.id);
    setEditRawText(entry.raw_text);
    setEditOrganizedText(entry.organized_text ?? '');
    setEditFollowUpText(entry.follow_up_note ?? '');
    setEditDateText(entry.meetup_date ?? '');
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
    setEditError(null);
    setEditSaving(false);
  };

  const handleSaveEdit = async (entry: RememberEntry) => {
    if (!editRawText.trim()) {
      setEditError('Write something before saving.');
      return;
    }
    const parsedDate = parseMeetupDate(editDateText);
    if (parsedDate === undefined) {
      setEditError('Enter the date as YYYY-MM-DD, or leave it blank.');
      return;
    }
    if (parsedDate && parsedDate.getTime() > Date.now()) {
      setEditError("That date hasn't happened yet.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const meetupDate = parsedDate ? formatMeetupDate(parsedDate) : null;
      // organized_text/follow_up_note only sent (and only ever cleared)
      // when the entry actually has one, a raw-only entry stays raw-only,
      // editing never adds an AI-organized version that was never there.
      await updateRememberEntry({
        entryId: entry.id,
        rawText: editRawText.trim(),
        organizedText: entry.organized_text !== null ? editOrganizedText.trim() || null : undefined,
        followUpNote: entry.organized_text !== null ? editFollowUpText.trim() || null : undefined,
        meetupDate,
      });
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? {
                ...e,
                raw_text: editRawText.trim(),
                organized_text: entry.organized_text !== null ? editOrganizedText.trim() || null : e.organized_text,
                follow_up_note: entry.organized_text !== null ? editFollowUpText.trim() || null : e.follow_up_note,
                meetup_date: meetupDate,
              }
            : e
        )
      );
      setEditingEntryId(null);
      // Same reasoning as delete: an edit can change what a cached
      // summary describes, clear it rather than leave it stale.
      setTimelineSummary(null);
      setSummaryError(null);
    } catch {
      setEditError("Couldn't save that edit. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirmingDeleteAll) {
      setConfirmingDeleteAll(true);
      return;
    }
    if (!connectionId) return;
    await deleteAllEntriesForConnection(connectionId);
    setEntries([]);
    setConfirmingDeleteAll(false);
    setTimelineSummary(null);
    setSummaryError(null);
  };

  const handleSummarize = async () => {
    if (!connectionId || summarizing) return;
    setSummarizing(true);
    setSummaryError(null);
    setSummaryShowUpgrade(false);
    setTimelineSummary(null);
    try {
      const summary = await summarizeRememberTimeline(connectionId);
      setTimelineSummary(summary);
    } catch (err) {
      if (err instanceof RememberBlockedError) {
        setSummaryError(err.message);
        setSummaryShowUpgrade(err.tier === 'free');
      } else {
        setSummaryError("Couldn't summarize right now. Try again.");
      }
    } finally {
      setSummarizing(false);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const otherName = person?.display_name ?? 'this person';

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center gap-3 px-6 pt-6">
          <Pressable onPress={() => goBack('/remember')} hitSlop={10}>
            <Ionicons name="chevron-back" size={22} color={MUTED_ICON_COLOR} />
          </Pressable>
          {person?.photo_url ? (
            <Image source={{ uri: person.photo_url }} className="h-10 w-10 rounded-full" />
          ) : (
            <View className="h-10 w-10 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700">
              <Text className="text-body text-stone-500 dark:text-stone-400">{otherName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text className="text-title text-stone-900 dark:text-stone-50">{otherName}</Text>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-6">
          <View className="flex-row flex-wrap items-center gap-3">
            <Pressable
              onPress={() => setComposerVisible(true)}
              className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Add an entry</Text>
            </Pressable>

            {entries.length > 0 && (
              <Pressable
                onPress={handleSummarize}
                disabled={summarizing}
                className={`self-start rounded-full border border-accent-500/40 px-4 py-2 active:opacity-80 ${summarizing ? 'opacity-40' : ''}`}>
                <Text className="text-caption font-semibold text-accent-500">
                  {summarizing ? 'Summarizing...' : 'Summarize for me'}
                </Text>
              </Pressable>
            )}
          </View>

          {summaryError && (
            <View className="gap-2">
              <Text className="text-caption text-red-600 dark:text-red-400">{summaryError}</Text>
              {summaryShowUpgrade && (
                <CoachMark
                  markKey="credits_premium"
                  text="Free plans include a daily/weekly cap on AI help. Once you hit it, you can buy a small pack of extra credits, or upgrade to Premium for a much larger monthly allowance."
                  actionLabel="See Premium"
                  onAction={() => router.push('/premium')}
                />
              )}
              {summaryShowUpgrade && (
                <Pressable onPress={() => router.push('/premium')} className="self-start">
                  <Text className="text-caption font-semibold text-accent-500">Upgrade to Premium</Text>
                </Pressable>
              )}
            </View>
          )}

          {timelineSummary && (
            <View className="gap-2 rounded-3xl border border-accent-500/40 bg-accent-500/5 p-5">
              <View className="flex-row items-center gap-2">
                <Ionicons name="sparkles" size={14} color="#B5643B" />
                <Text className="text-caption font-semibold text-accent-500">AI summary</Text>
              </View>
              <Text className="text-body text-stone-800 dark:text-stone-200">{timelineSummary}</Text>
            </View>
          )}

          {entries.length === 0 && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Nothing written yet. Add a note after you spend time together, this is private and just for you.
              </Text>
            </View>
          )}

          {entries.map((entry) =>
            editingEntryId === entry.id ? (
              <View
                key={entry.id}
                className="gap-3 rounded-3xl border border-accent-500/40 bg-white p-5 dark:bg-stone-800">
                <Text className="text-caption font-semibold text-accent-500">{meetupLabel(entry.meetup_number_at_entry)}</Text>

                {editError && <Text className="text-caption text-red-600 dark:text-red-400">{editError}</Text>}

                <View className="gap-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">What you wrote</Text>
                  <TextInput
                    value={editRawText}
                    onChangeText={setEditRawText}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    editable={!editSaving}
                    className="min-h-24 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>

                {entry.organized_text !== null && (
                  <View className="gap-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Organized</Text>
                    <TextInput
                      value={editOrganizedText}
                      onChangeText={setEditOrganizedText}
                      multiline
                      numberOfLines={3}
                      textAlignVertical="top"
                      editable={!editSaving}
                      className="min-h-20 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                  </View>
                )}

                {entry.organized_text !== null && (
                  <View className="gap-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">For next time</Text>
                    <TextInput
                      value={editFollowUpText}
                      onChangeText={setEditFollowUpText}
                      placeholder="Nothing to follow up on"
                      placeholderTextColor={MUTED_ICON_COLOR}
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                      editable={!editSaving}
                      className="min-h-14 rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                    />
                  </View>
                )}

                <View className="gap-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">When did this happen? (optional)</Text>
                  <TextInput
                    value={editDateText}
                    onChangeText={setEditDateText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={MUTED_ICON_COLOR}
                    autoCapitalize="none"
                    editable={!editSaving}
                    className="rounded-xl border border-stone-300 px-3 py-3 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                </View>

                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => handleSaveEdit(entry)}
                    disabled={editSaving}
                    className={`rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${editSaving ? 'opacity-40' : ''}`}>
                    <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                      {editSaving ? 'Saving...' : 'Save changes'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={handleCancelEdit} disabled={editSaving}>
                    <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View
                key={entry.id}
                className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                <View className="flex-row items-center justify-between">
                  <Text className="text-caption font-semibold text-accent-500">{meetupLabel(entry.meetup_number_at_entry)}</Text>
                  <Text className="text-caption text-stone-400 dark:text-stone-600">{dateLabel(entry)}</Text>
                </View>

                <View className="gap-1">
                  <Text className="text-caption text-stone-400 dark:text-stone-600">What you wrote</Text>
                  <Text className="text-body text-stone-700 dark:text-stone-300">{entry.raw_text}</Text>
                </View>

                {entry.organized_text && (
                  <View className="gap-1 pt-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">Organized</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{entry.organized_text}</Text>
                  </View>
                )}

                {entry.follow_up_note && (
                  <View className="gap-1 pt-1">
                    <Text className="text-caption text-stone-400 dark:text-stone-600">For next time</Text>
                    <Text className="text-body text-stone-800 dark:text-stone-200">{entry.follow_up_note}</Text>
                  </View>
                )}

                <View className="mt-1 flex-row items-center gap-4">
                  <Pressable onPress={() => handleStartEdit(entry)}>
                    <Text className="text-caption font-semibold text-accent-500">Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteEntry(entry.id)} disabled={pendingDelete === entry.id}>
                    <Text className="text-caption text-stone-400 dark:text-stone-600">
                      {pendingDelete === entry.id ? 'Deleting...' : 'Delete this entry'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )
          )}

          {entries.length > 0 && (
            <View className="flex-row items-center gap-4 pt-2">
              <Pressable onPress={handleDeleteAll}>
                <Text className={`text-caption font-semibold ${confirmingDeleteAll ? 'text-red-600 dark:text-red-400' : 'text-stone-400 dark:text-stone-600'}`}>
                  {confirmingDeleteAll ? 'Tap again to delete all history' : 'Delete all history with this person'}
                </Text>
              </Pressable>
              {confirmingDeleteAll && (
                <Pressable onPress={() => setConfirmingDeleteAll(false)}>
                  <Text className="text-caption text-stone-400 dark:text-stone-600">Cancel</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {myId && connectionId && (
        <RememberEntryComposer
          visible={composerVisible}
          connectionId={connectionId}
          userId={myId}
          otherName={otherName}
          onClose={() => setComposerVisible(false)}
          onSaved={() => {
            setComposerVisible(false);
            setTimelineSummary(null);
            setSummaryError(null);
            load();
          }}
        />
      )}
    </View>
  );
}
