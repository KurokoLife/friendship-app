import { supabase } from '@/lib/supabase';

// "Let's plan something": a shared planning card. See
// supabase/migrations/20261009000004_plan_together.sql for the rules.

export type PlanPart = 'morning' | 'afternoon' | 'evening';
export type PlanBudget = 'free' | 'under_15' | 'under_30' | 'flexible';
export type PlanDuration = 'hour' | 'two_hours' | 'half_day';

export type PlanIdea = {
  id: string;
  source: 'ai' | 'fallback' | 'own';
  added_by: string | null;
  slot: 'easy' | 'both_like' | 'new' | 'own';
  title: string;
  description: string | null;
  cost_label: string | null;
  duration_label: string | null;
  style: 'talk' | 'side_by_side' | 'mix' | null;
  first_meetup_ok: boolean;
  interest_note: string | null;
  home_of: string | null;
  set_number: number;
  picked_by_me: boolean;
  picked_by_other: boolean;
};

export type PlanSlot = { day: string; part: PlanPart };

export type PlanBoard = {
  id: string;
  status: 'open' | 'planned' | 'closed';
  close_reason: 'planned' | 'not_now' | 'quiet' | 'chat_closed' | null;
  closed_by: string | null;
  started_by: string;
  refreshes_left: number;
  chosen_idea_id: string | null;
  chosen_day: string | null;
  chosen_part: PlanPart | null;
  created_at: string;
  last_activity_at: string;
  closes_at: string;
  ideas: PlanIdea[];
  my_times: PlanSlot[];
  other_times: PlanSlot[];
};

export type PlanState = {
  me: string;
  other: string;
  meetup_count: number;
  chat_open: boolean;
  has_upcoming_plan: boolean;
  my_prefs: { budget: PlanBudget; duration: PlanDuration; travel_minutes: number } | null;
  my_home: { can_host: boolean; can_visit: boolean } | null;
  board: PlanBoard | null;
};

export async function getPlanBoard(connectionId: string): Promise<PlanState | null> {
  const { data, error } = await supabase.rpc('get_plan_board', { p_connection_id: connectionId });
  if (error) throw new Error(error.message);
  return (data as PlanState | null) ?? null;
}

export async function startPlanBoard(connectionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_plan_board', { p_connection_id: connectionId });
  if (error) throw new Error(error.message);
  return data as string;
}

// Three new ideas: the AI first, hand-written safe ideas if it isn't
// available. Returns 'limit' once the 10 new sets are used.
export async function loadNewIdeas(boardId: string): Promise<'ok' | 'limit'> {
  try {
    const { data } = await supabase.functions.invoke('plan-ideas', { body: { boardId } });
    if (data?.ok) return 'ok';
    if (data?.error === 'refresh_limit') return 'limit';
  } catch {
    // Use the hand-written ideas below.
  }
  const { error } = await supabase.rpc('plan_add_fallback_ideas', { p_board_id: boardId });
  if (error) {
    if (/refresh_limit/.test(error.message)) return 'limit';
    throw new Error(error.message);
  }
  return 'ok';
}

export async function addOwnIdea(boardId: string, title: string): Promise<void> {
  const { error } = await supabase.rpc('plan_add_own_idea', { p_board_id: boardId, p_title: title });
  if (error) throw new Error(error.message);
}

export async function togglePick(ideaId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_toggle_pick', { p_idea_id: ideaId });
  if (error) throw new Error(error.message);
}

export async function chooseIdea(boardId: string, ideaId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_choose_idea', { p_board_id: boardId, p_idea_id: ideaId });
  if (error) throw new Error(error.message);
}

export async function backToIdeas(boardId: string): Promise<void> {
  const { error } = await supabase.rpc('plan_unchoose', { p_board_id: boardId });
  if (error) throw new Error(error.message);
}

export async function setTimes(boardId: string, slots: PlanSlot[]): Promise<void> {
  const { error } = await supabase.rpc('plan_set_times', { p_board_id: boardId, p_slots: slots });
  if (error) throw new Error(error.message);
}

export async function chooseTime(boardId: string, slot: PlanSlot | null): Promise<void> {
  const { error } = await supabase.rpc('plan_choose_time', {
    p_board_id: boardId,
    p_day: slot?.day ?? null,
    p_part: slot?.part ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function closePlanBoard(boardId: string): Promise<void> {
  const { error } = await supabase.rpc('close_plan_board', { p_board_id: boardId });
  if (error) throw new Error(error.message);
}

export async function setPlanPrefs(budget: PlanBudget, duration: PlanDuration, travelMinutes: number): Promise<void> {
  const { error } = await supabase.rpc('set_plan_prefs', {
    p_budget: budget,
    p_duration: duration,
    p_travel_minutes: travelMinutes,
  });
  if (error) throw new Error(error.message);
}

export async function setHomePref(connectionId: string, canHost: boolean, canVisit: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_plan_home_pref', {
    p_connection_id: connectionId,
    p_can_host: canHost,
    p_can_visit: canVisit,
  });
  if (error) throw new Error(error.message);
}

export type PlanTurn = { waitingOnMe: boolean; closesAt: string };

// Chats with an open planning card (for Inbox).
export async function fetchMyPlanTurns(): Promise<Record<string, PlanTurn>> {
  const { data, error } = await supabase.rpc('my_plan_turns');
  if (error) return {};
  const out: Record<string, PlanTurn> = {};
  for (const row of (data ?? []) as { connection_id: string; waiting_on_me: boolean; closes_at: string }[]) {
    out[row.connection_id] = { waitingOnMe: row.waiting_on_me, closesAt: row.closes_at };
  }
  return out;
}

// ---------------------------------------------------------------------
// Labels and dates
// ---------------------------------------------------------------------

export const BUDGET_OPTIONS: { value: PlanBudget; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'under_15', label: 'Under $15' },
  { value: 'under_30', label: 'Under $30' },
  { value: 'flexible', label: 'Flexible' },
];
export const DURATION_OPTIONS: { value: PlanDuration; label: string }[] = [
  { value: 'hour', label: 'About an hour' },
  { value: 'two_hours', label: '1 to 2 hours' },
  { value: 'half_day', label: 'Half a day' },
];
export const TRAVEL_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min or more' },
];

export const SLOT_LABELS: Record<PlanIdea['slot'], string> = {
  easy: 'Easy',
  both_like: 'An idea for you two',
  new: 'Something new to try',
  own: 'Added idea',
};

export const STYLE_LABELS: Record<NonNullable<PlanIdea['style']>, string> = {
  talk: 'Mostly talking',
  side_by_side: 'Side by side',
  mix: 'Some of both',
};

export const PARTS: PlanPart[] = ['morning', 'afternoon', 'evening'];
export const PART_LABELS: Record<PlanPart, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};
// Start times the plan editor is prefilled with for each part of the day.
export const PART_START_TIME: Record<PlanPart, string> = {
  morning: '10:00',
  afternoon: '14:00',
  evening: '18:00',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The next 14 days, starting tomorrow, as YYYY-MM-DD in local time.
export function nextTwoWeeks(from = new Date()): string[] {
  const days: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    days.push(isoDay(d));
  }
  return days;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLabel(day: string): string {
  return parseDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function longDayLabel(day: string): string {
  return parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// Fills the 2 weeks from the profile's "When you're generally free".
export function usualTimes(availability: string[] | null | undefined, days = nextTwoWeeks()): PlanSlot[] {
  const a = new Set(availability ?? []);
  if (a.size === 0) return [];
  const out: PlanSlot[] = [];
  for (const day of days) {
    const dow = parseDay(day).getDay();
    const weekend = dow === 0 || dow === 6;
    const parts = new Set<PlanPart>();
    if (a.has('Flexible, it varies')) PARTS.forEach((p) => parts.add(p));
    if (weekend && a.has('Weekends')) PARTS.forEach((p) => parts.add(p));
    if (!weekend) {
      if (a.has('Weekday mornings')) parts.add('morning');
      if (a.has('Weekday daytime')) parts.add('afternoon');
      if (a.has('Weekday evenings')) parts.add('evening');
    }
    for (const part of PARTS) if (parts.has(part)) out.push({ day, part });
  }
  return out;
}

export const slotKey = (s: PlanSlot) => `${s.day}|${s.part}`;
