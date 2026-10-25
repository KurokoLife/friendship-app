import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { normalizeStories } from '@/lib/stories';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { palette } from '@/theme';

const MUTED_ICON_COLOR = palette.muted;

// Root-caused as part of the email-verification infinite-loop bug: this
// screen used to be an unconditional <Redirect href="/philosophy-intro" />
// regardless of session state. Since Supabase's email confirmation link
// (email-verification.tsx) redirects back to this app's plain root, every
// real confirmation click landed here and was sent straight back to
// onboarding's very first screen, discarding all progress, no matter how
// far the user had actually gotten. That was the loop: confirm email,
// land on philosophy-intro, restart, reach email-verification again,
// confirm again, loop.
//
// A signed-in user landing on the bare root has already gotten at least
// through phone verification, so this now checks for a real session and a
// profiles row before ever sending anyone to philosophy-intro.
// profiles.display_name is the first field written after email
// verification (profile-basics.tsx), so its presence is a reliable
// signal for "already past this point", used here rather than building a
// full step-by-step resume tracker, which this bug does not need: a user
// further along than profile-basics lands on /home rather than exactly
// where they left off, a deliberate, smaller scope than modeling every
// later onboarding stage would require.
type ResumeTarget = '/philosophy-intro' | '/circle' | '/profile-basics' | '/start-with-you' | '/profile-build';

export default function Index() {
  const [target, setTarget] = useState<ResumeTarget | null>(null);

  useEffect(() => {
    (async () => {
      if (!isSupabaseConfigured) {
        setTarget('/philosophy-intro');
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setTarget('/philosophy-intro');
        return;
      }

      // A confirmed email only ever becomes known at some later, async
      // point (whenever the user actually clicks the link, email-
      // verification.tsx no longer waits for it), and landing here is
      // exactly when that confirmation becomes visible for the first
      // time. This mirrors what the old, removed verify-email-code.tsx
      // screen used to do on its own success path, just moved to where
      // confirmation is actually observed now.
      if (user.email) {
        const { data: existingUserRow } = await supabase
          .from('users')
          .select('email')
          .eq('id', user.id)
          .maybeSingle();
        if (existingUserRow?.email !== user.email) {
          await supabase.from('users').upsert({ id: user.id, email: user.email });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, life_transitions_other, stories, activity_interests')
        .eq('user_id', user.id)
        .maybeSingle();

      // 2026-10-19: joining order is sign-up, Basics, then "Start with you",
      // then the rest. Someone who stopped before Basics goes back there.
      // Someone still joining (readiness_status is only set at "Before you
      // start") goes back to "Start with you" until they've picked any
      // interests, with what they already wrote filled in from their account
      // (so they can finish on another device), and to the profile builder
      // after that. A member who finished joining is never sent back.
      if (!profile?.display_name) {
        setTarget('/profile-basics');
        return;
      }
      const { data: userRow } = await supabase.from('users').select('readiness_status').eq('id', user.id).maybeSingle();
      if (!userRow?.readiness_status) {
        const interests = profile.activity_interests as { categories?: unknown[] } | null;
        const startedBuilder = Array.isArray(interests?.categories) && interests.categories.length > 0;
        const hasStory = normalizeStories(profile.stories).some((s) => s.text.trim());
        const startDone = !!profile.life_transitions_other?.trim() && hasStory;
        setTarget(startDone && startedBuilder ? '/profile-build' : '/start-with-you');
        return;
      }

      // 2026-10-25 (rebuild stage 1): every member who finished joining
      // lands in Your circle, the home tab.
      setTarget('/circle');
    })();
  }, []);

  if (!target) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-50 dark:bg-stone-900">
        <ActivityIndicator color={MUTED_ICON_COLOR} />
      </View>
    );
  }

  return <Redirect href={target} />;
}
