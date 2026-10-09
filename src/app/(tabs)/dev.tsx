import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MeetupTestPanel } from '@/components/meetup-test-panel';
import { checkDbVersion, friendlyToolError, MIGRATION_URL_BASE, RECENT_DB_UPDATES } from '@/lib/db-version';
import { resetCoachMarks } from '@/lib/coach-marks';
import { DEV_SEED_USERS, devSignInAs } from '@/lib/dev-tools';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { returnToMyAccount, useTestTools } from '@/lib/test-mode';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Test tools (rebuilt 2026-10-08). Every tool here drives the system the
// app actually uses today. The previous version was mostly tools for the
// retired reminder and meetup systems (they changed tables the app no
// longer reads, so nothing appeared in the chat), which made testing
// confusing. Only admins and the test accounts can use these; the database
// checks this too.

type Chat = {
  connection_id: string;
  name: string;
  status: string | null;
  other_id: string | null;
  has_messages: boolean;
};

const NO_REPLY_STEPS: { hours: number; label: string; shows: string }[] = [
  { hours: 2, label: '2 hours', shows: 'Nothing yet' },
  { hours: 25, label: '1 day', shows: 'First reminder for the person who hasn’t replied' },
  { hours: 37, label: '1.5 days', shows: 'Calm “it can take a few days” note for the person waiting' },
  { hours: 73, label: '3 days', shows: 'Second reminder (reply, more time, or end)' },
  { hours: 121, label: '5 days', shows: 'Last reminder' },
  { hours: 126, label: '5+ days', shows: '“It’s been quiet” card for the person waiting' },
  { hours: 170, label: '7 days', shows: 'The chat closes by itself' },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-800">
      <View className="gap-1">
        <Text className="text-title text-stone-900 dark:text-stone-50">{title}</Text>
        {hint && <Text className="text-caption text-stone-500 dark:text-stone-400">{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function Button({
  label,
  onPress,
  busy,
  tone = 'plain',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  tone?: 'plain' | 'danger' | 'primary';
}) {
  const cls =
    tone === 'danger'
      ? 'border-red-300 dark:border-red-800'
      : tone === 'primary'
        ? 'border-stone-900 bg-stone-900 dark:border-stone-50 dark:bg-stone-50'
        : 'border-stone-300 dark:border-stone-600';
  const text =
    tone === 'danger'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'primary'
        ? 'text-stone-50 dark:text-stone-900'
        : 'text-stone-800 dark:text-stone-200';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className={`self-start rounded-full border px-4 py-2 ${cls} ${busy ? 'opacity-50' : ''}`}>
      <Text className={`text-caption font-semibold ${text}`}>{busy ? 'Working...' : label}</Text>
    </Pressable>
  );
}

function Status({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <Text className="text-caption text-stone-700 dark:text-stone-300">{text}</Text>;
}

export default function TestToolsScreen() {
  const testTools = useTestTools();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, string | null>>({});
  const [otherText, setOtherText] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmMine, setConfirmMine] = useState(false);
  const [dbUpToDate, setDbUpToDate] = useState<boolean | null>(null);

  const say = (key: string, text: string | null) => setStatus((s) => ({ ...s, [key]: text }));

  const loadChats = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setChats([]);
      return;
    }
    const [{ data: convos }, { data: mutual }, { data: conns }] = await Promise.all([
      supabase.from('inbox_conversations').select('connection_id, display_name'),
      supabase.from('new_mutual_connections').select('connection_id, display_name'),
      supabase.from('connections').select('id, user_a_id, user_b_id, status'),
    ]);
    const info = new Map<string, { other: string; status: string | null }>();
    for (const c of (conns ?? []) as { id: string; user_a_id: string; user_b_id: string; status: string | null }[]) {
      info.set(c.id, { other: c.user_a_id === user.id ? c.user_b_id : c.user_a_id, status: c.status });
    }
    const withMessages = new Set(((convos ?? []) as { connection_id: string }[]).map((c) => c.connection_id));
    const rows = [
      ...((convos ?? []) as { connection_id: string; display_name: string | null }[]),
      ...((mutual ?? []) as { connection_id: string; display_name: string | null }[]),
    ];
    const list: Chat[] = [];
    const seen = new Set<string>();
    for (const c of rows) {
      if (seen.has(c.connection_id)) continue;
      seen.add(c.connection_id);
      const i = info.get(c.connection_id);
      list.push({
        connection_id: c.connection_id,
        name: c.display_name ?? 'A member',
        status: i?.status ?? null,
        other_id: i?.other ?? null,
        has_messages: withMessages.has(c.connection_id),
      });
    }
    setChats(list);
    setChatId((cur) => (cur && list.some((l) => l.connection_id === cur) ? cur : null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChats();
      if (isSupabaseConfigured) checkDbVersion().then((r) => setDbUpToDate(r.upToDate));
    }, [loadChats])
  );

  if (!testTools.allowed) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 px-6 dark:bg-stone-900">
        {testTools.checked ? (
          <Text className="text-center text-body text-stone-500 dark:text-stone-400">
            Test tools are only available to admins.
          </Text>
        ) : (
          <ActivityIndicator color={MUTED_ICON_COLOR} />
        )}
      </View>
    );
  }

  const chat = chats.find((c) => c.connection_id === chatId) ?? null;

  const rpc = async (key: string, fn: string, args: Record<string, unknown>, ok: (data: unknown) => string) => {
    setBusy(key);
    say(key, null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(null);
    say(key, error ? friendlyToolError(error.message) : ok(data));
    loadChats();
  };

  const switchTo = async (phone: string) => {
    setSwitching(phone);
    say('switch', null);
    const { error } = await devSignInAs(phone);
    setSwitching(null);
    if (error) {
      say('switch', error.message);
      return;
    }
    setChatId(null);
    setStatus({});
    router.replace('/home');
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-24 pt-10">
          <View className="gap-2">
            <Text className="text-display text-stone-900 dark:text-stone-50">Test tools</Text>
            <Text className="text-body text-stone-500 dark:text-stone-400">
              Only admins see this tab. Act as a test account to try the other side of a chat, then come back to your
              own account.
            </Text>
          </View>

          {dbUpToDate === false && (
            <View className="gap-2 rounded-2xl border border-amber-500 bg-amber-500/10 p-4">
              <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                The database needs an update
              </Text>
              <Text className="text-caption text-stone-700 dark:text-stone-300">
                Some test tools won&apos;t work until it&apos;s done. In Supabase, open SQL Editor, then for each file
                below, from top to bottom: open the link, copy everything, paste it into a new query and press Run.
                It&apos;s fine if you already ran some of them, as long as you go through all of them in this order.
              </Text>
              {RECENT_DB_UPDATES.map((f) => (
                <Pressable key={f} onPress={() => Linking.openURL(MIGRATION_URL_BASE + f)}>
                  <Text className="text-caption font-semibold text-accent-500">{f}</Text>
                </Pressable>
              ))}
              <Text className="text-caption text-stone-500 dark:text-stone-400">
                When it&apos;s done, come back to this tab and this note disappears.
              </Text>
            </View>
          )}

          {testTools.actingAs && (
            <View className="gap-2 rounded-2xl border border-accent-500 bg-accent-500/10 p-4">
              <Text className="text-body text-stone-900 dark:text-stone-50">You are testing as {testTools.actingAs}.</Text>
              <Button
                label="Back to my account"
                tone="primary"
                onPress={async () => {
                  const { error } = await returnToMyAccount();
                  if (error) say('switch', error);
                  else router.replace('/home');
                }}
              />
            </View>
          )}

          <Section title="Act as a test account">
            <View className="flex-row flex-wrap gap-2">
              {DEV_SEED_USERS.map((u) => (
                <Pressable
                  key={u.phone}
                  onPress={() => switchTo(u.phone)}
                  disabled={switching !== null}
                  className={`rounded-full border px-4 py-2 ${
                    testTools.actingAs === u.displayName
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-stone-300 dark:border-stone-700'
                  }`}>
                  <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                    {switching === u.phone ? 'Switching...' : u.displayName}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Status text={status.switch} />
          </Section>

          <Section
            title="Pick a chat"
            hint="The chat tools below work on this chat. These are the chats of the account you're using right now. Results of the reopen, no-hello and pause tools show at the bottom of this box.">
            {chats.length === 0 ? (
              <Text className="text-caption text-stone-500 dark:text-stone-400">This account has no chats yet.</Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {chats.map((c) => (
                  <Pressable
                    key={c.connection_id}
                    onPress={() => {
                      setChatId(c.connection_id);
                      setStatus({});
                    }}
                    className={`rounded-full border px-3 py-1.5 ${
                      chatId === c.connection_id ? 'border-accent-500 bg-accent-500/10' : 'border-stone-300 dark:border-stone-700'
                    }`}>
                    <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">
                      {c.name}
                      {c.status && c.status !== 'active' && c.status !== 'pending' ? ` (${c.status})` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {chat && (
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Open this chat"
                  onPress={() => router.push({ pathname: '/thread/[id]', params: { id: chat.connection_id } })}
                />
                {(chat.status === 'inactive' || chat.status === 'paused') && (
                  <Button
                    label="Reopen this chat"
                    busy={busy === 'reopen'}
                    onPress={() => rpc('reopen', 'test_reopen_chat', { p_connection_id: chat.connection_id }, (d) => String(d))}
                  />
                )}
              </View>
            )}
            <Status text={status.reopen} />
          </Section>

          {chat && (
            <Section
              title="No-reply reminders"
              hint={`Makes the last message in your chat with ${chat.name} this old, then runs the real reminder check. Then open the chat as either person.`}>
              <View className="gap-2">
                {NO_REPLY_STEPS.map((s) => (
                  <Pressable
                    key={s.hours}
                    disabled={busy !== null}
                    onPress={() =>
                      rpc('noreply', 'test_no_reply', { p_connection_id: chat.connection_id, p_hours: s.hours }, (d) => String(d))
                    }
                    className={`flex-row items-center justify-between gap-3 rounded-xl border border-stone-300 px-4 py-3 dark:border-stone-700 ${
                      busy !== null ? 'opacity-50' : ''
                    }`}>
                    <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{s.label}</Text>
                    <Text className="flex-1 text-right text-caption text-stone-500 dark:text-stone-400">{s.shows}</Text>
                  </Pressable>
                ))}
              </View>
              <Status text={status.noreply} />
              {chat.other_id && (
                <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    Send a message as {chat.name}, so it&apos;s your turn to reply.
                  </Text>
                  <TextInput
                    value={otherText}
                    onChangeText={setOtherText}
                    placeholder={`A message from ${chat.name}`}
                    placeholderTextColor={MUTED_ICON_COLOR}
                    className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
                  />
                  <Button
                    label={`Send as ${chat.name}`}
                    busy={busy === 'sendas'}
                    onPress={() => {
                      if (!otherText.trim()) return;
                      rpc(
                        'sendas',
                        'test_send_message_as',
                        { p_connection_id: chat.connection_id, p_sender_id: chat.other_id, p_content: otherText.trim(), p_hours_ago: 0 },
                        () => {
                          setOtherText('');
                          return `Sent as ${chat.name}.`;
                        }
                      );
                    }}
                  />
                  <Status text={status.sendas} />
                </View>
              )}
            </Section>
          )}

          {chat && !chat.has_messages && (
            <Section
              title="Match with no hello yet"
              hint={`Nobody has written in your chat with ${chat.name}. From 2 days the chat and Inbox suggest a short hello; at 14 days the match closes quietly.`}>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Make it 3 days old"
                  busy={busy === 'reopen'}
                  onPress={() => rpc('reopen', 'test_match_age', { p_connection_id: chat.connection_id, p_days: 3 }, (d) => String(d))}
                />
                <Button
                  label="Make it 14 days old"
                  busy={busy === 'reopen'}
                  onPress={() => rpc('reopen', 'test_match_age', { p_connection_id: chat.connection_id, p_days: 14 }, (d) => String(d))}
                />
              </View>
            </Section>
          )}

          {chat && chat.status === 'paused' && (
            <Section
              title="Pause"
              hint={`Your chat with ${chat.name} is paused. A pause ends on its own on its end date; this ends it now.`}>
              <Button
                label="End the pause now"
                busy={busy === 'reopen'}
                onPress={() => rpc('reopen', 'test_end_pause', { p_connection_id: chat.connection_id }, (d) => String(d))}
              />
            </Section>
          )}

          {chat && <MeetupTestPanel chatId={chat.connection_id} chatName={chat.name} />}

          {!chat && (
            <Section
              title="No-reply reminders and Meetups"
              hint="Pick a chat above first. The no-reply reminder tools and the meetup tools (Make it tomorrow, Make it today, Make it yesterday, Add a past meetup) then appear here.">
              {chats.length === 0 && (
                <Text className="text-caption text-stone-500 dark:text-stone-400">
                  This account has no chats yet. Act as another test account that has chats, or start one from
                  Discover.
                </Text>
              )}
            </Section>
          )}

          <Section title="Safety" hint="A first message needs a passed selfie check. These work on test accounts only.">
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Mark me verified"
                onPress={() => rpc('safety', 'dev_mark_selfie_verified', { p_verified: true }, () => 'This account is now selfie-verified.')}
              />
              <Button
                label="Remove my verification"
                onPress={() => rpc('safety', 'dev_mark_selfie_verified', { p_verified: false }, () => 'Selfie verification removed.')}
              />
              {chat && (
                <Button
                  label={`Make me and ${chat.name} both Interested`}
                  onPress={() =>
                    rpc('safety', 'dev_force_mutual_interest', { p_connection_id: chat.connection_id }, () => 'Both are now Interested in each other.')
                  }
                />
              )}
              <Button label="Open selfie check" onPress={() => router.push('/selfie-check')} />
            </View>
            <Status text={status.safety} />
          </Section>

          <Section title="This account">
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Get fresh suggestions"
                busy={busy === 'fresh'}
                onPress={() =>
                  rpc('fresh', 'test_clear_my_suggestions', {}, (d) => `Cleared ${d ?? 0} suggestion(s). Open Discover to get new ones.`)
                }
              />
              <Button
                label="Show tips and videos again"
                onPress={async () => {
                  await resetCoachMarks();
                  say('fresh', 'Done. First-time tips and video offers will show again.');
                }}
              />
              <Button
                label="Clear my AI limits"
                busy={busy === 'fresh'}
                onPress={() => rpc('fresh', 'test_clear_ai_limits', {}, () => 'Daily and weekly limits cleared for this account.')}
              />
            </View>
            <Status text={status.fresh} />
            <View className="gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
              {!confirmMine ? (
                <Button label="Reset this account's chats and matches" tone="danger" onPress={() => setConfirmMine(true)} />
              ) : (
                <View className="gap-2">
                  <Text className="text-caption text-red-700 dark:text-red-400">
                    Deletes every chat, message, meetup and suggestion for this account. Can&apos;t be undone.
                  </Text>
                  <View className="flex-row gap-2">
                    <Button
                      label="Yes, reset"
                      tone="danger"
                      busy={busy === 'mine'}
                      onPress={() => {
                        setConfirmMine(false);
                        rpc('mine', 'test_reset_my_matches', {}, () => 'Reset. This account has no chats or suggestions now.');
                      }}
                    />
                    <Button label="Cancel" onPress={() => setConfirmMine(false)} />
                  </View>
                </View>
              )}
              <Status text={status.mine} />
            </View>
          </Section>

          <Section
            title="All test accounts"
            hint="Clears chats, messages, meetups, matches, reports, blocks, tips seen and Interested choices for all 9 test accounts.">
            {!confirmAll ? (
              <Button label="Reset all test accounts" tone="danger" onPress={() => setConfirmAll(true)} />
            ) : (
              <View className="gap-2">
                <Text className="text-caption text-red-700 dark:text-red-400">Are you sure? This can&apos;t be undone.</Text>
                <View className="flex-row gap-2">
                  <Button
                    label="Yes, reset everything"
                    tone="danger"
                    busy={busy === 'all'}
                    onPress={async () => {
                      setConfirmAll(false);
                      setBusy('all');
                      say('all', null);
                      const { data, error } = await supabase.rpc('test_reset_all_test_accounts');
                      setBusy(null);
                      const r = (data ?? {}) as { connections_deleted?: number; interests_deleted?: number; error?: string };
                      say(
                        'all',
                        error
                          ? friendlyToolError(error.message)
                          : (r.error ??
                              `Reset. ${r.connections_deleted ?? 0} chat(s) and ${r.interests_deleted ?? 0} Interested choice(s) cleared.`)
                      );
                      loadChats();
                    }}
                  />
                  <Button label="Cancel" onPress={() => setConfirmAll(false)} />
                </View>
              </View>
            )}
            <Status text={status.all} />
          </Section>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
