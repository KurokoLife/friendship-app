import { supabase } from '@/lib/supabase';

// The newest database update this version of the app needs (2026-10-10).
// Bump together with limen_db_version() in the newest migration.
export const REQUIRED_DB_VERSION = '20261028000001';

// Database updates the Test tab points to when something is missing, in the
// order to run them. Each one is safe to run again.
export const RECENT_DB_UPDATES = [
  '20261008000000_meetup_plans.sql',
  '20261008000001_names_live_plans_meetup_tests.sql',
  '20261008000002_reminders_meetups_test_tools.sql',
  '20261009000000_places_pace_profiles.sql',
  '20261009000001_reconnect_hello_pause.sql',
  '20261009000002_pause_note_selfie_once_fill_chats.sql',
  '20261009000003_selfie_approved_only.sql',
  '20261009000004_plan_together.sql',
  '20261009000005_plan_save_and_match.sql',
  '20261009000006_plan_one_turn_meet_nudges.sql',
  '20261010000000_plan_invites_meetup_tracking.sql',
  '20261010000001_quieter_reminders_check_ins.sql',
  '20261010000002_share_reminder.sql',
  '20261010000003_remember_in_chat.sql',
  '20261010000004_meetup_answer_free_notes.sql',
  '20261010000005_discover_daily_saved_inbox.sql',
  '20261012000000_discover_why.sql',
  '20261013000000_graduation_no_pace.sql',
  '20261014000000_pending_interests.sql',
  '20261014000001_reset_clears_preferences.sql',
  '20261014000002_summary_and_break.sql',
  '20261017000000_more_tips.sql',
  '20261018000000_shared_language_required.sql',
  '20261022000000_five_year_age_ranges.sql',
  '20261022000001_share_friendship_answers.sql',
  '20261022000002_meetups_waiting_private_drafts.sql',
  '20261023000000_profile_notes_editable.sql',
  '20261025000000_your_people.sql',
  '20261025000001_circle_faces.sql',
  '20261026000000_circle_person_page.sql',
  '20261026000001_joining.sql',
  '20261027000000_meet_offer_not_now.sql',
  '20261028000000_circle_suggestions.sql',
  '20261028000001_notifications.sql',
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
