import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getSeenCoachMarks, markCoachMarkSeen, type CoachMarkKey } from '@/lib/coach-marks';
import { supabase } from '@/lib/supabase';

type Props = {
  connectionId: string;
  myId: string;
  // The single active primary intervention's type, or null/undefined if
  // none -- exactly what get_active_intervention() already returns, no
  // separate fetch needed here.
  currentInterventionType: string | null | undefined;
};

type VideoOffer = {
  markKey: CoachMarkKey;
  guideId: string;
  prompt: string;
};

// Video trigger/placement architecture, 2026-08-11. Handles Videos 2, 4, 5
// -- the ones whose trigger data (friendship_stage, the viewer's own
// private reflection, the current primary intervention type) is naturally
// available at the thread-screen level, in the SAME render block that
// excludes blocked/inactive/ended connections (matching every primary
// intervention's own exclusion). Video 7 (ended) is NOT handled here on
// purpose: the block this card is meant to render inside structurally
// excludes 'ended' connections, so an ended-only trigger could never fire
// from here -- see EndedConnectionVideoLink below instead, attached to the
// always-rendered "this connection was deliberately ended" banner. Video 1
// has no dismissible contextual surfacing (mandatory onboarding + always
// in Guide). Video 3 is attached directly inside NextMeetupIndicatorV2
// (already the established ambient, outside-the-queue home for meetup
// status, design doc §6a). Video 6 is attached inline inside
// PrimaryInterventionCard's own PreMeetupSupport, since its trigger is
// that card's own local state.
//
// This is explicitly NOT a second priority-intervention system: at most
// ONE video offer renders, chosen by a fixed, simple, documented order
// (most specific/conclusive situation first), always rendered visually
// BELOW/AFTER PrimaryInterventionCard, never replacing or outranking it.
// In practice these conditions are close to mutually exclusive by
// connection lifecycle stage (early conversation vs. an active restart
// prompt vs. an open post-meetup reflection), so the fixed order is a
// tie-break for the rare overlap case, not a real competing priority
// engine.
export function VideoGuidanceCard({ connectionId, myId, currentInterventionType }: Props) {
  const [offer, setOffer] = useState<VideoOffer | null>(null);
  const [dismissedKey, setDismissedKey] = useState<CoachMarkKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = await resolveVideoGuidance(connectionId, myId, currentInterventionType ?? null);
      if (!cancelled) setOffer(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, myId, currentInterventionType]);

  if (!offer || offer.markKey === dismissedKey) return null;

  const dismiss = async () => {
    await markCoachMarkSeen(offer.markKey);
    setDismissedKey(offer.markKey);
  };

  return (
    <View className="mx-6 mt-3 flex-row flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-700 dark:bg-stone-800/50">
      <Text className="flex-1 text-caption text-stone-500 dark:text-stone-400">{offer.prompt}</Text>
      <Pressable
        onPress={() => {
          dismiss();
          router.push({ pathname: '/guide/[id]', params: { id: offer.guideId } });
        }}>
        <Text className="text-caption font-semibold text-accent-500">Watch</Text>
      </Pressable>
      <Pressable onPress={dismiss}>
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
      </Pressable>
    </View>
  );
}

async function resolveVideoGuidance(
  connectionId: string,
  myId: string,
  currentInterventionType: string | null
): Promise<VideoOffer | null> {
  const seen = await getSeenCoachMarks();

  // Video 5 (restart) is not offered: that video hasn't been made yet, and
  // the link opened "That guide isn't available" (found 2026-10-08).

  // Video 4: this connection's first occurred meetup, and the viewer's OWN
  // private reflection for it indicates openness to continuing. Never
  // reads or infers anything about the other participant's reflection --
  // this table is self-row RLS, the query below can only ever return the
  // caller's own row regardless.
  if (!seen.has('video_friendship_grows')) {
    const { data: firstMeetup } = await supabase
      .from('meetups')
      .select('id, status')
      .eq('connection_id', connectionId)
      .eq('status', 'occurred')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstMeetup) {
      const { data: reflection } = await supabase
        .from('private_post_meetup_reflections')
        .select('response')
        .eq('connection_id', connectionId)
        .eq('user_id', myId)
        .eq('meetup_id', firstMeetup.id)
        .maybeSingle();
      if (reflection?.response === 'know_better' || reflection?.response === 'open_to_another') {
        return {
          markKey: 'video_friendship_grows',
          guideId: 'guide_friendship_grows',
          prompt: 'Friendship tends to grow a little at a time, if that framing is useful.',
        };
      }
    }
  }

  // Video 2: viewer's first real conversation stage, on any connection.
  // friendship_stage null or 'first_contact' means no genuine back-and-
  // forth has happened here yet -- checked last, the least specific/most
  // broadly-true condition of the four.
  if (!seen.has('video_show_up')) {
    const { data: conn } = await supabase
      .from('connections')
      .select('friendship_stage')
      .eq('id', connectionId)
      .maybeSingle();
    if (conn?.friendship_stage && conn.friendship_stage !== 'first_contact') {
      return {
        markKey: 'video_show_up',
        guideId: 'module_show_up',
        prompt: 'A short guide on showing up for a new connection, if it helps.',
      };
    }
  }

  return null;
}

// Video 7 ("When a Friendship Changes or Ends"). Standalone, not part of
// VideoGuidanceCard above: that component lives inside the render block
// that structurally excludes 'ended' connections (matching every primary
// intervention's own exclusion), so a trigger that only fires ON 'ended'
// could never reach it. Attached instead to thread/[id].tsx's own
// always-rendered "this connection was deliberately ended" banner, which
// already shows for both Honest Exit entry points (the standalone header
// "End" button and the no-ghost R2/R3 escalation card's "End connection
// instead"), so this single attachment point covers both. Never shown
// before an urgent safety/block/report action: Report/Block stay in the
// header regardless of this component, completely untouched, and this
// only ever renders AFTER a connection has already reached 'ended', never
// as a gate on reaching it.
export function EndedConnectionVideoLink() {
  // The "ending" video hasn't been made yet; its link opened "That guide
  // isn't available" (found 2026-10-08). Hidden until the video exists.
  return null;
}

export function EndedConnectionVideoLinkWhenVideoExists() {
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSeenCoachMarks().then((s) => {
      if (!cancelled) setSeen(s.has('video_ending'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (seen !== false) return null;

  const dismiss = async () => {
    await markCoachMarkSeen('video_ending');
    setSeen(true);
  };

  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-3 border-t border-stone-200 pt-2 dark:border-stone-700">
      <Text className="text-caption text-stone-400 dark:text-stone-600">A short guide, if it helps.</Text>
      <Pressable
        onPress={() => {
          dismiss();
          router.push({ pathname: '/guide/[id]', params: { id: 'video_ending' } });
        }}>
        <Text className="text-caption font-semibold text-accent-500">Watch</Text>
      </Pressable>
      <Pressable onPress={dismiss}>
        <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Not now</Text>
      </Pressable>
    </View>
  );
}
