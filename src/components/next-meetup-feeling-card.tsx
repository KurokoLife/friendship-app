import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { GuideVideoPlayer } from '@/components/guide-video-player';
import type { FirstMeetupFeeling } from '@/lib/meetup-milestones';
import { getMeetupAnxietyVideoUrl } from '@/lib/module-videos';

type Props = {
  otherName: string;
  // Called the moment an option is picked; the caller is responsible for
  // writing it (submitNextMeetupFeeling) and, for excited/neutral,
  // dismissing the card immediately, matching the old single-button
  // placeholder's own onAck behavior exactly for those two options.
  onPick: (feeling: FirstMeetupFeeling) => void;
  // Called only after "Nervous" has shown its video and the user taps
  // Done, since that path deliberately keeps the card mounted a moment
  // longer than excited/neutral so the video is actually watchable.
  onDone: () => void;
};

const FEELING_OPTIONS: { key: FirstMeetupFeeling; label: string }[] = [
  { key: 'excited', label: 'Excited' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'nervous', label: 'Nervous' },
];

// Day-of feeling check, item 4 of the 2026-08-16 session. Given a real
// three-option picker and video branching in the 2026-08-22
// video-hosting session, matching first_meetup_feelings' own option set
// and copy style (see first-meetup-milestone-modal.tsx) now that a real
// video exists to route "Nervous" to. Excited/Neutral still resolve
// immediately with no video, identical to the old placeholder's own
// single-button behavior.
export function NextMeetupFeelingCard({ otherName, onPick, onDone }: Props) {
  const [showingVideo, setShowingVideo] = useState(false);
  const anxietyVideoUrl = getMeetupAnxietyVideoUrl();

  const handlePick = (feeling: FirstMeetupFeeling) => {
    onPick(feeling);
    if (feeling === 'nervous') {
      setShowingVideo(true);
    }
  };

  if (showingVideo) {
    return (
      <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-body text-stone-700 dark:text-stone-300">
          That&apos;s a completely normal way to feel before meeting up. A couple of thoughts before you go.
        </Text>
        {anxietyVideoUrl && <GuideVideoPlayer uri={anxietyVideoUrl} />}
        <Pressable
          onPress={onDone}
          className="self-start rounded-full border border-stone-300 px-4 py-2 dark:border-stone-700">
          <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body text-stone-700 dark:text-stone-300">
        You&apos;re meeting up with {otherName} today. How are you feeling about it?
      </Text>
      <View className="flex-row gap-2">
        {FEELING_OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            onPress={() => handlePick(option.key)}
            className="flex-1 items-center rounded-full border border-stone-300 py-2 dark:border-stone-700">
            <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
