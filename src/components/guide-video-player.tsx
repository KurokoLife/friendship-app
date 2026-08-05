import { useVideoPlayer, VideoView } from 'expo-video';
import { View } from 'react-native';

type Props = {
  uri: string;
};

// Real player for a guide-videos Storage asset (see src/lib/module-videos.ts
// for which modules actually have one). No forced autoplay, matching
// VideoPlaceholder's own passive, tap-to-engage feel; native controls
// (play/pause/scrub) are expo-video's own default, confirmed supported on
// web (react-native-web) directly against Expo's SDK 54 docs before this
// library was chosen over the deprecated expo-av.
export function GuideVideoPlayer({ uri }: Props) {
  const player = useVideoPlayer(uri);

  return (
    <View className="overflow-hidden rounded-2xl bg-black">
      <VideoView player={player} style={{ width: '100%', aspectRatio: 16 / 9 }} contentFit="contain" />
    </View>
  );
}
