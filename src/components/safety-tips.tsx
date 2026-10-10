import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

// Safety tips for meeting someone new (2026-10-10). A calm link, not a
// warning: opened only if the person wants it. Adults decide for
// themselves; the app never shares anyone's plans or location.
const TIPS: { title: string; body: string }[] = [
  {
    title: 'Pick a public place',
    body: 'For the first few meetups, somewhere with other people around, like a cafe, a park or a class, makes it easier for both of you to relax.',
  },
  {
    title: 'Get there and home your own way',
    body: "Having your own way to arrive and leave means you can stay as long as it feels good, and head home when you're ready.",
  },
  {
    title: 'Keep the first one short, if you like',
    body: 'An hour for coffee or a walk is plenty. You can always plan something longer next time.',
  },
  {
    title: 'You can share your location',
    body: "If it helps you feel at ease, you can also share your location with a friend from your phone. That's your choice.",
  },
  {
    title: 'Trust how you feel',
    body: "It's okay to leave early, and you never owe anyone more time. If something feels off, Report or Block are at the top of the chat. You don't need to explain.",
  },
  {
    title: 'In an emergency',
    body: 'Call 911 (or your local emergency number).',
  },
];

export function SafetyTipsLink({ label }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="self-start">
        <Text className="text-caption font-semibold text-stone-500 underline dark:text-stone-400">{label ?? 'Safety tips'}</Text>
      </Pressable>
      <SafetyTipsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SafetyTipsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <ScrollView className="w-full grow-0" contentContainerClassName="gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
          <Text className="text-title text-stone-900 dark:text-stone-50">Safety tips</Text>
          <Text className="text-body text-stone-600 dark:text-stone-300">
            Most meetups are simply nice. A few habits make meeting someone new feel easier.
          </Text>
          {TIPS.map((t) => (
            <View key={t.title} className="gap-0.5">
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{t.title}</Text>
              <Text className="text-body text-stone-600 dark:text-stone-300">{t.body}</Text>
            </View>
          ))}
          <Pressable onPress={onClose} className="self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50">
            <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// A gentle note when a first meetup's place sounds like someone's home.
// Never blocks anything.
const HOME_WORDS = /\b(my|your|his|her|their)\s+(place|house|home|apartment|apt|flat|condo)\b|\b(home|my house|at mine|at yours)\b/i;

export function looksLikeHome(place: string): boolean {
  return HOME_WORDS.test(place.trim());
}

export function FirstMeetupHomeNote() {
  return (
    <Text className="text-caption text-stone-500 dark:text-stone-400">
      For a first meetup, a public place can make it easier for both of you to relax. Up to you two.
    </Text>
  );
}
