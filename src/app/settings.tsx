import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '@/lib/analytics';
import { resetCoachMarks } from '@/lib/coach-marks';
import {
  PROMPT_KINDS,
  PROMPT_LABELS,
  getPromptSettings,
  setPromptSetting,
  type PromptKind,
  type PromptSettings,
} from '@/lib/prompt-settings';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';
import { buildRememberExport } from '@/lib/remember';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

type BlockedUser = {
  id: string;
  blocked_id: string;
  display_name: string | null;
  created_at: string;
};

type MyReport = {
  id: string;
  reported_display_name: string | null;
  category: string;
  detail: string | null;
  also_blocked: boolean;
  created_at: string;
};

type AccountInfo = {
  is_premium: boolean;
  premium_until: string | null;
  referral_code: string | null;
  is_admin: boolean | null;
};

const REPORT_CATEGORY_LABELS: Record<string, string> = {
  fake_identity: 'Fake identity',
  harassment: 'Harassment',
  romantic_sexual_misuse: 'Romantic or sexual misuse',
  hate: 'Hate',
  scam: 'Scam',
  unsafe_meetup: 'Unsafe meetup',
  impersonation: 'Impersonation',
  other: 'Other',
};

// Reminders and nudges (2026-10-10): turn each kind off for all chats.
// One chat can be changed from that chat ("Reminders" under the messages).
function ReminderSettings() {
  const [settings, setSettings] = useState<PromptSettings | null>(null);
  const [busy, setBusy] = useState<PromptKind | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured) return;
      getPromptSettings(null).then(setSettings);
    }, [])
  );

  const toggle = async (kind: PromptKind, enabled: boolean) => {
    setBusy(kind);
    await setPromptSetting(null, kind, enabled);
    setSettings(await getPromptSettings(null));
    setBusy(null);
  };

  return (
    <View className="gap-3">
      <SectionHeader label="Reminders and nudges" />
      <View className="gap-4 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          These are on for all your chats. Turn any of them off here, or for one chat from that chat&apos;s
          &quot;Reminders&quot; link. Only you see them, and nobody is told if you turn them off.
        </Text>
        {PROMPT_KINDS.map((kind) => (
          <View key={kind} className="flex-row items-start gap-3">
            <View className="flex-1 gap-0.5">
              <Text className="text-body text-stone-900 dark:text-stone-50">{PROMPT_LABELS[kind].title}</Text>
              <Text className="text-caption text-stone-500 dark:text-stone-400">{PROMPT_LABELS[kind].detail}</Text>
            </View>
            <Switch
              accessibilityLabel={PROMPT_LABELS[kind].title}
              value={settings ? settings[kind].all : true}
              disabled={!settings || busy !== null}
              onValueChange={(v) => toggle(kind, v)}
            />
          </View>
        ))}
        <Text className="text-caption text-stone-500 dark:text-stone-400">
          Always on: when someone says hello and hasn&apos;t heard back yet, one gentle note. It shows once, only
          before you&apos;ve both written. Limen doesn&apos;t send push or email notifications yet; these show inside
          the app.
        </Text>
      </View>
    </View>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <Text className="text-caption font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">
      {label}
    </Text>
  );
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Settings/Account (2026-08-01), confirmed genuinely unbuilt before this
// (no settings screen anywhere in src/app/, per the 2026-07-30 audit and
// re-confirmed directly this session). Consolidates every account-level
// surface that was previously either missing entirely or scattered:
// profile editing (reuses profile-build.tsx via the same ?from=profile
// entry point the Profile tab's own Edit button already used, not
// rebuilt), blocked-user management (a real gap, block_user's own
// migration comment flagged unblock as the known follow-up), a self-view
// of filed reports (reports already had a real self-row SELECT policy,
// just no UI reading it), read-only premium/billing status, account
// deletion (genuinely new, no prior mechanism existed), Terms/Privacy
// links, and the referral share section relocated here from the Profile
// tab.
export default function SettingsScreen() {
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [myReports, setMyReports] = useState<MyReport[]>([]);
  const [reportsExpanded, setReportsExpanded] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'warn' | 'final'>('warn');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resettingTips, setResettingTips] = useState(false);
  const [tipsReset, setTipsReset] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoaded(true);
      return;
    }
    const [{ data: userRow }, { data: blocks }, { data: reports }] = await Promise.all([
      supabase.from('users').select('is_premium, premium_until, referral_code, is_admin').eq('id', user.id).maybeSingle(),
      supabase.from('my_blocks').select('id, blocked_id, display_name, created_at').order('created_at', { ascending: false }),
      supabase
        .from('my_reports')
        .select('id, reported_display_name, category, detail, also_blocked, created_at')
        .order('created_at', { ascending: false }),
    ]);
    setAccount((userRow as AccountInfo) ?? null);
    setBlockedUsers((blocks as BlockedUser[]) ?? []);
    setMyReports((reports as MyReport[]) ?? []);
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleUnblock = async (blockedId: string) => {
    setUnblockingId(blockedId);
    await supabase.rpc('unblock_user', { p_blocked_id: blockedId });
    setUnblockingId(null);
    await load();
  };

  const shareReferralCode = async () => {
    if (!account?.referral_code) return;
    const message = `Join me on Limen, use my invite code ${account.referral_code} when you sign up.`;
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(message);
        setReferralCopied(true);
        setTimeout(() => setReferralCopied(false), 2000);
      } catch {
        // No real fallback on web beyond the visible code text.
      }
      return;
    }
    await Share.share({ message });
  };

  const openDeleteModal = () => {
    setDeleteStep('warn');
    setDeleteError(null);
    setDeleteModalVisible(true);
  };

  // "Show tips again": resets every coach mark this account has dismissed,
  // so someone who clicked through everything quickly can revisit it. Real
  // reset, not just a local flag: resetCoachMarks() deletes every row for
  // this account server-side and clears the shared in-memory cache, so the
  // very next tab visit or trigger genuinely shows each tip again.
  const handleShowTipsAgain = async () => {
    setResettingTips(true);
    setTipsReset(false);
    await resetCoachMarks();
    setResettingTips(false);
    setTipsReset(true);
    setTimeout(() => setTipsReset(false), 3000);
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { data, error } = await supabase.functions.invoke('delete-account');
    setDeleting(false);
    if (error || !data?.success) {
      // A non-2xx reply puts the server's own message in error.context,
      // not in data, so read it from there before falling back.
      let serverMessage: string | null = null;
      try {
        const body = await (error as { context?: Response } | null)?.context?.json();
        serverMessage = body?.error ?? null;
      } catch {
        serverMessage = null;
      }
      setDeleteError(
        serverMessage
          ? `Could not delete your account: ${serverMessage}`
          : 'Could not delete your account. Try again in a moment.'
      );
      return;
    }
    track('account_deleted');
    await supabase.auth.signOut();
    setDeleteModalVisible(false);
    router.replace('/philosophy-intro');
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center justify-between px-6 pt-4">
          <Pressable onPress={() => goBack('/profile')}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          <Text className="text-title text-stone-900 dark:text-stone-50">Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerClassName="gap-8 px-6 pb-14 pt-6">
          {/* Account */}
          <View className="gap-3">
            <SectionHeader label="Account" />
            <Pressable
              onPress={() => router.push('/profile-build?from=profile')}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Edit profile</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/profile-review')}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Preview my public profile</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/selfie-check')}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Selfie check</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
            </Pressable>
            {/* Admins only (users.is_admin, set from the Supabase
                dashboard). The selfie-review function checks again on
                the server. */}
            {account?.is_admin && (
              <Pressable
                onPress={() => router.push('/admin-selfies')}
                className="flex-row items-center justify-between rounded-2xl border border-accent-500/40 bg-white p-4 dark:bg-stone-800">
                <Text className="text-body text-stone-900 dark:text-stone-50">Review selfie checks</Text>
                <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
              </Pressable>
            )}
          </View>

          {/* Limen v2: no Premium tier. Everyone gets the same app. */}
          <View className="gap-3">
            <SectionHeader label="Membership" />
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Free during the pilot</Text>
              <Pressable onPress={() => router.push('/premium')}>
                <Text className="text-caption font-semibold text-accent-500">How Limen is paid for</Text>
              </Pressable>
            </View>
          </View>

          {/* Referral, relocated from the Profile tab. */}
          {account?.referral_code && (
            <View className="gap-3">
              <SectionHeader label="Invite a friend" />
              <Pressable
                onPress={shareReferralCode}
                className="items-center gap-1 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
                <Text className="text-body font-semibold text-accent-500">
                  {Platform.OS === 'web' && referralCopied ? 'Copied!' : 'Share your code'}
                </Text>
                <Text className="text-caption text-stone-400 dark:text-stone-600">
                  Your code: {account.referral_code}
                </Text>
                <Text className="text-center text-caption text-stone-400 dark:text-stone-600">
                  Know someone who could use a new friend? Limen is free during the pilot.
                </Text>
              </Pressable>
            </View>
          )}

          {/* Notifications: honest about what actually exists rather than a
              fake toggle for a system that isn't built. Confirmed before
              writing this screen: no expo-notifications dependency, no
              push infrastructure anywhere in this codebase (a standing,
              repeatedly-documented gap), and the only email this app ever
              sends is Supabase Auth's own transactional confirmation. */}
          <ReminderSettings />

          {/* Help: coach marks (20260820000000). Resets every first-time
              tip this account has dismissed, for someone who clicked
              through everything quickly and wants to revisit it. */}
          <View className="gap-3">
            <SectionHeader label="Help" />
            <Pressable
              onPress={handleShowTipsAgain}
              disabled={resettingTips}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <View className="flex-1 gap-1">
                <Text className="text-body text-stone-900 dark:text-stone-50">Show tips again</Text>
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  {tipsReset
                    ? 'Done, the first-time tips will show again as you visit each screen.'
                    : 'Resets the first-time tips across the app (tabs, reminders, check-ins, and more).'}
                </Text>
              </View>
              {resettingTips && <ActivityIndicator color={MUTED_ICON_COLOR} />}
            </Pressable>
          </View>

          {/* Privacy & Safety */}
          <View className="gap-3">
            <SectionHeader label="Privacy &amp; Safety" />
            <NotesExportBox />
            <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Blocked accounts</Text>
              {blockedUsers.length === 0 ? (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  You haven&apos;t blocked anyone.
                </Text>
              ) : (
                <View className="gap-2 pt-1">
                  {blockedUsers.map((b) => (
                    <View key={b.id} className="flex-row items-center justify-between">
                      <Text className="text-body text-stone-700 dark:text-stone-300">
                        {b.display_name ?? 'A member'}
                      </Text>
                      <Pressable
                        onPress={() => handleUnblock(b.blocked_id)}
                        disabled={unblockingId === b.blocked_id}
                        className={`rounded-full border border-stone-300 px-3 py-1.5 dark:border-stone-600 ${
                          unblockingId === b.blocked_id ? 'opacity-40' : ''
                        }`}>
                        <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                          {unblockingId === b.blocked_id ? 'Unblocking...' : 'Unblock'}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <Pressable
              onPress={() => setReportsExpanded((v) => !v)}
              className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <View className="flex-row items-center justify-between">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                  Reports you&apos;ve filed
                </Text>
                <Ionicons
                  name={reportsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={MUTED_ICON_COLOR}
                />
              </View>
              {myReports.length === 0 ? (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  You haven&apos;t filed any reports.
                </Text>
              ) : (
                reportsExpanded && (
                  <View className="gap-3 pt-1">
                    {myReports.map((r) => (
                      <View key={r.id} className="gap-1 border-t border-stone-100 pt-2 dark:border-stone-700">
                        <Text className="text-caption font-semibold text-stone-700 dark:text-stone-300">
                          {REPORT_CATEGORY_LABELS[r.category] ?? r.category} &middot;{' '}
                          {r.reported_display_name ?? 'A member'}
                        </Text>
                        <Text className="text-caption text-stone-500 dark:text-stone-400">
                          {dateLabel(r.created_at)}
                          {r.also_blocked ? ' · Also blocked' : ''}
                        </Text>
                        {r.detail && (
                          <Text className="text-caption text-stone-500 dark:text-stone-400">{r.detail}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                )
              )}
            </Pressable>
          </View>

          {/* Legal */}
          <View className="gap-3">
            <SectionHeader label="Legal" />
            <Pressable
              onPress={() => router.push('/terms')}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Terms of Service</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/privacy')}
              className="flex-row items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
              <Text className="text-body text-stone-900 dark:text-stone-50">Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={16} color={MUTED_ICON_COLOR} />
            </Pressable>
          </View>

          {/* Sign out */}
          <Pressable
            onPress={async () => {
              await supabase.auth.signOut();
              router.replace('/philosophy-intro');
            }}
            className="items-center rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
            <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Sign out</Text>
          </Pressable>

          {/* Danger zone */}
          <View className="gap-3">
            <SectionHeader label="Account deletion" />
            <Pressable
              onPress={openDeleteModal}
              className="items-center rounded-2xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-stone-800">
              <Text className="text-body font-semibold text-red-600 dark:text-red-400">Delete my account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full gap-4 rounded-3xl bg-stone-50 p-6 dark:bg-stone-900">
            {deleteStep === 'warn' ? (
              <>
                <Text className="text-title text-stone-900 dark:text-stone-50">Delete your account?</Text>
                <Text className="text-body text-stone-600 dark:text-stone-300">
                  This permanently deletes your profile, matches, conversations, and everything else
                  tied to your account. This cannot be undone.
                </Text>
                <View className="flex-row gap-3 pt-2">
                  <Pressable onPress={() => setDeleteModalVisible(false)} className="flex-1 items-center py-3">
                    <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDeleteStep('final')}
                    className="flex-1 items-center rounded-full bg-red-600 py-3 active:opacity-80">
                    <Text className="text-body font-semibold text-white">Continue</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text className="text-title text-stone-900 dark:text-stone-50">Are you sure?</Text>
                <Text className="text-body text-stone-600 dark:text-stone-300">
                  There is no way to recover your account or anything in it once this is done.
                </Text>
                {deleteError && <Text className="text-caption text-red-600 dark:text-red-400">{deleteError}</Text>}
                <View className="flex-row gap-3 pt-2">
                  <Pressable
                    onPress={() => setDeleteModalVisible(false)}
                    disabled={deleting}
                    className="flex-1 items-center py-3">
                    <Text className="text-body text-stone-500 dark:text-stone-400">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDeleteAccount}
                    disabled={deleting}
                    className={`flex-1 flex-row items-center justify-center gap-2 rounded-full bg-red-600 py-3 active:opacity-80 ${
                      deleting ? 'opacity-40' : ''
                    }`}>
                    {deleting && <ActivityIndicator color="#fff" />}
                    <Text className="text-body font-semibold text-white">
                      {deleting ? 'Deleting...' : 'Yes, permanently delete'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Private notes about friends live in each chat (2026-10-10). Export here:
// a download on web, the Share sheet on a phone.
function NotesExportBox() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const download = async () => {
    setState('busy');
    try {
      const json = await buildRememberExport();
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'limen-notes.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json, title: 'My Limen notes' });
      }
      setState('done');
    } catch {
      setState('error');
    }
  };
  return (
    <View className="gap-2 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Your notes about friends</Text>
      <Text className="text-caption text-stone-500 dark:text-stone-400">
        Your private notes live in each chat, under &quot;What I want to remember&quot;. Only you can see them. You can
        download a copy of all of them.
      </Text>
      <Pressable onPress={download} disabled={state === 'busy'} className="self-start">
        <Text className={`text-caption font-semibold text-accent-500 ${state === 'busy' ? 'opacity-40' : ''}`}>
          {state === 'busy' ? 'Preparing...' : 'Download my notes'}
        </Text>
      </Pressable>
      {state === 'done' && <Text className="text-caption text-stone-500 dark:text-stone-400">Done.</Text>}
      {state === 'error' && (
        <Text className="text-caption text-red-600 dark:text-red-400">That didn&apos;t work. Please try again.</Text>
      )}
    </View>
  );
}
