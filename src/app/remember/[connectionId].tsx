import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RememberFreeNoteEditor } from '@/components/remember-free-note-editor';
import { RememberNoteEditor } from '@/components/remember-note-editor';
import { goBack } from '@/lib/navigation';
import { deleteCuriosityNote, fetchCuriosityNotes, updateCuriosityNote, type CuriosityNote } from '@/lib/stories';
import {
  deleteAllNotes,
  deleteNote,
  fetchMeetupsThatHappened,
  fetchNotes,
  fieldsFromNote,
  FILTER_FROM_NOTES,
  formatDay,
  isFreeNote,
  noteText,
  saveFreeNote,
  splitTitle,
  TOPICS,
  topicLabel,
  type TopicKey,
  markMeetupAsked,
  noteDay,
  openAsksFrom,
  ordinal,
  saveNote,
  setAsked,
  type NoteFields,
  type RememberMeetup,
  type RememberNote,
} from '@/lib/remember';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const CLOSED_STATUSES = ['ended', 'inactive', 'graduated', 'blocked'];

function firstName(name: string) {
  return name.split(' ')[0] || name;
}

// Editing target: a meetup's note, a note between meetups, or a new one.
type Editing = { kind: 'meetup'; meetup: RememberMeetup } | { kind: 'free'; note: RememberNote | null } | null;

// "What I want to remember about X" (2026-10-10, docs/DECISIONS.md
// section 9). Reached from the bar at the top of the chat, including chats
// that ended or graduated. Organized by meetup, newest first. Private,
// own words only, no AI.
export default function RememberNotesScreen() {
  const { connectionId, askMeetup } = useLocalSearchParams<{ connectionId: string; askMeetup?: string }>();
  const [loaded, setLoaded] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [name, setName] = useState('them');
  const [closed, setClosed] = useState(false);
  const [meetups, setMeetups] = useState<RememberMeetup[]>([]);
  const [notes, setNotes] = useState<RememberNote[]>([]);
  const [editing, setEditingState] = useState<Editing>(null);
  // Which note was open is kept on this device, so a refresh reopens it with
  // its unsaved text (2026-10-10).
  const openKey = `limen.noteOpen.${connectionId}`;
  const setEditing = (e: Editing) => {
    setEditingState(e);
    const v = !e ? null : e.kind === 'meetup' ? `meetup:${e.meetup.id}` : `free:${e.note?.id ?? 'new'}`;
    (v ? AsyncStorage.setItem(openKey, v) : AsyncStorage.removeItem(openKey)).catch(() => undefined);
  };
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askHandled, setAskHandled] = useState(false);
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState<TopicKey | null>(null);
  // 2026-10-23 (founder): two tabs, like Inbox. Meetups: one card per meetup.
  // Notes: everything else, including notes written on their profile
  // ("Note it privately"), the same notes, editable here.
  const [tab, setTab] = useState<'meetups' | 'notes' | null>(null);
  const [profileNotes, setProfileNotes] = useState<CuriosityNote[]>([]);
  const [editingProfileNote, setEditingProfileNote] = useState<{ id: string; text: string } | null>(null);

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
    const [{ data: person }, { data: conn }, ms, ns] = await Promise.all([
      supabase.from('connection_participant_profiles').select('display_name').eq('connection_id', connectionId).maybeSingle(),
      supabase.from('connections').select('status, user_a_id, user_b_id').eq('id', connectionId).maybeSingle(),
      fetchMeetupsThatHappened(connectionId),
      fetchNotes(connectionId),
    ]);
    setName((person as { display_name: string | null } | null)?.display_name ?? 'them');
    setClosed(CLOSED_STATUSES.includes((conn as { status: string | null } | null)?.status ?? ''));
    setMeetups(ms);
    setNotes(ns);
    const c = conn as { user_a_id: string; user_b_id: string } | null;
    const otherId = c ? (c.user_a_id === user.id ? c.user_b_id : c.user_a_id) : null;
    setProfileNotes(otherId ? await fetchCuriosityNotes(otherId) : []);
    setTab((t) => t ?? (ms.length > 0 ? 'meetups' : 'notes'));
    setLoaded(true);

    // Opened from "Anything you'd like to remember?": go straight to that
    // meetup. It counts as asked once the person saves or cancels, not just
    // by opening, so a refresh doesn't lose the question (2026-10-10).
    if (askMeetup && !askHandled) {
      setAskHandled(true);
      const m = ms.find((x) => x.id === askMeetup);
      if (m && !ns.some((n) => n.meetup_id === m.id)) {
        setEditing({ kind: 'meetup', meetup: m });
        setTab('meetups');
        return;
      }
    }
    if (!askHandled) {
      setAskHandled(true);
      const open = await AsyncStorage.getItem(openKey).catch(() => null);
      if (open) {
        const [kind, id] = open.split(':');
        const m = kind === 'meetup' ? ms.find((x) => x.id === id) : undefined;
        const n = kind === 'free' && id !== 'new' ? ns.find((x) => x.id === id) : undefined;
        if (m) {
          setEditingState({ kind: 'meetup', meetup: m });
          setTab('meetups');
        } else if (kind === 'free' && id === 'new') {
          setEditingState({ kind: 'free', note: null });
          setTab('notes');
        } else if (n) {
          setEditingState({ kind: 'free', note: n });
          setTab('notes');
        }
      }
    }
  }, [connectionId, askMeetup, askHandled]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  const first = firstName(name);
  const meetupIds = new Set(meetups.map((m) => m.id));
  const noteForMeetup = (id: string) => notes.find((n) => n.meetup_id === id) ?? null;
  // Notes between meetups: group g holds notes written after meetup g
  // (0 = before the first meetup).
  const freeNotes = notes.filter((n) => !n.meetup_id || !meetupIds.has(n.meetup_id));
  const asks = openAsksFrom(notes);
  const doneAsks = notes.filter((n) => n.ask_next && n.ask_next_done_at);

  const cancelEditing = () => {
    if (editing?.kind === 'meetup' && myId) markMeetupAsked(editing.meetup.id, myId);
    setEditing(null);
  };

  const save = (target: Exclude<Editing, null>) => async (fields: NoteFields) => {
    if (!myId || !connectionId) return 'Please try again.';
    try {
      const existing = target.kind === 'meetup' ? noteForMeetup(target.meetup.id) : target.note;
      await saveNote({
        connectionId,
        userId: myId,
        meetupId: target.kind === 'meetup' ? target.meetup.id : null,
        noteId: existing?.id ?? null,
        fields,
      });
      setEditing(null);
      await load();
      return null;
    } catch {
      return "Couldn't save that. Please try again.";
    }
  };

  const saveFree = (note: RememberNote | null) => async (text: string, topics: TopicKey[]) => {
    if (!myId || !connectionId) return 'Please try again.';
    try {
      await saveFreeNote({ connectionId, userId: myId, noteId: note?.id ?? null, text, topics });
      setEditing(null);
      await load();
      return null;
    } catch {
      return "Couldn't save that. Please try again.";
    }
  };

  const remove = async (noteId: string) => {
    if (confirmDelete !== noteId) {
      setConfirmDelete(noteId);
      return;
    }
    setConfirmDelete(null);
    try {
      await deleteNote(noteId);
      await load();
    } catch {
      setError("Couldn't delete that. Please try again.");
    }
  };

  const removeAll = async () => {
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true);
      return;
    }
    setConfirmDeleteAll(false);
    if (!connectionId) return;
    try {
      await deleteAllNotes(connectionId);
      await Promise.all(profileNotes.map((n) => deleteCuriosityNote(n.id)));
      await load();
    } catch {
      setError("Couldn't delete your notes. Please try again.");
    }
  };

  const toggleAsked = async (noteId: string, asked: boolean) => {
    try {
      await setAsked(noteId, asked);
      await load();
    } catch {
      setError("Couldn't update that. Please try again.");
    }
  };

  const answers = (n: RememberNote) => {
    const rows: [string, string | null][] = [
      [`What I learned about ${first}`, n.learned],
      ['What I enjoyed', n.smiled],
      [`Next time, I'd love to ask ${first}`, n.ask_next],
      [n.learned || n.smiled || n.ask_next ? 'Anything else' : '', n.raw_text || null],
      ['Summary', n.organized_text],
    ];
    return rows
      .filter(([, v]) => v && v.trim())
      .map(([label, v]) => (
        <View key={label} className="gap-0.5">
          {label ? <Text className="text-caption text-stone-400 dark:text-stone-500">{label}</Text> : null}
          <Text className="text-body text-stone-800 dark:text-stone-200">{v}</Text>
        </View>
      ));
  };

  const noteActions = (n: RememberNote, onEdit: () => void) => (
    <View className="mt-1 flex-row items-center gap-4">
      <Pressable onPress={onEdit}>
        <Text className="text-caption font-semibold text-accent-500">Edit</Text>
      </Pressable>
      <Pressable onPress={() => remove(n.id)}>
        <Text
          className={`text-caption ${
            confirmDelete === n.id ? 'font-semibold text-red-600 dark:text-red-400' : 'text-stone-400 dark:text-stone-500'
          }`}>
          {confirmDelete === n.id ? 'Tap again to delete' : 'Delete'}
        </Text>
      </Pressable>
    </View>
  );

  const topicChips = (n: RememberNote) =>
    n.topics && n.topics.length > 0 ? (
      <View className="flex-row flex-wrap gap-1.5">
        {n.topics.map((t) => (
          <View key={t} className="rounded-full bg-stone-100 px-2.5 py-0.5 dark:bg-stone-700">
            <Text className="text-caption text-stone-600 dark:text-stone-300">{topicLabel(t)}</Text>
          </View>
        ))}
      </View>
    ) : null;

  const freeNoteBody = (n: RememberNote) => {
    const { title, body } = splitTitle(n.raw_text ?? '');
    return (
      <>
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{title}</Text>
        {body ? <Text className="text-body text-stone-800 dark:text-stone-200">{body}</Text> : null}
        {topicChips(n)}
      </>
    );
  };

  const freeNoteCard = (n: RememberNote) =>
    editing?.kind === 'free' && editing.note?.id === n.id && isFreeNote(n) ? (
      <RememberFreeNoteEditor
        key={n.id}
        firstName={first}
        heading={`A note from ${formatDay(noteDay(n))}`}
        draftKey={`free-${n.id}`}
        initialText={n.raw_text ?? ''}
        initialTopics={(n.topics ?? []) as TopicKey[]}
        onSave={saveFree(n)}
        onCancel={cancelEditing}
      />
    ) : editing?.kind === 'free' && editing.note?.id === n.id ? (
      <RememberNoteEditor
        key={n.id}
        firstName={first}
        heading={`A note from ${formatDay(noteDay(n))}`}
        draftKey={`note-${n.id}`}
        initial={fieldsFromNote(n)}
        onSave={save(editing)}
        onCancel={cancelEditing}
      />
    ) : (
      <View
        key={n.id}
        className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
        <Text className="text-caption text-stone-400 dark:text-stone-500">{formatDay(noteDay(n))}</Text>
        {isFreeNote(n) ? freeNoteBody(n) : answers(n)}
        {noteActions(n, () => setEditing({ kind: 'free', note: n }))}
      </View>
    );



  // Topic filters and search, only once there are enough notes to need
  // them (2026-10-10).
  const showFilters = notes.length >= FILTER_FROM_NOTES;
  const q = query.trim().toLowerCase();
  const filtering = showFilters && (q.length > 0 || topicFilter !== null);
  const meetupTitle = (m: RememberMeetup) =>
    [`Your ${ordinal(m.number)} meetup`, formatDay(m.date), m.activity].filter(Boolean).join(' · ');
  const matches = filtering
    ? notes
        .filter((n) => (!topicFilter || (n.topics ?? []).includes(topicFilter)) && (!q || noteText(n).includes(q)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];

  // Meetups tab: one card per meetup, newest first.
  const meetupSections: ReactNode[] = [];
  const sections = meetupSections;
  for (let g = meetups.length; g >= 1; g--) {
    const m = meetups[g - 1];
    const note = noteForMeetup(m.id);
    const title = meetupTitle(m);
    if (editing?.kind === 'meetup' && editing.meetup.id === m.id) {
      sections.push(
        <RememberNoteEditor
          key={m.id}
          firstName={first}
          heading={title}
          draftKey={`meetup-${m.id}`}
          initial={fieldsFromNote(note)}
          onSave={save(editing)}
          onCancel={cancelEditing}
        />
      );
    } else {
      sections.push(
        <View
          key={m.id}
          className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
          <Text className="text-caption font-semibold text-accent-500">{title}</Text>
          {m.place ? <Text className="text-caption text-stone-400 dark:text-stone-500">{m.place}</Text> : null}
          {note ? (
            <>
              {answers(note)}
              {noteActions(note, () => setEditing({ kind: 'meetup', meetup: m }))}
            </>
          ) : (
            <Pressable onPress={() => setEditing({ kind: 'meetup', meetup: m })} className="self-start">
              <Text className="text-caption font-semibold text-accent-500">Write something down</Text>
            </Pressable>
          )}
        </View>
      );
    }
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center gap-3 px-6 pt-6">
          <Pressable
            onPress={() => goBack(connectionId ? `/thread/${connectionId}` : '/inbox')}
            hitSlop={10}
            accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={MUTED_ICON_COLOR} />
          </Pressable>
          <Text className="flex-1 text-title text-stone-900 dark:text-stone-50">
            What I want to remember about {first}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="lock-closed-outline" size={14} color={MUTED_ICON_COLOR} />
            <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">
              Only you can see this. {first} never sees your notes.
            </Text>
          </View>
          {closed && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Your notes stay here after a chat ends. You can delete them anytime.
            </Text>
          )}

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

          {asks.length > 0 && (
            <View className="gap-2 rounded-3xl border border-accent-500/40 bg-accent-500/5 p-5">
              <Text className="text-caption font-semibold text-accent-500">Next time, ask {first} about...</Text>
              {asks.map((a) => (
                <View key={a.noteId} className="flex-row items-start gap-3">
                  <Text className="flex-1 text-body text-stone-800 dark:text-stone-200">{a.text}</Text>
                  <Pressable onPress={() => toggleAsked(a.noteId, true)} hitSlop={6}>
                    <Text className="text-caption font-semibold text-accent-500">Asked</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {showFilters && (
            <View className="gap-2">
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your notes"
                placeholderTextColor={MUTED_ICON_COLOR}
                accessibilityLabel="Search your notes"
                className="rounded-xl border border-stone-300 px-3 py-2.5 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
              />
              <View className="flex-row flex-wrap gap-2">
                {TOPICS.map((t) => {
                  const on = topicFilter === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setTopicFilter(on ? null : t.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Show ${t.label}`}
                      className={`rounded-full border px-3 py-1.5 ${
                        on ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-600'
                      }`}>
                      <Text
                        className={`text-caption ${on ? 'font-semibold text-accent-500' : 'text-stone-600 dark:text-stone-300'}`}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Tabs (2026-10-23). Search and topic filters above them look
              through every note; while filtering, matches show instead. */}
          {!filtering && (
            <View className="flex-row gap-2">
              {(['meetups', 'notes'] as const).map((k) => {
                const on = tab === k;
                const count = k === 'meetups' ? meetups.length : freeNotes.length + profileNotes.length;
                return (
                  <Pressable
                    key={k}
                    onPress={() => setTab(k)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    className={`rounded-full border px-4 py-1.5 ${
                      on ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50' : 'border-stone-300 dark:border-stone-600'
                    }`}>
                    <Text className={`text-caption font-semibold ${on ? 'text-stone-50 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
                      {k === 'meetups' ? 'Meetups' : 'Notes'}{count > 0 ? ` (${count})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {filtering ? (
            <View className="gap-3">
              <View className="flex-row items-center gap-4">
                <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">
                  {matches.length === 0
                    ? 'No notes match.'
                    : `${matches.length} ${matches.length === 1 ? 'note' : 'notes'}`}
                </Text>
                <Pressable
                  onPress={() => {
                    setQuery('');
                    setTopicFilter(null);
                  }}
                  hitSlop={6}>
                  <Text className="text-caption font-semibold text-accent-500">Show all</Text>
                </Pressable>
              </View>
              {matches.map((n) => {
                const m = n.meetup_id ? meetups.find((x) => x.id === n.meetup_id) : undefined;
                if (!m) return freeNoteCard(n);
                if (editing?.kind === 'meetup' && editing.meetup.id === m.id) {
                  return (
                    <RememberNoteEditor
                      key={n.id}
                      firstName={first}
                      heading={meetupTitle(m)}
                      draftKey={`meetup-${m.id}`}
                      initial={fieldsFromNote(n)}
                      onSave={save(editing)}
                      onCancel={cancelEditing}
                    />
                  );
                }
                return (
                  <View
                    key={n.id}
                    className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                    <Text className="text-caption font-semibold text-accent-500">{meetupTitle(m)}</Text>
                    {answers(n)}
                    {noteActions(n, () => setEditing({ kind: 'meetup', meetup: m }))}
                  </View>
                );
              })}
            </View>
          ) : tab === 'meetups' ? (
            <View className="gap-4">
              {meetups.length === 0 ? (
                <Text className="text-body text-stone-600 dark:text-stone-300">
                  After you meet {first}, each meetup gets its own place here.
                </Text>
              ) : (
                meetupSections
              )}
            {doneAsks.length > 0 && (
              <View className="gap-2">
                <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Already asked</Text>
                {doneAsks.map((n) => (
                  <View key={n.id} className="flex-row items-start gap-3">
                    <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">{n.ask_next}</Text>
                    <Pressable onPress={() => toggleAsked(n.id, false)} hitSlop={6}>
                      <Text className="text-caption text-stone-400 dark:text-stone-500">Undo</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            </View>
          ) : (
            <View className="gap-4">
              {editing?.kind === 'free' && editing.note === null ? (
                <RememberFreeNoteEditor
                  firstName={first}
                  heading="A note for yourself"
                  draftKey={`free-new-${connectionId}`}
                  initialText=""
                  initialTopics={[]}
                  onSave={saveFree(null)}
                  onCancel={cancelEditing}
                />
              ) : (
                <Pressable
                  onPress={() => setEditing({ kind: 'free', note: null })}
                  className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
                  <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Write something down</Text>
                </Pressable>
              )}
              {freeNotes.length === 0 && profileNotes.length === 0 && (
                <Text className="text-body text-stone-600 dark:text-stone-300">
                  Anything you want to remember about {first}, anytime.
                </Text>
              )}
              {[...freeNotes].sort((x, y) => y.created_at.localeCompare(x.created_at)).map(freeNoteCard)}
              {profileNotes.length > 0 && (
                <View className="gap-3">
                  <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                    Written on {first}&apos;s profile
                  </Text>
                  {profileNotes.map((pn) =>
                    editingProfileNote?.id === pn.id ? (
                      <View
                        key={pn.id}
                        className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                        <TextInput
                          value={editingProfileNote.text}
                          onChangeText={(t) => setEditingProfileNote({ id: pn.id, text: t.slice(0, 300) })}
                          multiline
                          accessibilityLabel="Edit your note"
                          className="min-h-16 rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                        />
                        <View className="flex-row gap-4">
                          <Pressable
                            onPress={async () => {
                              if (!editingProfileNote.text.trim()) return;
                              const ok = await updateCuriosityNote(pn.id, editingProfileNote.text);
                              if (!ok) setError("Couldn't save that. Please try again.");
                              setEditingProfileNote(null);
                              await load();
                            }}>
                            <Text className="text-caption font-semibold text-accent-500">Save</Text>
                          </Pressable>
                          <Pressable onPress={() => setEditingProfileNote(null)}>
                            <Text className="text-caption text-stone-500 dark:text-stone-400">Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View
                        key={pn.id}
                        className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
                        <Text className="text-caption text-stone-400 dark:text-stone-500">{formatDay(pn.created_at.slice(0, 10))}</Text>
                        <Text className="text-body text-stone-800 dark:text-stone-200">{pn.note}</Text>
                        <View className="flex-row gap-4">
                          <Pressable onPress={() => setEditingProfileNote({ id: pn.id, text: pn.note })}>
                            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Edit</Text>
                          </Pressable>
                          <Pressable
                            onPress={async () => {
                              if (confirmDelete !== pn.id) {
                                setConfirmDelete(pn.id);
                                return;
                              }
                              setConfirmDelete(null);
                              await deleteCuriosityNote(pn.id);
                              await load();
                            }}>
                            <Text
                              className={`text-caption font-semibold ${
                                confirmDelete === pn.id ? 'text-red-600 dark:text-red-400' : 'text-stone-400 dark:text-stone-500'
                              }`}>
                              {confirmDelete === pn.id ? 'Tap again to delete' : 'Delete'}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )
                  )}
                </View>
              )}
            </View>
          )}

          {(notes.length > 0 || profileNotes.length > 0) && (
            <View className="flex-row items-center gap-4 pt-2">
              <Pressable onPress={removeAll}>
                <Text
                  className={`text-caption font-semibold ${
                    confirmDeleteAll ? 'text-red-600 dark:text-red-400' : 'text-stone-400 dark:text-stone-500'
                  }`}>
                  {confirmDeleteAll ? `Tap again to delete everything about ${first}` : `Delete everything about ${first}`}
                </Text>
              </Pressable>
              {confirmDeleteAll && (
                <Pressable onPress={() => setConfirmDeleteAll(false)}>
                  <Text className="text-caption text-stone-400 dark:text-stone-500">Cancel</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
