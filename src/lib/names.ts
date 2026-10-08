import { supabase } from '@/lib/supabase';

// Names (2026-10-08): people enter a first and last name. Others only ever
// see the first name and last initial ("Maria S."), stored as display_name
// (also kept in sync by a database trigger). The full last name is private.

export function publicName(first: string, last: string | null | undefined): string {
  const f = first.trim();
  const l = (last ?? '').trim();
  return l ? `${f} ${l[0].toUpperCase()}.` : f;
}

export async function saveProfileName(
  userId: string,
  first: string,
  last: string,
  extra: Record<string, unknown> = {}
): Promise<{ error: { message: string } | null }> {
  const display_name = publicName(first, last);
  const full = { user_id: userId, first_name: first.trim(), last_name: last.trim() || null, display_name, ...extra };
  const { error } = await supabase.from('profiles').upsert(full);
  if (error && /first_name|last_name/.test(error.message)) {
    // Database not updated yet: save the public name only.
    return supabase.from('profiles').upsert({ user_id: userId, display_name, ...extra });
  }
  return { error };
}

export async function loadProfileName(userId: string): Promise<{ first: string; last: string; display: string }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, last_name, display_name')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    const { data: d2 } = await supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
    const display = (d2?.display_name as string | null) ?? '';
    const [first, ...rest] = display.split(' ');
    return { first: first ?? '', last: rest.join(' '), display };
  }
  const display = (data?.display_name as string | null) ?? '';
  if (data?.first_name) return { first: data.first_name as string, last: (data.last_name as string | null) ?? '', display };
  const [first, ...rest] = display.split(' ');
  return { first: first ?? '', last: rest.join(' '), display };
}
