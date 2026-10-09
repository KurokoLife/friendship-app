import { supabase } from '@/lib/supabase';

// The newest database update this version of the app needs (2026-10-09).
// Bump together with limen_db_version() in the newest migration.
export const REQUIRED_DB_VERSION = '20261009000002';

// Database updates the Test tab points to when something is missing, in the
// order to run them. Each one is safe to run again.
export const RECENT_DB_UPDATES = [
  '20261008000000_meetup_plans.sql',
  '20261008000001_names_live_plans_meetup_tests.sql',
  '20261008000002_reminders_meetups_test_tools.sql',
  '20261009000000_places_pace_profiles.sql',
  '20261009000001_reconnect_hello_pause.sql',
  '20261009000002_pause_note_selfie_once_fill_chats.sql',
];

export const MIGRATION_URL_BASE =
  'https://raw.githubusercontent.com/KurokoLife/friendship-app/limen-v2-ethics-alignment/supabase/migrations/';

export async function checkDbVersion(): Promise<{ upToDate: boolean; version: string | null }> {
  const { data, error } = await supabase.rpc('limen_db_version');
  if (error) return { upToDate: false, version: null };
  const version = String(data);
  return { upToDate: version >= REQUIRED_DB_VERSION, version };
}

// Plain-language version of a test tool error.
export function friendlyToolError(message: string): string {
  if (/could not find the function|schema cache|PGRST202/i.test(message)) {
    return "This tool needs a database update that hasn't been run yet. See the yellow note at the top of this page.";
  }
  return message;
}
