import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

// Live camera for the web version of the selfie check (2026-10-06). On the
// web the image picker offered a file chooser, so anyone could upload a
// saved photo instead of taking a new selfie. This opens the device camera
// inside the page and only lets the person take a photo now. There is no
// way to pick a saved file. Web only: the phone app already opens the
// camera directly.

export type WebCameraShot = { uri: string; base64: string; ext: 'jpg' };

export function WebCamera({
  onCapture,
  onCancel,
}: {
  onCapture: (shot: WebCameraShot) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open a camera. Please do your selfie check on your phone.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setError(
          "We couldn't open your camera. Allow camera access for this site in your browser settings, or do your selfie check on your phone."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // The preview is mirrored like a mirror; save the photo the right way round.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    onCapture({ uri: dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), ext: 'jpg' });
  };

  return (
    <View className="gap-3">
      {error ? (
        <Text className="text-body text-amber-700 dark:text-amber-400">{error}</Text>
      ) : (
        <View className="items-center overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ width: '100%', maxWidth: 360, transform: 'scaleX(-1)', display: 'block' }}
          />
        </View>
      )}
      <View className="flex-row gap-2">
        <Pressable
          onPress={onCancel}
          className="flex-1 items-center rounded-full border border-stone-300 py-3 dark:border-stone-600">
          <Text className="text-body text-stone-600 dark:text-stone-300">Cancel</Text>
        </Pressable>
        {!error && (
          <Pressable
            onPress={capture}
            disabled={!ready}
            className={`flex-1 items-center rounded-full bg-stone-900 py-3 dark:bg-stone-50 ${ready ? '' : 'opacity-40'}`}>
            <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
              {ready ? 'Take photo' : 'Opening camera...'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
