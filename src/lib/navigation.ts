import { router, type Href } from 'expo-router';

// Back that always goes somewhere (2026-10-09). router.back() does nothing
// when there is no earlier screen, for example after a page refresh on the
// web or when a screen was opened directly, which made some Back links
// look broken. Falls back to a sensible screen instead.
export function goBack(fallback: Href = '/home') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
