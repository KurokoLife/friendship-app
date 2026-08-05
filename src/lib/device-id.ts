import AsyncStorage from '@react-native-async-storage/async-storage';

// Lightweight, app-owned device signal for the fraud-detection work
// (2026-08-01, see migration 20260810000000). Not a security token and
// not a real hardware identifier, no `expo-application`/IDFV-class
// package is installed in this project and adding one is out of scope
// for a "lightweight signal, not a hard block" ask. A random id
// generated once and persisted in AsyncStorage is sufficient for its one
// real job: noticing when the SAME app install completes onboarding for
// more than one account in a short window. Reinstalling the app or
// clearing storage resets it, a known, acceptable limitation for a
// manual-review signal, not a control someone is meant to be unable to
// evade.
const STORAGE_KEY = 'limen_device_id';

function generateId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}`;
}

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = generateId();
  await AsyncStorage.setItem(STORAGE_KEY, id);
  return id;
}
