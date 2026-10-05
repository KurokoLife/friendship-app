import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { PUBLIC_PROFILE_COLUMNS, PublicProfileView, type PublicProfile } from '@/components/public-profile-view';
import { ReportModal } from '@/components/report-modal';
import { CAPACITY_ERROR_MESSAGES, reinitiateEndedConnection } from '@/lib/connections';
import {
  connectionHasMutualInterest,
  expressInterest,
  fetchMyInterestIds,
  WAITING_FOR_INTEREST_COPY,
} from '@/lib/safety';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400
const ACCENT_COLOR = '#B5643B'; // accent-500

type ConnectionStatus = 'pending' | 'active' | 'passed';

// Saved and messaged are independent, a person can be both at once, see
// the matching comment in src/app/home.tsx.
type ConnectionState = {
  saved: boolean;
  status: ConnectionStatus | null;
};

// Connection states where a chat is still live and can be opened directly.
const LIVE_STATUSES = new Set([null, 'pending', 'active', 'paused', 'graduated']);

// Other User Profile. The profile itself renders through the shared
// PublicProfileView (docs/DECISIONS.md section 2, curiosity first). The
// main action is "Interested" (section 3): a chat only opens once both
// people have said Interested, and one-sided interest is never revealed.
export default function CandidateProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [interested, setInterested] = useState(false);
  // Set when a live connection already has a conversation or mutual
  // interest, so the main button opens the chat instead.
  const [openConnectionId, setOpenConnectionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>({ saved: false, status: null });
  const [loaded, setLoaded] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  // 20260817000000: the higher-friction reopening path for a genuinely
  // 'ended' connection. handleInterested never reaches
  // reinitiateEndedConnection directly, it only shows this confirm step;
  // an explicit "Start over" tap here is what actually calls it. Unlike
  // 'inactive', which getOrCreateConnectionId reopens with zero friction.
  const [reinitiateConfirmVisible, setReinitiateConfirmVisible] = useState(false);
  const [reinitiating, setReinitiating] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured || !id) {
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

      const [{ data: profileRow }, { data: connectionRow }, interestIds, { data: anyConnections }] = await Promise.all([
        supabase.from('discovery_profiles').select(PUBLIC_PROFILE_COLUMNS).eq('user_id', id).maybeSingle(),
        supabase
          .from('connections')
          .select('status, saved')
          .eq('user_a_id', user.id)
          .eq('user_b_id', id)
          .maybeSingle(),
        fetchMyInterestIds(),
        supabase
          .from('connections')
          .select('id, status')
          .or(`and(user_a_id.eq.${user.id},user_b_id.eq.${id}),and(user_a_id.eq.${id},user_b_id.eq.${user.id})`),
      ]);

      const live = (anyConnections ?? []).find((c) => LIVE_STATUSES.has(c.status as string | null));
      if (live) {
        const [{ count }, mutual] = await Promise.all([
          supabase.from('messages').select('id', { count: 'exact', head: true }).eq('connection_id', live.id),
          connectionHasMutualInterest(live.id),
        ]);
        if ((count ?? 0) > 0 || mutual) setOpenConnectionId(live.id);
      }

      setProfile(profileRow as PublicProfile | null);
      setInterested(interestIds.has(id));
      setState({
        saved: Boolean(connectionRow?.saved),
        status: (connectionRow?.status as ConnectionStatus | null) ?? null,
      });
      setLoaded(true);
    })();
  }, [id]);

  const upsertConnection = async (fields: { saved?: boolean; status?: ConnectionStatus }) => {
    if (!id) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('connections')
      .upsert(
        { user_a_id: user.id, user_b_id: id, ...fields },
        { onConflict: 'user_a_id,user_b_id' }
      );
  };

  const handleSave = async () => {
    setPendingAction('save');
    await upsertConnection({ saved: true });
    setPendingAction(null);
    setState((prev) => ({ ...prev, saved: true }));
  };

  const handleStatus = async (status: ConnectionStatus) => {
    setPendingAction(status);
    await upsertConnection({ status });
    setPendingAction(null);
    setState((prev) => ({ ...prev, status }));
    if (status === 'passed') {
      router.back();
    }
  };

  const handleInterested = async () => {
    if (!id) return;
    if (openConnectionId) {
      router.push({ pathname: '/thread/[id]', params: { id: openConnectionId } });
      return;
    }
    setPendingAction('interested');
    setError(null);
    setNotice(null);
    const result = await expressInterest(id);
    setPendingAction(null);
    if (result.status === 'mutual') {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else if (result.status === 'waiting') {
      setInterested(true);
      setNotice(WAITING_FOR_INTEREST_COPY);
    } else if (result.status === 'not_verified') {
      router.push('/selfie-check');
    } else if (result.status === 'ended') {
      // A deliberately ended connection needs the separate "Start over"
      // confirmation (20260817000000), not a silent reopen.
      setReinitiateConfirmVisible(true);
    } else {
      setError(result.message);
    }
  };

  const handleReinitiate = async () => {
    if (!id) return;
    setReinitiating(true);
    setError(null);
    const result = await reinitiateEndedConnection(id);
    setReinitiating(false);
    setReinitiateConfirmVisible(false);
    if (result.ok) {
      router.push({ pathname: '/thread/[id]', params: { id: result.connectionId } });
    } else {
      setError(CAPACITY_ERROR_MESSAGES[result.error]);
    }
  };

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900 px-6">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That profile isn&apos;t available anymore.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center justify-between px-6 pt-10">
          <Pressable onPress={() => router.back()}>
            <Text className="text-caption text-stone-500 dark:text-stone-400">Back</Text>
          </Pressable>
          {/* Report & Block, reachable from the Other User Profile screen
              independent of the primary action row below. */}
          <View className="flex-row gap-4">
            <Pressable onPress={() => setReportModalVisible(true)}>
              <Text className="text-caption text-stone-500 dark:text-stone-400">Report</Text>
            </Pressable>
            <Pressable onPress={() => setBlockConfirmVisible(true)}>
              <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerClassName="px-6 pb-6 pt-5">
          <PublicProfileView profile={profile} />
        </ScrollView>

        <View className="gap-2 border-t border-stone-200 bg-stone-50 px-6 pb-6 pt-4 dark:border-stone-800 dark:bg-stone-900">
          {error && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">{error}</Text>
          )}
          {notice && <Text className="text-caption text-stone-500 dark:text-stone-400">{notice}</Text>}
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => handleStatus('passed')}
              disabled={pendingAction === 'passed'}
              className="flex-1 items-center rounded-full border border-stone-300 py-3 active:opacity-70 dark:border-stone-600">
              <Text className="text-caption font-semibold text-stone-600 dark:text-stone-300">
                Not for me
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={state.saved || pendingAction === 'save'}
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-full border py-3 active:opacity-70 ${
                state.saved ? 'border-accent-500 bg-accent-500' : 'border-stone-300 dark:border-stone-600'
              }`}>
              {state.saved && <Ionicons name="checkmark" size={14} color="#fff" />}
              <Text
                className={`text-caption font-semibold ${
                  state.saved ? 'text-white' : 'text-stone-600 dark:text-stone-300'
                }`}>
                {state.saved ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleInterested}
              disabled={(interested && !openConnectionId) || pendingAction === 'interested'}
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-3 active:opacity-80 ${
                interested && !openConnectionId ? 'border border-accent-500' : 'bg-stone-900 dark:bg-stone-50'
              }`}>
              {interested && !openConnectionId && <Ionicons name="checkmark" size={14} color={ACCENT_COLOR} />}
              <Text
                className={`text-caption font-semibold ${
                  interested && !openConnectionId ? 'text-accent-500' : 'text-stone-50 dark:text-stone-900'
                }`}>
                {openConnectionId ? 'Open chat' : 'Interested'}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      {id && (
        <ReportModal
          visible={reportModalVisible}
          onClose={() => setReportModalVisible(false)}
          reportedId={id}
          connectionId={null}
          otherName={profile.display_name ?? 'this person'}
        />
      )}

      {id && (
        <BlockConfirmModal
          visible={blockConfirmVisible}
          onClose={() => setBlockConfirmVisible(false)}
          onBlocked={() => {
            setBlockConfirmVisible(false);
            // The blocker shouldn't keep seeing this profile once
            // blocked (discovery/browse already exclude it going
            // forward), same reasoning "Not for me" already uses.
            router.back();
          }}
          blockedId={id}
          otherName={profile.display_name ?? 'this person'}
        />
      )}

      <Modal
        visible={reinitiateConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReinitiateConfirmVisible(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-sm gap-4 rounded-3xl bg-white p-6 dark:bg-stone-800">
            <Text className="text-title text-stone-900 dark:text-stone-50">Start over with this connection?</Text>
            <Text className="text-body text-stone-600 dark:text-stone-400">
              This connection was deliberately ended, not paused or auto-closed. Starting a new
              conversation is a real, separate choice, not the same as picking up where you left off.
            </Text>
            {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}
            <View className="flex-row justify-end gap-4">
              <Pressable
                onPress={() => setReinitiateConfirmVisible(false)}
                disabled={reinitiating}
                className="items-center py-2">
                <Text className="text-body font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleReinitiate}
                disabled={reinitiating}
                className={`rounded-full bg-stone-900 px-5 py-2 active:opacity-80 dark:bg-stone-50 ${
                  reinitiating ? 'opacity-40' : ''
                }`}>
                <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                  {reinitiating ? 'Starting over...' : 'Start over'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
