// Supabase Edge Function: send-notifications (2026-10-28, rebuild stage 3b)
//
// Runs every few minutes from Supabase Cron. It:
//   1. starts each person's next Your circle suggestion when it's time
//      (queue_suggestion_notifications, the same rule as the app), and
//   2. sends what's waiting in notification_outbox (notifications_to_send
//      decides who wants what, by type and channel, and holds everything
//      through each person's quiet hours), by
//        - push to the phone app (Expo's push service), and
//        - email (Resend).
// A notification never carries message text: only "New message from Tom",
// "Tom said hello", a plan line, or a suggestion's plain line.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY   the Resend key (without it, no emails; push still works)
//   NOTIFY_FROM      who emails come from, e.g. "Limen <hello@yourdomain.com>"
//   APP_URL          the web address of the app, for links in emails
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Only a caller with the service role key can run it (the Cron job sends it).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('NOTIFY_FROM') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
// Overridable only so the local test copy can point at stand-ins.
const EXPO_PUSH_URL = Deno.env.get('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send';
const RESEND_URL = Deno.env.get('RESEND_URL') ?? 'https://api.resend.com/emails';

type Item = {
  id: string;
  user_id: string;
  type: 'hi' | 'message' | 'plan' | 'suggestion';
  title: string;
  path: string;
  push_tokens: string[] | null;
  email: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Plain, warm, short. The voice guide applies to email too.
function emailHtml(item: Item) {
  const link = APP_URL ? `${APP_URL}${item.path}` : '';
  return `<!doctype html><html><body style="margin:0;background:#FBF7F2;font-family:Figtree,Helvetica,Arial,sans-serif;color:#2A2420">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:18px;line-height:1.5;margin:0 0 24px">${escapeHtml(item.title)}</p>
${link ? `<p style="margin:0 0 32px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#B95A1E;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open Limen</a></p>` : ''}
<p style="font-size:14px;line-height:1.5;color:#6B5F57;margin:0">You can choose which emails you get, or turn them off, in Limen under You, Settings, Notifications.</p>
</div></body></html>`;
}

function emailText(item: Item) {
  const link = APP_URL ? `\n\nOpen Limen: ${APP_URL}${item.path}` : '';
  return `${item.title}${link}\n\nYou can choose which emails you get, or turn them off, in Limen under You, Settings, Notifications.`;
}

async function sendPush(items: Item[]): Promise<{ ok: Set<string>; dead: Set<string>; errors: Map<string, string> }> {
  const ok = new Set<string>();
  const dead = new Set<string>();
  const errors = new Map<string, string>();
  const messages: { to: string; title: string; body: string; data: { path: string }; sound: 'default'; itemId: string }[] = [];
  for (const it of items) {
    for (const to of it.push_tokens ?? []) {
      messages.push({ to, title: 'Limen', body: it.title, data: { path: it.path }, sound: 'default', itemId: it.id });
    }
  }
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch.map(({ itemId: _id, ...m }) => m)),
      });
      const out = await res.json().catch(() => null);
      const tickets: { status: string; details?: { error?: string }; message?: string }[] = out?.data ?? [];
      batch.forEach((m, j) => {
        const t = tickets[j];
        if (t?.status === 'ok') ok.add(m.itemId);
        else {
          if (t?.details?.error === 'DeviceNotRegistered') dead.add(m.to);
          errors.set(m.itemId, t?.message ?? `push_${res.status}`);
        }
      });
    } catch (e) {
      batch.forEach((m) => errors.set(m.itemId, `push_failed: ${String(e).slice(0, 100)}`));
    }
  }
  return { ok, dead, errors };
}

async function sendEmail(item: Item): Promise<string | null> {
  if (!RESEND_KEY || !FROM) return 'email_not_set_up';
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [item.email],
        subject: item.title,
        html: emailHtml(item),
        text: emailText(item),
      }),
    });
    if (res.ok) return null;
    return `email_${res.status}`;
  } catch (e) {
    return `email_failed: ${String(e).slice(0, 100)}`;
  }
}

Deno.serve(async (req: Request) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!SERVICE_KEY || auth !== `Bearer ${SERVICE_KEY}`) return json({ error: 'Not allowed' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: started, error: qErr } = await db.rpc('queue_suggestion_notifications');
  const { data, error } = await db.rpc('notifications_to_send', { p_limit: 200 });
  if (error) return json({ error: error.message }, 500);
  const items = (data ?? []) as Item[];

  const push = await sendPush(items.filter((i) => i.push_tokens && i.push_tokens.length > 0));
  for (const token of push.dead) await db.rpc('forget_push_token', { p_token: token });

  let emailed = 0;
  for (const it of items) {
    let emailError: string | null = null;
    if (it.email) {
      emailError = await sendEmail(it);
      if (!emailError) emailed += 1;
    }
    const pushed = push.ok.has(it.id);
    const errorText = [push.errors.get(it.id), emailError].filter(Boolean).join('; ') || null;
    await db.rpc('mark_notification_sent', {
      p_id: it.id,
      p_pushed: it.push_tokens?.length ? pushed : null,
      p_emailed: it.email ? !emailError : null,
      p_error: errorText,
    });
  }

  return json({
    suggestions_started: qErr ? `error: ${qErr.message}` : started,
    sent: items.length,
    pushed: push.ok.size,
    emailed,
  });
});
