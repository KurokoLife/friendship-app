import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

// Changes whenever a different account signs in on this device (2026-10-09).
// The tab screens stay mounted between visits, so after switching accounts
// (Test tab "Act as", "Back to my account") they briefly showed the previous
// account's chats. Tapping one opened "That conversation isn't available".
// The tab bar uses this as its key, so every tab starts fresh for the new
// account. Signing out alone doesn't change it; only a different account
// signing in does.
export function useAccountKey(): string {
  const [key, setKey] = useState(0);

  useEffect(() => {
    let current: string | undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id;
      if (!id) return;
      if (current === undefined) {
        current = id;
        return;
      }
      if (id !== current) {
        current = id;
        setKey((k) => k + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return String(key);
}
