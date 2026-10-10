import { supabase } from '@/lib/supabase';

// Reminder settings (2026-10-10). Each person can turn these off for all
// chats (Settings) or for one chat. Something is on unless it's turned off
// in either place. The one gentle note when someone said hello and hasn't
// heard back yet can't be turned off: it protects the person waiting, and
// it only ever shows once.

export type PromptKind = 'check_in' | 'meet_nudge' | 'morning_of' | 'calendar' | 'guides' | 'notes';

export const PROMPT_KINDS: PromptKind[] = ['check_in', 'meet_nudge', 'morning_of', 'calendar', 'guides', 'notes'];

export const PROMPT_LABELS: Record<PromptKind, { title: string; detail: string }> = {
  check_in: {
    title: 'Check-ins',
    detail: 'After a chat has been quiet for 5 days, a private note that you could say hi. Never "your turn".',
  },
  meet_nudge: {
    title: 'Nudges to meet in person',
    detail: 'Every few weeks without meeting, a private question about planning something.',
  },
  morning_of: {
    title: 'Morning-of check',
    detail: 'On the day of a meetup, a private "how are you feeling?" with support if you\'re nervous.',
  },
  calendar: {
    title: 'Calendar question',
    detail: 'When a plan is agreed or changes, asks if you want to add it to your calendar.',
  },
  guides: {
    title: 'Short guides',
    detail: 'Now and then, an offer to watch a short video guide.',
  },
  notes: {
    title: 'Your notes coming back',
    detail: 'After a meetup, asks once if there\'s anything you\'d like to remember. Shows what you wanted to ask next time when you plan or check in.',
  },
};

export type PromptSetting = { all: boolean; chat: boolean };
export type PromptSettings = Record<PromptKind, PromptSetting>;

export const ALL_ON: PromptSettings = {
  check_in: { all: true, chat: true },
  meet_nudge: { all: true, chat: true },
  morning_of: { all: true, chat: true },
  calendar: { all: true, chat: true },
  guides: { all: true, chat: true },
  notes: { all: true, chat: true },
};

export function isOn(settings: PromptSettings | null, kind: PromptKind): boolean {
  if (!settings) return true;
  const s = settings[kind];
  return s.all && s.chat;
}

export async function getPromptSettings(connectionId: string | null): Promise<PromptSettings> {
  const { data, error } = await supabase.rpc('get_prompt_settings', { p_connection_id: connectionId });
  if (error || !data) return ALL_ON;
  return { ...ALL_ON, ...(data as Partial<PromptSettings>) };
}

// connectionId null = all chats.
export async function setPromptSetting(connectionId: string | null, kind: PromptKind, enabled: boolean): Promise<boolean> {
  const { error } = await supabase.rpc('set_prompt_setting', {
    p_connection_id: connectionId,
    p_kind: kind,
    p_enabled: enabled,
  });
  return !error;
}
