import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

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
type ResumeTarget = '/philosophy-intro' | '/home' | '/inbox' | '/profile-basics';

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
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!profile?.display_name) {
        setTarget('/profile-basics');
        return;
      }

      // Landing-tab default: a fully onboarded user with a real conversation
      // already going should land on Inbox, not Discover. Reusing
      // my_connection_capacity() (Capacity System, already the app's one
      // tested definition of "a real, live connection") rather than the raw
      // connections.status column: literal status = 'active' is barely used
      // live (only ever set by pause-resume/dev-reactivation, not by
      // ordinary connection creation, which defaults to null/'pending'), so
      // checking it alone would miss most genuinely ongoing conversations.
      // active_count requires real bidirectional message exchange;
      // pending_count is a real Say Hi sent (or received) with no reply yet,
      // still something the user would want to see in their Inbox, not a
      // blank slate. Either one being nonzero counts as "has an ongoing
      // conversation" for this decision; a brand-new user with neither
      // lands on Discover instead.
      const { data: capacityRows } = await supabase.rpc('my_connection_capacity');
      const capacity = capacityRows?.[0] as
        | { active_count: number; pending_count: number }
        | undefined;
      const hasOngoingConversation = ((capacity?.active_count ?? 0) + (capacity?.pending_count ?? 0)) > 0;
      setTarget(hasOngoingConversation ? '/inbox' : '/home');
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
