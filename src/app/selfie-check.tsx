import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchSelfieState, randomSelfiePose, submitSelfieCheck, type SelfieState } from '@/lib/safety';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Selfie check (docs/DECISIONS.md section 3, item 5, option A). Required
// before saying Interested or sending a first message. The person takes a
// selfie doing a random pose; the founder compares it with the profile
// photo in the admin review screen and approves or rejects. The selfie is
// deleted after review, only "verified" is kept. This checks "same person
// as the photo", not legal identity or age.
//
// Opened from the All set screen (?next=home) or when someone taps
// Interested before being verified (no param: goes back).
export default function SelfieCheckScreen() {
  const colorScheme = useColorScheme();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [state, setState] = useState<SelfieState | null>(null);
  const [pose, setPose] = useState(randomSelfiePose());
  const [consented, setConsented] = useState(false);
  const [preview, setPreview] = useState<{ uri: string; base64: string; ext: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSelfieState().then(setState);
  }, []);

  const leave = () => {
    if (next === 'home') router.replace('/home');
    else if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  const takeSelfie = async () => {
    setError(null);
    // On the web preview there is no camera API, the browser offers a file
    // or camera chooser instead.
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError('We need camera access to take your selfie. You can allow it in your phone settings.');
        return;
      }
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.front,
      quality: 0.6,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.base64) return;
    const ext = (asset.mimeType?.split('/')[1] ?? asset.uri.split('.').pop()?.split('?')[0] ?? 'jpg').toLowerCase();
    setPreview({ uri: asset.uri, base64: asset.base64, ext });
  };

  const send = async () => {
    if (!preview || !consented) return;
    setSending(true);
    setError(null);
    const result = await submitSelfieCheck({ pose, base64: preview.base64, fileExt: preview.ext });
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPreview(null);
    setState({ verified: false, status: 'pending' });
  };

  if (!state) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1 px-6 py-10">
        <Pressable onPress={leave}>
          <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
        </Pressable>

        <ScrollView className="flex-1" contentContainerClassName="gap-5 pt-6" showsVerticalScrollIndicator={false}>
          <Text className="text-display text-stone-900 dark:text-stone-50">Your selfie check</Text>

          {state.verified ? (
            <View className="gap-3">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                You&apos;re verified. You can say Interested to anyone in your suggestions.
              </Text>
            </View>
          ) : state.status === 'pending' ? (
            <View className="gap-3">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Thanks, your selfie is with us. We usually check it within a day. Your selfie is deleted as
                soon as it&apos;s been checked.
              </Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                You can keep browsing your suggestions in the meantime.
              </Text>
            </View>
          ) : (
            <View className="gap-5">
              {state.status === 'rejected' && (
                <Text className="text-body text-amber-700 dark:text-amber-400">
                  We couldn&apos;t match your last selfie to your profile photo. Make sure your face is clear in
                  both, then try again.
                </Text>
              )}
              <Text className="text-body text-stone-600 dark:text-stone-300">
                Before anyone can say hello, we check that they&apos;re the person in their photo. It keeps out fake
                profiles, for everyone, including you.
              </Text>

              <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-caption text-stone-500 dark:text-stone-400">Take a selfie while you</Text>
                <Text className="text-title text-stone-900 dark:text-stone-50">{pose}</Text>
                <Pressable onPress={() => setPose(randomSelfiePose())}>
                  <Text className="text-caption text-accent-500">Give me a different pose</Text>
                </Pressable>
              </View>

              {preview && (
                <Image source={{ uri: preview.uri }} className="h-64 w-48 self-center rounded-2xl" />
              )}

              <Pressable onPress={() => setConsented((v) => !v)} className="flex-row items-start gap-3">
                <View
                  className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
                    consented
                      ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
                      : 'border-stone-400 dark:border-stone-600'
                  }`}>
                  {consented && (
                    <Ionicons name="checkmark" size={14} color={colorScheme === 'dark' ? '#1c1917' : '#fafaf9'} />
                  )}
                </View>
                <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">
                  I agree that Limen can compare this selfie with my profile photo to confirm it&apos;s me. The selfie
                  is seen only by the Limen team, used only for this check, and deleted once it&apos;s reviewed.
                </Text>
              </Pressable>
            </View>
          )}

          {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
        </ScrollView>

        <View className="gap-2 pt-4">
          {!state.verified && state.status !== 'pending' && (
            <>
              <Pressable
                onPress={preview ? send : takeSelfie}
                disabled={sending || (preview !== null && !consented)}
                className={`flex-row items-center justify-center gap-2 rounded-full bg-stone-900 py-4 active:opacity-80 dark:bg-stone-50 ${
                  sending || (preview !== null && !consented) ? 'opacity-40' : ''
                }`}>
                {sending && <ActivityIndicator color={MUTED_ICON_COLOR} />}
                <Text className="text-body font-semibold text-stone-50 dark:text-stone-900">
                  {sending ? 'Sending...' : preview ? 'Send my selfie' : 'Take my selfie'}
                </Text>
              </Pressable>
              {preview && (
                <Pressable onPress={takeSelfie} className="items-center py-2">
                  <Text className="text-body text-stone-500 dark:text-stone-400">Retake</Text>
                </Pressable>
              )}
            </>
          )}
          <Pressable onPress={leave} className="items-center py-3">
            <Text className="text-body text-stone-500 dark:text-stone-400">
              {state.verified || state.status === 'pending' ? 'Done' : "I'll do it later"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
