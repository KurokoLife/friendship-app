import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RememberNoteEditor } from '@/components/remember-note-editor';
import { goBack } from '@/lib/navigation';
import {
  deleteAllNotes,
  deleteNote,
  fetchMeetupsThatHappened,
  fetchNotes,
  fieldsFromNote,
  formatDay,
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
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askHandled, setAskHandled] = useState(false);

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
      supabase.from('connections').select('status').eq('id', connectionId).maybeSingle(),
      fetchMeetupsThatHappened(connectionId),
      fetchNotes(connectionId),
    ]);
    setName((person as { display_name: string | null } | null)?.display_name ?? 'them');
    setClosed(CLOSED_STATUSES.includes((conn as { status: string | null } | null)?.status ?? ''));
    setMeetups(ms);
    setNotes(ns);
    setLoaded(true);

    // Opened from "Anything you'd like to remember?": go straight to that
    // meetup, and count it as asked.
    if (askMeetup && !askHandled) {
      setAskHandled(true);
      const m = ms.find((x) => x.id === askMeetup);
      if (m) {
        await markMeetupAsked(m.id, user.id);
        if (!ns.some((n) => n.meetup_id === m.id)) setEditing({ kind: 'meetup', meetup: m });
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
  const groupOf = (n: RememberNote) => meetups.filter((m) => m.date <= noteDay(n)).length;
  const asks = openAsksFrom(notes);
  const doneAsks = notes.filter((n) => n.ask_next && n.ask_next_done_at);

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

  const freeNoteCard = (n: RememberNote) =>
    editing?.kind === 'free' && editing.note?.id === n.id ? (
      <RememberNoteEditor
        key={n.id}
        firstName={first}
        heading={`A note from ${formatDay(noteDay(n))}`}
        initial={fieldsFromNote(n)}
        onSave={save(editing)}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <View
        key={n.id}
        className="gap-2 rounded-3xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
        <Text className="text-caption text-stone-400 dark:text-stone-500">{formatDay(noteDay(n))}</Text>
        {answers(n)}
        {noteActions(n, () => setEditing({ kind: 'free', note: n }))}
      </View>
    );

  const groupHeading = (g: number) => {
    if (g === 0) return meetups.length === 0 ? 'Your notes' : 'Before your first meetup';
    if (g === meetups.length) return 'Since your last meetup';
    return `Between your ${ordinal(g)} and ${ordinal(g + 1)} meetups`;
  };

  const sections: ReactNode[] = [];
  for (let g = meetups.length; g >= 0; g--) {
    const inGroup = freeNotes.filter((n) => groupOf(n) === g).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (inGroup.length > 0) {
      sections.push(
        <View key={`group-${g}`} className="gap-3">
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">{groupHeading(g)}</Text>
          {inGroup.map(freeNoteCard)}
        </View>
      );
    }
    if (g === 0) break;
    const m = meetups[g - 1];
    const note = noteForMeetup(m.id);
    const title = [`Your ${ordinal(m.number)} meetup`, formatDay(m.date), m.activity].filter(Boolean).join(' · ');
    if (editing?.kind === 'meetup' && editing.meetup.id === m.id) {
      sections.push(
        <RememberNoteEditor
          key={m.id}
          firstName={first}
          heading={title}
          initial={fieldsFromNote(note)}
          onSave={save(editing)}
          onCancel={() => setEditing(null)}
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

          {editing?.kind === 'free' && editing.note === null ? (
            <RememberNoteEditor
              firstName={first}
              heading={meetups.length > 0 ? 'Since your last meetup' : 'A note for yourself'}
              initial={fieldsFromNote(null)}
              onSave={save(editing)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Pressable
              onPress={() => setEditing({ kind: 'free', note: null })}
              className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Write something down</Text>
            </Pressable>
          )}

          {meetups.length === 0 && notes.length === 0 && (
            <Text className="text-body text-stone-600 dark:text-stone-300">
              After you meet {first}, each meetup gets its own place here. You can also write something down anytime.
            </Text>
          )}

          {sections}

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

          {notes.length > 0 && (
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
