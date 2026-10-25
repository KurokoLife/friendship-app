import { Redirect } from 'expo-router';

// Settings lives in the You tab since 2026-10-25 (Profile | Settings switch,
// docs/context/05_LIMEN_REBUILD.md). This route stays so every existing
// link to /settings lands there.
export default function SettingsRedirect() {
  return <Redirect href={{ pathname: '/profile', params: { view: 'settings' } }} />;
}
