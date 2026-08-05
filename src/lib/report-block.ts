import { supabase } from '@/lib/supabase';

// Report & Block, safety-critical (AGENTS.md's Missing-From-Original-
// F-Numbering list: 8 categories, Block instantly stops visibility and
// messaging, reporting never requires continued contact, emergency
// guidance for unsafe meetups).
export type ReportCategory =
  | 'fake_identity'
  | 'harassment'
  | 'romantic_sexual_misuse'
  | 'hate'
  | 'scam'
  | 'unsafe_meetup'
  | 'impersonation'
  | 'other';

export const REPORT_CATEGORIES: { key: ReportCategory; label: string; safetyRelevant: boolean }[] = [
  { key: 'fake_identity', label: 'Fake identity', safetyRelevant: false },
  { key: 'harassment', label: 'Harassment', safetyRelevant: true },
  { key: 'romantic_sexual_misuse', label: 'Romantic or sexual misuse', safetyRelevant: true },
  { key: 'hate', label: 'Hate', safetyRelevant: false },
  { key: 'scam', label: 'Scam', safetyRelevant: false },
  { key: 'unsafe_meetup', label: 'Unsafe meetup', safetyRelevant: true },
  { key: 'impersonation', label: 'Impersonation', safetyRelevant: false },
  { key: 'other', label: 'Other', safetyRelevant: false },
];

// Real, publicly published US crisis resources, not invented. Shown only
// for the unsafe_meetup category, per explicit instruction that this
// category needs real emergency guidance rather than a silently logged
// report.
export const EMERGENCY_GUIDANCE = {
  emergency: 'If you are in immediate danger, call 911.',
  resources: [
    { name: 'National Sexual Assault Hotline', phone: '1-800-656-4673' },
    { name: 'National Domestic Violence Hotline', phone: '1-800-799-7233' },
  ],
};

export async function fileReport(
  reportedId: string,
  connectionId: string | null,
  category: ReportCategory,
  detail: string,
  alsoBlock: boolean
): Promise<{ ok: true; reportId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('file_report', {
    p_reported_id: reportedId,
    p_connection_id: connectionId,
    p_category: category,
    p_detail: detail,
    p_also_block: alsoBlock,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, reportId: data as string };
}

export async function blockUser(blockedId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('block_user', { p_blocked_id: blockedId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
