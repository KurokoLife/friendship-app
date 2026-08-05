import { supabase } from '@/lib/supabase';

// Path 1 (contextual surfacing): a future feature that wants to show a
// module as a brief interstitial at the relevant moment (see each module's
// `contextTrigger` in modules-data.ts) should call this first. If it
// returns true, skip straight to the real action, the module has already
// been shown once and should never interrupt that flow again. If false,
// navigate to `/module/[id]` with this module's id, then let the user
// continue into the original action once they're back.
//
// No feature calls this yet, F20 (reciprocity awareness), F23 (activity
// suggestions), and F29 (honest exit) don't exist yet either. This exists
// so that whoever builds those next has the completion check ready rather
// than reinventing it.
export async function hasCompletedModule(moduleId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('users')
    .select('etiquette_modules')
    .eq('id', user.id)
    .maybeSingle();
  const completed = (data?.etiquette_modules as Record<string, boolean>) ?? {};
  return Boolean(completed[moduleId]);
}
