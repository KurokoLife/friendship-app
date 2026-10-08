import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { DEV_SEED_USERS } from '@/lib/dev-tools';
import { supabase } from '@/lib/supabase';

// Test mode (2026-10-07): lets an admin act as one of the fake test
// accounts on the live site, then come back to their own account without
// signing in again.
//
// How it works:
// 1. While still signed in as the admin, ask dev-create-session for a
//    one-time sign-in token for the test account. The function checks on
//    the server that the caller is an admin (or already a test account).
// 2. Save the admin's own session on this device and sign in as the test
//    account. The admin's session is never signed out (that would end it
//    on the server), so it can be restored later.
// 3. "Back to my account" restores the saved session.
//
// Only the 9 seed accounts can ever be acted as (enforced in the
// function). The saved session never leaves this device.

const RETURN_KEY = 'limen.testMode.returnSession';
const ACTING_KEY = 'limen.testMode.actingAs';

type SavedSession = { access_token: string; refresh_token: string };

export async function getActingAs(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(ACTING_KEY);
  } catch {
    return null;
  }
}

export async function actAsTestAccount(phone: string): Promise<{ error: string | null }> {
  const seed = DEV_SEED_USERS.find((u) => u.phone === phone);
  if (!seed) return { error: 'That is not a test account.' };

  const { data: sessionData } = await supabase.auth.getSession();
  const current = sessionData.session;

  // Step 1: ask for the token while the current (admin or test) session is
  // still active, so the function can check who is asking.
  const { data, error: fnError } = await supabase.functions.invoke('dev-create-session', { body: { phone } });
  if (fnError || !data?.tokenHash) {
    let message = data?.error as string | undefined;
    if (!message && fnError) {
      try {
        const body = await (fnError as { context?: Response }).context?.json();
        message = body?.error;
      } catch {
        message = undefined;
      }
    }
    return { error: message ?? 'Could not switch accounts. Only admins can use test accounts.' };
  }

  // Step 2: remember the real account the first time we leave it.
  const alreadyActing = await getActingAs();
  if (!alreadyActing && current) {
    const saved: SavedSession = { access_token: current.access_token, refresh_token: current.refresh_token };
    await AsyncStorage.setItem(RETURN_KEY, JSON.stringify(saved));
  }

  // Only sign out (which ends that session on the server) when leaving
  // another TEST account. Leaving the admin's own account must not sign it
  // out: signing out ends the saved session too, which made "Back to my
  // account" fail and ask for the phone number again (bug fixed
  // 2026-10-08). Signing in as the test account simply replaces it here.
  if (alreadyActing) await supabase.auth.signOut({ scope: 'local' });
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash });
  if (verifyError) {
    // Put the real account back if the switch failed.
    await returnToMyAccount();
    return { error: verifyError.message };
  }
  await AsyncStorage.setItem(ACTING_KEY, seed.displayName);
  return { error: null };
}

export async function returnToMyAccount(): Promise<{ error: string | null }> {
  let saved: SavedSession | null = null;
  try {
    const raw = await AsyncStorage.getItem(RETURN_KEY);
    saved = raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    saved = null;
  }
  await supabase.auth.signOut({ scope: 'local' });
  await AsyncStorage.multiRemove([RETURN_KEY, ACTING_KEY]).catch(() => undefined);
  if (!saved) return { error: 'Your own account was not saved on this device. Please sign in again.' };
  const { error } = await supabase.auth.setSession(saved);
  if (error) return { error: 'Your session expired. Please sign in again.' };
  return { error: null };
}

// Who may see the Test tab: developers running locally, admins, and an
// admin who is currently acting as a test account.
//
// One shared state for every screen that asks (the tab bar, the Test
// screen, the banner), refreshed on each sign-in change. Uses the locally
// stored session (getSession) rather than a network call, and a sequence
// number so an older, slower check can never overwrite a newer one.
type TestToolsState = { allowed: boolean; actingAs: string | null; checked: boolean };
let sharedState: TestToolsState = { allowed: __DEV__, actingAs: null, checked: false };
const listeners = new Set<(s: TestToolsState) => void>();
let refreshSeq = 0;
let authSubscribed = false;

async function refreshTestTools() {
  const seq = ++refreshSeq;
  const acting = await getActingAs();
  let isAdmin = false;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId) {
    const { data: row } = await supabase.from('users').select('is_admin').eq('id', userId).maybeSingle();
    isAdmin = Boolean(row?.is_admin);
  }
  if (seq !== refreshSeq) return;
  sharedState = { allowed: __DEV__ || isAdmin || Boolean(acting), actingAs: acting, checked: true };
  listeners.forEach((l) => l(sharedState));
}

export function useTestTools(): TestToolsState {
  const [state, setState] = useState<TestToolsState>(sharedState);

  useEffect(() => {
    listeners.add(setState);
    if (!authSubscribed) {
      authSubscribed = true;
      // setTimeout: supabase calls must not run inside the auth callback itself.
      supabase.auth.onAuthStateChange(() => {
        setTimeout(refreshTestTools, 0);
      });
    }
    refreshTestTools();
    return () => {
      listeners.delete(setState);
    };
  }, []);

  return state;
}
