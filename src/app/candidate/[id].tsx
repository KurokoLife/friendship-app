import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachMark } from '@/components/coach-mark';
import { BlockConfirmModal } from '@/components/block-confirm-modal';
import { PUBLIC_PROFILE_COLUMNS, PublicProfileView, type PublicProfile } from '@/components/public-profile-view';
import { SharedFriendshipAnswers } from '@/components/shared-friendship-answers';
import { fetchConnectionCareStyle } from '@/lib/care-style';
import { fetchConnectedFriendshipAnswers, type FriendshipExperience } from '@/lib/friendship-experience';
import { ReportModal } from '@/components/report-modal';
import { CAPACITY_ERROR_MESSAGES, reinitiateEndedConnection } from '@/lib/connections';
import {
  connectionHasMutualInterest,
  expressInterest,
  lastActionErrorDetail,
  fetchMyInterestIds,
  SAVED_FULL_COPY,
  interestSavedCopy,
  saveForLater,
  waitingForInterestCopy,
} from '@/lib/safety';
import { useTestTools } from '@/lib/test-mode';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';
import { palette } from '@/theme';
import { CirclePickerSheet } from '@/components/circle-picker';
import { Face, RowLink } from '@/components/ui';
import { CIRCLE_LABELS, fetchMyPeople, moveLimenPerson, waitingLine, type LimenPerson } from '@/lib/circle';
import { fetchMyPending, type PendingPerson } from '@/lib/safety';

const MUTED_ICON_COLOR = palette.muted;
const ACCENT_COLOR = palette.link;

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
  // Their shared "How you connect" answers: only when you have a chat with
  // them and they chose to share (the server checks both).
  const [sharedAnswers, setSharedAnswers] = useState<FriendshipExperience | null>(null);
  // Their "How I like care" words: only for people they have a chat with.
  const [careStyle, setCareStyle] = useState<string | null>(null);
  // A past chat that ended or closed (2026-10-09). The old "Interested"
  // choices are still on file, so the button showed "Interested" as already
  // done and nothing could be tapped. It now offers "Say hello again".
  const [pastChat, setPastChat] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<ConnectionState>({ saved: false, status: null });
  const [loaded, setLoaded] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const { allowed: testTools } = useTestTools();
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [blockConfirmVisible, setBlockConfirmVisible] = useState(false);
  // 20260817000000: the higher-friction reopening path for a genuinely
  // 'ended' connection. handleInterested never reaches
  // reinitiateEndedConnection directly, it only shows this confirm step;
  // an explicit "Start over" tap here is what actually calls it. Unlike
  // 'inactive', which getOrCreateConnectionId reopens with zero friction.
  const [reinitiateConfirmVisible, setReinitiateConfirmVisible] = useState(false);
  const [reinitiating, setReinitiating] = useState(false);
  // Your circle (2026-10-25): which circle this person is in for you, and
  // moving them, live on their own page (design guide v1).
  const [inCircle, setInCircle] = useState<LimenPerson | null>(null);
  const [waiting, setWaiting] = useState<PendingPerson | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const loadCircle = useCallback(async () => {
    if (!isSupabaseConfigured || !id) return;
    const [people, pending] = await Promise.all([fetchMyPeople(), fetchMyPending()]);
    setInCircle(people.find((p) => p.other_user_id === id) ?? null);
    setWaiting(pending.find((p) => p.other_user_id === id && p.state !== 'closed') ?? null);
  }, [id]);

  useEffect(() => {
    loadCircle();
  }, [loadCircle]);

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

      if ((anyConnections ?? []).length > 0) fetchConnectedFriendshipAnswers(id).then(setSharedAnswers);
      const live = (anyConnections ?? []).find((c) => LIVE_STATUSES.has(c.status as string | null));
      const anyChat = (anyConnections ?? []).find((c) => c.status);
      // 2026-10-24: care words no longer shown (question removed).
      void anyChat;
      setPastChat(!live && (anyConnections ?? []).some((c) => c.status === 'ended' || c.status === 'inactive'));
      if (live) {
        const [{ count }, mutual] = await Promise.all([
          supabase.from('messages').select('id', { count: 'exact', head: true }).eq('connection_id', live.id),
          connectionHasMutualInterest(live.id),
        ]);
        if ((count ?? 0) > 0 || mutual) setOpenConnectionId(live.id);
      }

      // Someone you already had a chat with may no longer match your search
      // filters (distance, age range, a changed preference). Their profile
      // still opens, so "Visit their profile to say hello again" works
      // (2026-10-09). Blocked either way still hides it.
      let shownProfile = profileRow as PublicProfile | null;
      if (!shownProfile && (anyConnections ?? []).length > 0) {
        const { data: connectedRow } = await supabase
          .from('connected_profiles')
          .select(PUBLIC_PROFILE_COLUMNS)
          .eq('user_id', id)
          .maybeSingle();
        shownProfile = connectedRow as PublicProfile | null;
      }
      setProfile(shownProfile);
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

  // At most 5 saved, each for 30 days (2026-10-10).
  const handleSave = async () => {
    if (!id) return;
    setPendingAction('save');
    setNotice(null);
    const result = await saveForLater(id);
    setPendingAction(null);
    if (result === 'full') {
      setNotice(SAVED_FULL_COPY);
      return;
    }
    if (result === 'error') {
      setError('Something went wrong. Please try again.');
      setErrorDetail(lastActionErrorDetail());
      return;
    }
    setErrorDetail(null);
    setState((prev) => ({ ...prev, saved: true }));
  };

  const handleStatus = async (status: ConnectionStatus) => {
    setPendingAction(status);
    await upsertConnection({ status });
    setPendingAction(null);
    setState((prev) => ({ ...prev, status }));
    if (status === 'passed') {
      goBack('/home');
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
      setNotice(interestSavedCopy((profile?.display_name ?? 'They').split(' ')[0], result));
    } else if (result.status === 'ended') {
      // A deliberately ended connection needs the separate "Start over"
      // confirmation (20260817000000), not a silent reopen.
      setReinitiateConfirmVisible(true);
    } else {
      setError(result.message);
      setErrorDetail(lastActionErrorDetail());
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
      <View className="flex-1 items-center justify-center gap-4 bg-stone-50 px-6 dark:bg-stone-900">
        <Text className="text-center text-body text-stone-500 dark:text-stone-400">
          That profile isn&apos;t available anymore.
        </Text>
        <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={() => goBack('/home')}>
          <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-stone-50 dark:bg-stone-900">
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center justify-between px-6 pt-10">
          <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={() => goBack('/home')}>
            <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Back</Text>
          </Pressable>
          {/* Report & Block, reachable from the Other User Profile screen
              independent of the primary action row below. */}
          <View className="flex-row gap-4">
            <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600" onPress={() => setReportModalVisible(true)}>
              <Text className="text-caption font-semibold text-stone-900 dark:text-stone-50">Report</Text>
            </Pressable>
            <Pressable className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-red-200 dark:border-red-900" onPress={() => setBlockConfirmVisible(true)}>
              <Text className="text-caption font-semibold text-red-600 dark:text-red-400">Block</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
          <CoachMark
            markKey="profile_view"
            title="Notice something?"
            text="See something you'd like to ask about? Tap Note it privately and write it down. Only you see it, and it'll be there when you start chatting."
          />
          {inCircle && (
            <View className="gap-2">
              <RowLink
                title={`In your circle: ${CIRCLE_LABELS[inCircle.circle]}`}
                subtitle="Move to another circle"
                accessibilityLabel={`In your circle: ${CIRCLE_LABELS[inCircle.circle]}. Move to another circle`}
                left={<Face name={profile.display_name ?? 'Someone'} photoUrl={profile.photo_url} circle={inCircle.circle} />}
                onPress={() => {
                  setMoveError(null);
                  setMoving(true);
                }}
              />
              {waiting && <Text className="text-caption text-stone-500 dark:text-stone-400">{waitingLine(waiting)}</Text>}
              <CirclePickerSheet
                visible={moving}
                name={profile.display_name ?? 'Someone'}
                current={inCircle.circle}
                busy={moveBusy}
                error={moveError}
                note="Limen also moves people on its own when something changes, like a friendship you both decide to keep going outside Limen."
                onClose={() => setMoving(false)}
                onPick={async (c) => {
                  setMoveBusy(true);
                  const ok = await moveLimenPerson(inCircle.other_user_id, c);
                  setMoveBusy(false);
                  if (!ok) {
                    setMoveError("That didn't save. Please try again.");
                    return;
                  }
                  setMoving(false);
                  loadCircle();
                }}
              />
            </View>
          )}
          <PublicProfileView
            profile={profile}
            afterHeader={
              careStyle || sharedAnswers ? (
                <>
              {/* 2026-10-23: for people you have a chat with, how they like care
                  and how they approach new friendships come first (they used to
                  sit in the chat header). The server only returns them then. */}
              {careStyle && (
                <View className="gap-1 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800">
                  <Text className="text-title text-stone-900 dark:text-stone-50">
                    How {(profile.display_name ?? 'they').split(' ')[0]} likes care
                  </Text>
                  <Text className="text-body text-stone-700 dark:text-stone-300">“{careStyle}”</Text>
                </View>
              )}
              {sharedAnswers && (
                <SharedFriendshipAnswers answers={sharedAnswers} name={(profile.display_name ?? 'They').split(' ')[0]} />
              )}
                </>
              ) : null
            }
          />
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
              disabled={(interested && !openConnectionId && !pastChat) || pendingAction === 'interested'}
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-3 active:opacity-80 ${
                interested && !openConnectionId && !pastChat ? 'border border-accent-500' : 'bg-apricot'
              }`}>
              {interested && !openConnectionId && !pastChat && <Ionicons name="checkmark" size={14} color={ACCENT_COLOR} />}
              <Text
                className={`text-caption font-semibold ${
                  interested && !openConnectionId && !pastChat ? 'text-accent-500 dark:text-accent-400' : 'text-white'
                }`}>
                {openConnectionId ? 'Open chat' : pastChat ? 'Say hello again' : 'Interested'}
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
            goBack('/home');
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
            {error && testTools && errorDetail && (
              <Text className="text-[11px] text-stone-500 dark:text-stone-400">Details (only admins and test accounts see this): {errorDetail}</Text>
            )}
            <View className="flex-row justify-end gap-4">
              <Pressable
                onPress={() => setReinitiateConfirmVisible(false)}
                disabled={reinitiating}
                className="min-h-11 flex-row items-center justify-center rounded-full border px-4 active:opacity-70 border-outline dark:border-stone-600">
                <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleReinitiate}
                disabled={reinitiating}
                className={`rounded-full bg-apricot px-5 py-2 active:opacity-80 dark:bg-apricot ${
                  reinitiating ? 'opacity-40' : ''
                }`}>
                <Text className="text-caption font-semibold text-white">
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
