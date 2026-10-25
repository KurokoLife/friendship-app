import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addCuriosityNote,
  deleteCuriosityNote,
  fetchCuriosityNotes,
  fetchProfileStories,
  orderStoriesForViewer,
  type CuriosityNote,
  type Story,
} from '@/lib/stories';
import { supabase } from '@/lib/supabase';
import { palette } from '@/theme';
import { InlineLink } from '@/components/ui';

const MUTED_ICON_COLOR = palette.muted;

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
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Is this about a fact, or about {name}? What would the answer tell you about who they are?
      </Text>
      <View className="flex-row gap-3">
        <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={save} disabled={saving || !draft.trim()}>
          <Text className={`text-caption font-semibold ${saving || !draft.trim() ? 'opacity-40' : ''} text-stone-900 dark:text-stone-50`}>
            Save privately
          </Text>
        </Pressable>
        <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600"
          onPress={() => {
            setOpenIndex(null);
            setDraft('');
          }}>
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Cancel</Text>
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
          <Text className="text-body text-stone-700 dark:text-stone-300">{item.text}</Text>
          {readOnly ? null : openIndex === index ? (
            noteInput
          ) : (
            <Pressable onPress={() => setOpenIndex(index)} className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600 self-start">
              <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Note it privately</Text>
            </Pressable>
          )}
        </View>
      ))}

      {!readOnly && stories.length === 0 && openIndex !== 'general' && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Something you&apos;d like to ask about? <InlineLink onPress={() => setOpenIndex('general')}>Note it privately</InlineLink>
        </Text>
      )}
      {openIndex === 'general' && noteInput}

      {!readOnly && notes.length > 0 && (
        <View className="gap-2 rounded-2xl border border-dashed border-stone-300 p-4 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
            Your private notes, only you see these
          </Text>
          {notes.map((n) => (
            <View key={n.id} className="flex-row items-start justify-between gap-3">
              <Text className="flex-1 text-caption text-stone-600 dark:text-stone-300">• {n.note}</Text>
              <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600"
                onPress={async () => {
                  await deleteCuriosityNote(n.id);
                  setNotes((prev) => prev.filter((x) => x.id !== n.id));
                }}>
                <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
