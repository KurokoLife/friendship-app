import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addCuriosityNote,
  deleteCuriosityNote,
  fetchCuriosityNotes,
  fetchProfileStories,
  orderStoriesForViewer,
  storyPromptLabel,
  type CuriosityNote,
  type Story,
} from '@/lib/stories';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Limen v2 (2026-10-03): a member's Stories, plus the reader's private
// "I wonder..." notes. See docs/LIMEN_V2_DECISIONS.md.
//
// The reader notices their own curiosity and writes it down privately.
// Limen doesn't suggest the question, it only asks a question back about
// the reader's curiosity ("is this about a fact, or about them?"), the
// same rule as the deeper-question coach. Notes are never shared.

// readOnly: the Public Profile Review preview of your own profile shows
// your stories exactly as others see them, without the reader's private
// "I wonder..." notes (those belong to the reader, not the subject).
type Props = { subjectUserId: string; subjectName: string | null; readOnly?: boolean };

export function ProfileStories({ subjectUserId, subjectName, readOnly = false }: Props) {
  const [stories, setStories] = useState<{ item: Story; index: number }[]>([]);
  const [notes, setNotes] = useState<CuriosityNote[]>([]);
  const [openIndex, setOpenIndex] = useState<number | 'general' | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [s, n] = await Promise.all([fetchProfileStories(subjectUserId), fetchCuriosityNotes(subjectUserId)]);
      if (cancelled) return;
      setStories(orderStoriesForViewer(s, user?.id ?? '', subjectUserId));
      setNotes(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [subjectUserId]);

  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    const ok = await addCuriosityNote(subjectUserId, draft, typeof openIndex === 'number' ? openIndex : null);
    setSaving(false);
    if (ok) {
      setDraft('');
      setOpenIndex(null);
      setNotes(await fetchCuriosityNotes(subjectUserId));
    }
  };

  const name = subjectName ?? 'them';

  const noteInput = (
    <View className="gap-2">
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="I wonder..."
        placeholderTextColor={MUTED_ICON_COLOR}
        multiline
        maxLength={300}
        className="min-h-16 rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
      />
      <Text className="text-caption text-stone-400 dark:text-stone-600">
        Is this about a fact, or about {name}? What would the answer tell you about who they are?
      </Text>
      <View className="flex-row gap-3">
        <Pressable onPress={save} disabled={saving || !draft.trim()}>
          <Text className={`text-caption font-semibold text-accent-500 ${saving || !draft.trim() ? 'opacity-40' : ''}`}>
            Save privately
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setOpenIndex(null);
            setDraft('');
          }}>
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View className="gap-3">
      {stories.map(({ item, index }) => (
        <View
          key={`${index}-${item.prompt_key}`}
          className="gap-2 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
          <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-500">
            {storyPromptLabel(item.prompt_key)}
          </Text>
          <Text className="text-body text-stone-700 dark:text-stone-300">{item.text}</Text>
          {readOnly ? null : openIndex === index ? (
            noteInput
          ) : (
            <Pressable onPress={() => setOpenIndex(index)} className="self-start">
              <Text className="text-caption font-semibold text-accent-500">I wonder...</Text>
            </Pressable>
          )}
        </View>
      ))}

      {!readOnly && stories.length === 0 && openIndex !== 'general' && (
        <Pressable onPress={() => setOpenIndex('general')} className="self-start">
          <Text className="text-caption font-semibold text-accent-500">Something you&apos;re curious about? Note it privately</Text>
        </Pressable>
      )}
      {openIndex === 'general' && noteInput}

      {!readOnly && notes.length > 0 && (
        <View className="gap-2 rounded-2xl border border-dashed border-stone-300 p-4 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
            Your private wonderings, only you see these
          </Text>
          {notes.map((n) => (
            <View key={n.id} className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-caption text-stone-600 dark:text-stone-300">• {n.note}</Text>
              <Pressable
                onPress={async () => {
                  await deleteCuriosityNote(n.id);
                  setNotes((prev) => prev.filter((x) => x.id !== n.id));
                }}>
                <Text className="text-caption text-stone-400 dark:text-stone-600">Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
