import { useEventListener } from 'expo';
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
// aspectRatio is 9/16 (portrait), not 16/9: all real guide videos are
// genuine 1080x1920 vertical recordings, confirmed directly against each
// file's own videoWidth/videoHeight. The previous 16/9 container
// pillarboxed a portrait video down to a thin vertical sliver inside a
// wide black box, the real cause behind two separate bug reports ("no
// video" / "video is a black box with no visible play control") that
// turned out to be the same underlying letterboxing bug, not two
// different defects.
export function GuideVideoPlayer({ uri }: Props) {
  const player = useVideoPlayer(uri);

  return (
    <View className="overflow-hidden rounded-2xl bg-black">
      <VideoView player={player} style={{ width: '100%', aspectRatio: 9 / 16 }} contentFit="contain" />
    </View>
  );
}

// A small, static preview for the Guides list (2026-08-24, seek behavior
// added 2026-08-25): no controls, never played. Seeks to `seekSeconds`
// once the player reaches 'readyToPlay' (seeking any earlier can silently
// no-op), then leaves it paused there as the thumbnail. Every real guide
// video's genuine opening frame (t=0) is dark/near-black, confirmed
// directly by capturing real frames at several timestamps, not assumed;
// 1 second in was checked the same way and reliably lands on a real,
// visually distinctive frame with a complete (not mid-word) caption for
// all three real videos, so it's used as a single shared default rather
// than tuned per video. Still an explicit prop, not a hardcoded constant,
// in case a future video's own 1-second mark turns out differently.
export function GuideVideoThumbnail({ uri, seekSeconds = 1 }: Props & { seekSeconds?: number }) {
  const player = useVideoPlayer(uri);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && player.currentTime === 0) {
      player.currentTime = seekSeconds;
    }
  });

  return (
    <View className="h-14 w-14 overflow-hidden rounded-lg bg-black">
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
  );
}
