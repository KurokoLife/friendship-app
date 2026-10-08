import { Linking, Platform } from 'react-native';

// Shared formatting and calendar helpers for meetup plans (2026-10-08).

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "Sat, Oct 12"
export function formatMeetupDay(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// "10:00 AM" from "10:00"
export function formatMeetupTime(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// "Sat, Oct 12 · 10:00 AM"
export function formatWhen(iso: string, hhmm: string | null | undefined): string {
  const time = formatMeetupTime(hhmm);
  return time ? `${formatMeetupDay(iso)} · ${time}` : formatMeetupDay(iso);
}

// Accepts "10:30", "10:30 am", "7pm", "19:00". Returns "HH:MM" or null.
export function parseTimeInput(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm.startsWith('p') && h !== 12) h += 12;
    if (ampm.startsWith('a') && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function isValidIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = parseIsoDate(text);
  return toIsoDate(d) === text;
}

// Wall-clock time in a given time zone, as a real UTC moment.
function zonedToUtc(iso: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = iso.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return new Date(guess - (asIfUtc - guess));
  } catch {
    return new Date(y, mo - 1, d, h, mi);
  }
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export type CalendarPlan = {
  planId: string; // the plan's first version, so a moved plan keeps one id
  version: number; // how many times it has moved
  date: string;
  startTime: string | null;
  timeZone: string;
  place: string | null;
  activity: string | null;
  otherName: string;
};

const MEETUP_LENGTH_MS = 2 * 60 * 60 * 1000;

function calendarTitle(plan: CalendarPlan): string {
  return plan.activity ? `${plan.activity} with ${plan.otherName}` : `Meet ${plan.otherName}`;
}

function buildIcs(plan: CalendarPlan): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Limen//Meetup//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:limen-${plan.planId}@limen.app`,
    `SEQUENCE:${plan.version}`,
    `DTSTAMP:${icsStamp(new Date())}`,
  ];
  if (plan.startTime) {
    const start = zonedToUtc(plan.date, plan.startTime, plan.timeZone);
    lines.push(`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(new Date(start.getTime() + MEETUP_LENGTH_MS))}`);
  } else {
    const next = parseIsoDate(plan.date);
    next.setDate(next.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${plan.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${toIsoDate(next).replace(/-/g, '')}`);
  }
  lines.push(`SUMMARY:${icsEscape(calendarTitle(plan))}`);
  if (plan.place) lines.push(`LOCATION:${icsEscape(plan.place)}`);
  lines.push('DESCRIPTION:Planned in Limen.', 'END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function googleCalendarUrl(plan: CalendarPlan): string {
  let dates: string;
  if (plan.startTime) {
    const start = zonedToUtc(plan.date, plan.startTime, plan.timeZone);
    dates = `${icsStamp(start)}/${icsStamp(new Date(start.getTime() + MEETUP_LENGTH_MS))}`;
  } else {
    const next = parseIsoDate(plan.date);
    next.setDate(next.getDate() + 1);
    dates = `${plan.date.replace(/-/g, '')}/${toIsoDate(next).replace(/-/g, '')}`;
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: calendarTitle(plan),
    dates,
    details: 'Planned in Limen.',
  });
  if (plan.place) params.set('location', plan.place);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function openGoogleCalendar(plan: CalendarPlan): Promise<void> {
  const url = googleCalendarUrl(plan);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  await Linking.openURL(url);
}

// Web only: downloads an .ics file that Apple Calendar and Outlook open.
// Re-adding a moved plan updates the same event there (same id, higher
// version number).
export function downloadIcs(plan: CalendarPlan): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return false;
  const blob = new Blob([buildIcs(plan)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meetup-${plan.date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
