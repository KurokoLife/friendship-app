import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { track } from '@/lib/analytics';
import { fetchActiveReflections, reflectionByConnection, type FollowUpReflection } from '@/lib/follow-up-reflection';
import { checkAndMarkGraduationContinuation } from '@/lib/graduation';
import { lifeTransitionFragment } from '@/lib/life-transition';
import { bestPromptPerConnection, fetchActivePrompts, isSenderTrigger, type NoGhostPrompt } from '@/lib/no-ghost';
import { subscribeToMessages } from '@/lib/realtime-messages';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Mutual Interested gate (docs/DECISIONS.md section 3): both people said
// Interested, the chat is open, but nobody has written yet, so
// inbox_conversations (which needs a message) can't list it.
type NewMutual = {
  connection_id: string;
  other_user_id: string;
  display_name: string | null;
  created_at: string;
};

type Conversation = {
  connection_id: string;
  other_user_id: string;
  display_name: string | null;
  age_band: string | null;
  life_transitions: string[];
  connection_status: string | null;
  last_message_content: string;
  last_message_at: string;
  last_message_sender_id: string;
  has_unread: boolean;
  meetup_count: number;
};

type CapacityStatus = {
  active_count: number;
  active_cap: number;
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// F16: the inbox, the other half of messaging alongside src/app/thread/[id].tsx.
// Reads inbox_conversations (20260712000005_add_inbox_conversations.sql),
// which already does the "active conversations only, one row each, most
// recent message, unread flag" work server-side, this screen just renders
// it. Real-time updates come from subscribing directly to the messages
// table (inbox_conversations is a view, views can't be added to the
// realtime publication), any INSERT or UPDATE (read status changing)
// triggers a refetch of the whole view rather than incremental local
// patching, simpler and always consistent with what the server would
// compute anyway. No read receipts here, has_unread is the only signal
// shown, never a per-message read state.
export default function InboxScreen() {
  const [loaded, setLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [noGhostByConnection, setNoGhostByConnection] = useState<Map<string, NoGhostPrompt>>(new Map());
  const [reflectionsByConnection, setReflectionsByConnection] = useState<Map<string, FollowUpReflection>>(new Map());
  const [capacity, setCapacity] = useState<CapacityStatus | null>(null);
  const [newMutual, setNewMutual] = useState<NewMutual[]>([]);

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
    const [{ data }, activePrompts, activeReflections, { data: capacityRows }, { data: mutualRows }] = await Promise.all([
      supabase.from('inbox_conversations').select('*').order('last_message_at', { ascending: false }),
      fetchActivePrompts(),
      fetchActiveReflections(),
      // Fix #3: "Show active-conversation capacity" (blueprint Section 8's
      // Inbox spec). Read-only, own data only (my_connection_capacity has
      // no parameters, always operates on auth.uid()).
      supabase.rpc('my_connection_capacity'),
      supabase
        .from('new_mutual_connections')
        .select('connection_id, other_user_id, display_name, created_at')
        .order('created_at', { ascending: false }),
    ]);
    setNewMutual((mutualRows ?? []) as NewMutual[]);
    const loadedConversations = (data ?? []) as Conversation[];
    setConversations(loadedConversations);
    setNoGhostByConnection(bestPromptPerConnection(activePrompts));
    setReflectionsByConnection(reflectionByConnection(activeReflections));
    setCapacity((capacityRows?.[0] as CapacityStatus | undefined) ?? null);
    setLoaded(true);

    // Optional 30/90-day continuation measurement (see graduation.ts's
    // own comment for why this is driven from here rather than a cron
    // job): Inbox already visits every one of the caller's connections on
    // every focus, the natural place to speculatively check each
    // graduated one. Both calls are safe to fire on every load, the RPC
    // itself is idempotent (returns null unless the checkpoint is both
    // genuinely due and not yet recorded), so no client-side "have I
    // already checked this" bookkeeping is needed here.
    for (const c of loadedConversations) {
      if (c.connection_status !== 'graduated') continue;
      for (const days of [30, 90] as const) {
        checkAndMarkGraduationContinuation(c.connection_id, days).then((continued) => {
          if (continued === null) return;
          track('graduation_30_90_day_continuation', { connectionId: c.connection_id, days, continued });
        });
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return subscribeToMessages({
      onInsert: () => load(),
      onUpdate: () => load(),
    });
  }, [load]);

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  // Fix #2: light sections rather than one flat list, since Pause
  // is a real state that needs its own visibility (AGENTS.md's
  // Navigation note calls for it to "sit alongside" whatever states
  // exist in Inbox's sectioning). 20260817000000 adds 'ended' as a
  // genuinely separate closed state, distinct from a healthy
  // conversation, its own section and its own per-row label just like
  // Paused/Blocked already have.
  //
  // 'inactive' deliberately does NOT get its own section (20260819
  // session): it still falls into `rest` below, same as before, but the
  // per-row label ternary in renderConversation now gives it a real
  // "Inactive" label instead of blending silently into a healthy
  // conversation. A live check of this project's own connections showed
  // 'inactive' already the single most common status (it accrues
  // automatically from F17's 7-day auto-close, S1's own "close and make
  // room", and every unblock, none of them a rare, deliberate action the
  // way ended/blocked/paused all are), so a dedicated section for it
  // would likely grow to dominate this screen over time and bury
  // "Awaiting your reply"/"Conversations" beneath an ever-growing pile of
  // stale threads, working against Inbox's own purpose of surfacing
  // what's actually alive. An inline label keeps an inactive row sorted
  // by real recency alongside everything else instead.
  const needsReply: Conversation[] = [];
  const paused: Conversation[] = [];
  const blocked: Conversation[] = [];
  const ended: Conversation[] = [];
  const graduated: Conversation[] = [];
  const rest: Conversation[] = [];
  for (const c of conversations) {
    const noGhostPrompt = noGhostByConnection.get(c.connection_id);
    if (c.connection_status === 'blocked') {
      blocked.push(c);
    } else if (c.connection_status === 'ended') {
      ended.push(c);
    } else if (c.connection_status === 'graduated') {
      // Blueprint's own required Inbox section, a real, deliberate state
      // (not a closure like Ended/Blocked), its own section per the spec
      // rather than folded into "Conversations", so a genuinely
      // successful outcome is visible as its own category, not blended
      // in with everything else.
      graduated.push(c);
    } else if (c.connection_status === 'paused') {
      paused.push(c);
    } else if (noGhostPrompt && !isSenderTrigger(noGhostPrompt.trigger_id)) {
      needsReply.push(c);
    } else {
      rest.push(c);
    }
  }

  const renderConversation = (c: Conversation) => {
    const fragment = lifeTransitionFragment(c.life_transitions);
    const noGhostPrompt = noGhostByConnection.get(c.connection_id);
    const showReplyReminder = Boolean(noGhostPrompt && !isSenderTrigger(noGhostPrompt.trigger_id));
    const showReflectionReminder = !noGhostPrompt && reflectionsByConnection.has(c.connection_id);
    return (
      <Pressable
        key={c.connection_id}
        onPress={() => router.push({ pathname: '/thread/[id]', params: { id: c.connection_id } })}
        className="gap-2 rounded-2xl border border-stone-100 bg-white p-5 dark:border-stone-700/60 dark:bg-stone-800">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 flex-row items-baseline gap-2">
            <Text
              className={`text-body text-stone-900 dark:text-stone-50 ${
                c.has_unread ? 'font-semibold' : ''
              }`}>
              {c.display_name ?? 'A member'}
              {c.age_band ? `, ${c.age_band}` : ''}
            </Text>
            {c.has_unread && <View className="h-2 w-2 rounded-full bg-accent-500" />}
          </View>
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            {timeAgo(c.last_message_at)}
          </Text>
        </View>
        {fragment && <Text className="text-caption text-accent-500">{fragment}</Text>}
        <Text
          numberOfLines={1}
          className={`text-body ${
            c.has_unread
              ? 'font-semibold text-stone-800 dark:text-stone-100'
              : 'text-stone-500 dark:text-stone-400'
          }`}>
          {c.last_message_content}
        </Text>
        {/* Blueprint's own Inbox spec: "Show last message, state and
            meetup count." Shown only once there's at least one to show,
            matching this app's own established "don't clutter with a
            zero" convention elsewhere (Remember's People List, the
            thread header's own meetup history line). */}
        {c.meetup_count > 0 && (
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            Met {c.meetup_count} {c.meetup_count === 1 ? 'time' : 'times'}
          </Text>
        )}
        {c.connection_status === 'blocked' ? (
          <Text className="text-caption font-semibold text-red-500 dark:text-red-400">Blocked</Text>
        ) : c.connection_status === 'ended' ? (
          <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Ended</Text>
        ) : c.connection_status === 'graduated' ? (
          <Text className="text-caption font-semibold text-accent-500">Graduated</Text>
        ) : c.connection_status === 'paused' ? (
          <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Paused</Text>
        ) : c.connection_status === 'inactive' ? (
          // Inline label only, deliberately no dedicated section (unlike
          // Paused/Blocked/Ended above): 'inactive' accrues automatically
          // (F17's 7-day auto-close, S1's own "close and make room", or an
          // unblock), not from a rare, deliberate action the way the other
          // three statuses do, and a live check of this project's own real
          // connections showed it already the single most common status.
          // A dedicated section would grow to dominate Inbox over time and
          // bury "Awaiting your reply"/"Conversations" beneath an
          // ever-growing pile of stale threads. Keeping it inline lets an
          // inactive row stay sorted by real recency alongside everything
          // else in "Conversations" (so a conversation that just went
          // inactive doesn't get artificially demoted below a week-old
          // still-active one), while still making it visually
          // unmistakable at a glance that it isn't a live conversation.
          <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Inactive</Text>
        ) : (
          <>
            {showReplyReminder && (
              <Text className="text-caption font-semibold text-accent-500">A reply is overdue</Text>
            )}
            {showReflectionReminder && (
              <Text className="text-caption font-semibold text-accent-500">A reflection is waiting</Text>
            )}
          </>
        )}
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-6 pb-10 pt-10">
          <Text className="text-display text-stone-900 dark:text-stone-50">Inbox</Text>

          <CoachMark markKey="tab_inbox" text="This is where your conversations happen." />

          {/* Fix #3: calm, non-alarming framing throughout, even at the
              cap ("time to check in on one before starting more" rather
              than anything resembling a warning), matching the
              blueprint's own "avoid shaming labels" instruction for this
              screen. */}
          {capacity && (
            <Text className="text-caption text-stone-400 dark:text-stone-600">
              {capacity.active_count} of {capacity.active_cap} active conversations
              {capacity.active_count >= capacity.active_cap
                ? '. Wrap up or pause one to make room for another.'
                : ''}
            </Text>
          )}

          {!isSupabaseConfigured && (
            <Text className="text-caption text-amber-600 dark:text-amber-400">
              Supabase isn&apos;t configured yet. See .env.example.
            </Text>
          )}

          {conversations.length === 0 && newMutual.length === 0 && isSupabaseConfigured && (
            <View className="gap-2 rounded-3xl border border-stone-100 bg-white p-7 dark:border-stone-700/60 dark:bg-stone-800">
              <Text className="text-body text-stone-600 dark:text-stone-300">
                When you and someone both say Interested, your conversation opens here.
              </Text>
            </View>
          )}

          {newMutual.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                You both chose to connect
              </Text>
              {newMutual.map((m) => (
                <Pressable
                  key={m.connection_id}
                  onPress={() => router.push({ pathname: '/thread/[id]', params: { id: m.connection_id } })}
                  className="gap-1 rounded-2xl border border-accent-500/40 bg-accent-500/5 p-4 active:opacity-80">
                  <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">
                    {m.display_name ?? 'A member'}
                  </Text>
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    You both said Interested. Say hello when you&apos;re ready.
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {needsReply.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Awaiting your reply
              </Text>
              {needsReply.map(renderConversation)}
            </View>
          )}

          {rest.length > 0 && (
            <View className="gap-3">
              {needsReply.length > 0 && (
                <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                  Conversations
                </Text>
              )}
              {rest.map(renderConversation)}
            </View>
          )}

          {paused.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Paused
              </Text>
              {paused.map(renderConversation)}
            </View>
          )}

          {/* Blueprint's own required Inbox section. A genuinely
              successful outcome, styled distinctly from Paused/Ended/
              Blocked (which are all, in different ways, a conversation
              winding down), the accent color elsewhere in this app marks
              a positive/selected state, reused here for the same
              reason. */}
          {graduated.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Graduated
              </Text>
              {graduated.map(renderConversation)}
            </View>
          )}

          {/* 20260817000000: a real, deliberate closure (Honest Exit),
              distinct from a healthy conversation. Message history stays
              visible for both participants' own reference, same
              precedent Blocked already established below. */}
          {ended.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Ended
              </Text>
              {ended.map(renderConversation)}
            </View>
          )}

          {/* Report & Block: blocked connections stay visible here, not
              deleted, message history remains reachable for the
              blocker's own reference, the thread itself shows it as
              read-only. */}
          {blocked.length > 0 && (
            <View className="gap-3">
              <Text className="text-caption font-semibold uppercase text-stone-400 dark:text-stone-600">
                Blocked
              </Text>
              {blocked.map(renderConversation)}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
