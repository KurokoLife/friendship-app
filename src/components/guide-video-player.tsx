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
//
// aspectRatio is 9/16 (portrait), not 16/9: all three real guide videos
// (module_curiosity, module_show_up, meetup-day-anxiety) are genuine
// 1080x1920 vertical recordings, confirmed directly against each file's
// own videoWidth/videoHeight. The previous 16/9 container pillarboxed a
// portrait video down to a thin vertical sliver inside a wide black box,
// the real cause behind two separate bug reports ("no video" / "video is
// a black box with no visible play control") that turned out to be the
// same underlying letterboxing bug, not two different defects.
export function GuideVideoPlayer({ uri }: Props) {
  const player = useVideoPlayer(uri);

  return (
    <View className="overflow-hidden rounded-2xl bg-black">
      <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16 }} contentFit="contain" />
    </View>
  );
}
