import { supabase } from '@/lib/supabase';

// "Your connection summary" (renamed 2026-10-14 from "personality
// reflection"): a short summary written from the person's own "How you
// connect" answers. Saved once so it reads the same every time; retaking
// the questions replaces it. Private, never used for matching.
export type ConnectionSummary = {
  connectionStyle: string;
  whatHelped: string;
  whenUncertain: string;
  created_at: string;
};

export async function saveConnectionSummary(s: Omit<ConnectionSummary, 'created_at'>): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('profiles')
    .update({ connection_summary: { ...s, created_at: new Date().toISOString() } })
    .eq('user_id', user.id);
}

export function readConnectionSummary(value: unknown): ConnectionSummary | null {
  const v = value as Partial<ConnectionSummary> | null;
  if (!v?.connectionStyle || !v.whatHelped || !v.whenUncertain) return null;
  return v as ConnectionSummary;
}
