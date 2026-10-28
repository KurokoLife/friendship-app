import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { InlineLink, Pill } from '@/components/ui';
import {
  CAN_PUSH,
  DEFAULT_SETTINGS,
  NOTIFY_TYPES,
  getNotifySettings,
  hourLabel,
  pushState,
  saveNotifySettings,
  turnOnPush,
  type NotifySettings,
  type PushState,
} from '@/lib/notifications';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const QUIET_STARTS = [20, 21, 22, 23];
const QUIET_ENDS = [6, 7, 8, 9];

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      aria-checked={on}
      accessibilityLabel={label}
      className={`min-h-11 justify-center rounded-full border px-4 active:opacity-70 ${
        on ? 'border-apricot bg-honey dark:border-apricot dark:bg-stone-700' : 'border-outline dark:border-stone-600'
      }`}>
      <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">{label}</Text>
    </Pressable>
  );
}

// Notifications (rebuild stage 3b, 2026-10-28; 05 "Notifications"): per type
// and per channel, quiet hours, gentle defaults. Lines not given by 05 are
// drafts (docs/DECISIONS.md section 16).
export function NotificationSettings() {
  const [s, setS] = useState<NotifySettings>(DEFAULT_SETTINGS);
  const [email, setEmail] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('unavailable');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured) return;
      getNotifySettings().then(setS);
      pushState().then(setPush);
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        if (!user) return;
        const { data } = await supabase.from('users').select('email').eq('id', user.id).maybeSingle();
        setEmail((data as { email: string | null } | null)?.email?.trim() || null);
      });
    }, [])
  );

  const change = async (patch: Partial<NotifySettings>) => {
    const before = s;
    setS({ ...s, ...patch });
    if (!(await saveNotifySettings(patch))) setS(before);
  };

  return (
    <View className="gap-3">
      <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Notifications</Text>
      <View className="gap-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Limen can let you know when something happens, on your phone or by email. A message notification only says who
          it&apos;s from, never what it says.
        </Text>

        {!CAN_PUSH ? (
          <Text className="text-body text-stone-700 dark:text-stone-300">Phone notifications work in the Limen phone app.</Text>
        ) : push === 'on' ? (
          <Text className="text-body text-stone-700 dark:text-stone-300">Phone notifications are on for this phone.</Text>
        ) : push === 'off' ? (
          <Pill
            label="Turn on phone notifications"
            icon="notifications-outline"
            className="self-start"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setPush(await turnOnPush());
              setBusy(false);
            }}
          />
        ) : push === 'denied' ? (
          <Text className="text-body text-stone-700 dark:text-stone-300">
            Notifications are off for Limen in your phone&apos;s settings. You can turn them on there.
          </Text>
        ) : (
          <Text className="text-body text-stone-700 dark:text-stone-300">
            Phone notifications aren&apos;t ready in this version of the app yet.
          </Text>
        )}

        <Text className="text-body text-stone-700 dark:text-stone-300">
          {email ? (
            <>Emails go to {email}.</>
          ) : (
            <>
              To get emails, add one in{' '}
              <InlineLink onPress={() => router.push('/account-recovery?from=settings')}>Sign-in and recovery</InlineLink>.
            </>
          )}
        </Text>

        {NOTIFY_TYPES.map((t) => (
          <View key={t.key} className="gap-2" accessibilityLabel={t.label}>
            <View className="gap-0.5">
              <Text className="text-body text-stone-900 dark:text-stone-50">{t.label}</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">{t.detail}</Text>
            </View>
            <View className="flex-row flex-wrap gap-x-6 gap-y-2">
              {(['push', 'email'] as const).map((ch) => {
                const key = `${t.key}_${ch}` as const;
                return (
                  <View key={ch} className="flex-row items-center gap-2">
                    <Switch
                      accessibilityLabel={`${t.label}: ${ch === 'push' ? 'phone' : 'email'}`}
                      value={s[key]}
                      onValueChange={(v) => change({ [key]: v } as Partial<NotifySettings>)}
                    />
                    <Text className="text-caption text-stone-700 dark:text-stone-300">{ch === 'push' ? 'Phone' : 'Email'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View className="gap-2 border-t border-stone-200 pt-4 dark:border-stone-700">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 text-body text-stone-900 dark:text-stone-50">Quiet hours</Text>
            <Switch accessibilityLabel="Quiet hours" value={s.quiet_on} onValueChange={(v) => change({ quiet_on: v })} />
          </View>
          {s.quiet_on ? (
            <>
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                Nothing arrives between {hourLabel(s.quiet_start)} and {hourLabel(s.quiet_end)}. It waits until then.
              </Text>
              <Text className="text-caption text-stone-700 dark:text-stone-300">From</Text>
              <View className="flex-row flex-wrap gap-2">
                {QUIET_STARTS.map((h) => (
                  <Chip key={h} label={hourLabel(h)} on={s.quiet_start === h} onPress={() => change({ quiet_start: h })} />
                ))}
              </View>
              <Text className="text-caption text-stone-700 dark:text-stone-300">Until</Text>
              <View className="flex-row flex-wrap gap-2">
                {QUIET_ENDS.map((h) => (
                  <Chip key={h} label={hourLabel(h)} on={s.quiet_end === h} onPress={() => change({ quiet_end: h })} />
                ))}
              </View>
            </>
          ) : (
            <Text className="text-caption text-stone-500 dark:text-stone-400">Notifications can arrive at any hour.</Text>
          )}
        </View>
      </View>
    </View>
  );
}
