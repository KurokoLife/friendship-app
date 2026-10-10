import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ActiveIntervention } from '@/lib/friendship-journey';

// Keeps a chat card on screen through a page refresh (2026-10-10).
//
// Some cards save the person's first answer on the server (which puts the
// card away there) and then show a follow-up step, like "Glad it went well.
// Would you like to tell David how it was?". Before, refreshing the page at
// that point lost the follow-up for good. Now the card "holds" its step on
// this device until the person closes it, and the chat shows it again after
// a refresh. Only on this device, only for a few days, and never shared.

const HOLD_DAYS = 3;

export type HeldCard = {
  intervention: ActiveIntervention;
  step: string;
  extra?: Record<string, unknown>;
  savedAt: number;
};

const key = (userId: string, connectionId: string) => `limen.heldCard.${userId}.${connectionId}`;

export async function getHeldCard(userId: string, connectionId: string): Promise<HeldCard | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId, connectionId));
    if (!raw) return null;
    const held = JSON.parse(raw) as HeldCard;
    if (!held?.intervention || !held.step || Date.now() - held.savedAt > HOLD_DAYS * 86400000) {
      await AsyncStorage.removeItem(key(userId, connectionId));
      return null;
    }
    return held;
  } catch {
    return null;
  }
}

export async function holdCard(
  userId: string,
  connectionId: string,
  intervention: ActiveIntervention,
  step: string,
  extra?: Record<string, unknown>
): Promise<void> {
  try {
    const held: HeldCard = { intervention, step, extra, savedAt: Date.now() };
    await AsyncStorage.setItem(key(userId, connectionId), JSON.stringify(held));
  } catch {
    // Best effort: without storage the card still works, it just won't
    // survive a refresh.
  }
}

export async function releaseCard(userId: string, connectionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(userId, connectionId));
  } catch {
    // Nothing to do.
  }
}

// Unsent text in a note editor, so a refresh doesn't lose it.
const draftKey = (target: string) => `limen.noteDraft.${target}`;

export async function loadDraft(target: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(draftKey(target));
  } catch {
    return null;
  }
}

export async function saveDraft(target: string, value: string | null): Promise<void> {
  try {
    if (value === null || value === '') await AsyncStorage.removeItem(draftKey(target));
    else await AsyncStorage.setItem(draftKey(target), value);
  } catch {
    // Best effort.
  }
}
