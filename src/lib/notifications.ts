import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Notifications (rebuild stage 3b, 2026-10-28, docs/context/05_LIMEN_REBUILD.md
// "Notifications (decided Oct 25)"). Push to the phone app and email, chosen
// per type and per channel, with quiet hours. The database decides what goes
// out (notification_outbox, migration 20261028000001); the send-notifications
// server function sends it. A notification never carries message text.

export type NotifyType = 'hi' | 'message' | 'plan' | 'suggestion';
export type Channel = 'push' | 'email';

export const NOTIFY_TYPES: { key: NotifyType; label: string; detail: string }[] = [
  { key: 'hi', label: 'A new hi', detail: 'When someone says hello in a new chat.' },
  { key: 'message', label: 'New messages', detail: 'Says who it\'s from, never what it says. At most one an hour per chat.' },
  { key: 'plan', label: 'Plans and meetups', detail: 'An invite, a time suggested, a plan set or cancelled.' },
  { key: 'suggestion', label: 'Suggestions', detail: 'Someone in Your circle, as often as you chose above.' },
];

export type NotifySettings = Record<`${NotifyType}_${Channel}`, boolean> & {
  quiet_on: boolean;
  quiet_start: number;
  quiet_end: number;
};

export const DEFAULT_SETTINGS: NotifySettings = {
  hi_push: true,
  hi_email: true,
  message_push: true,
  message_email: true,
  plan_push: true,
  plan_email: true,
  suggestion_push: true,
  suggestion_email: true,
  quiet_on: true,
  quiet_start: 21,
  quiet_end: 8,
};

const COLUMNS = Object.keys(DEFAULT_SETTINGS).join(', ');

export async function getNotifySettings(): Promise<NotifySettings> {
  const { data } = await supabase.from('notification_settings').select(COLUMNS).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data as Partial<NotifySettings> | null) ?? {}) };
}

export async function saveNotifySettings(patch: Partial<NotifySettings>): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return !error;
}

export function hourLabel(h: number): string {
  if (h === 0) return '12 am';
  if (h === 12) return '12 pm';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

// The phone's own time zone, so quiet hours follow the person's clock.
export async function saveMyTimeZone(): Promise<void> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) await supabase.rpc('set_my_time_zone', { p_tz: tz });
  } catch {
    // Not important enough to bother anyone about.
  }
}

// ---- Push (phone app only) ------------------------------------------------------
export const CAN_PUSH = Platform.OS === 'ios' || Platform.OS === 'android';

type NotificationsModule = typeof import('expo-notifications');
let mod: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (!CAN_PUSH) return null;
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-notifications') as NotificationsModule;
    } catch {
      mod = null;
    }
  }
  return mod;
}

// The project id Expo needs to address this app. It's set once the app is
// linked to an Expo account (`eas init`); until then push can't be turned on.
function projectId(): string | null {
  const c = Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  };
  return c.expoConfig?.extra?.eas?.projectId ?? c.easConfig?.projectId ?? null;
}

export type PushState = 'on' | 'off' | 'denied' | 'unavailable';

export async function pushState(): Promise<PushState> {
  const N = notifications();
  if (!N || !projectId()) return 'unavailable';
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted) return 'on';
    return p.canAskAgain ? 'off' : 'denied';
  } catch {
    return 'unavailable';
  }
}

async function registerToken(N: NotificationsModule): Promise<boolean> {
  const id = projectId();
  if (!id) return false;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', { name: 'Limen', importance: N.AndroidImportance.DEFAULT });
    }
    const { data: token } = await N.getExpoPushTokenAsync({ projectId: id });
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return !error;
  } catch {
    return false;
  }
}

// Asked only when the person turns phone notifications on in Settings.
export async function turnOnPush(): Promise<PushState> {
  const N = notifications();
  if (!N || !projectId()) return 'unavailable';
  try {
    let p = await N.getPermissionsAsync();
    if (!p.granted && p.canAskAgain) p = await N.requestPermissionsAsync();
    if (!p.granted) return 'denied';
    return (await registerToken(N)) ? 'on' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// On app start: if the person already allowed notifications, make sure this
// phone's address is saved for whoever is signed in. Never asks.
export async function refreshPushIfAllowed(): Promise<void> {
  const N = notifications();
  if (!N || !projectId()) return;
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted) await registerToken(N);
  } catch {
    // Push simply stays off.
  }
}

// Tapping a notification opens the chat or Your circle it's about. Returns a
// function that stops listening.
export function listenForNotificationTaps(open: (path: string) => void): () => void {
  const N = notifications();
  if (!N) return () => undefined;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    const sub = N.addNotificationResponseReceivedListener((r) => {
      const path = (r.notification.request.content.data as { path?: string } | undefined)?.path;
      if (typeof path === 'string' && path.startsWith('/')) open(path);
    });
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}
