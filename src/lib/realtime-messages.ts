import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type MessageRow = {
  id: string;
  connection_id: string;
  sender_id: string;
  content: string;
  type: string;
  read_at: string | null;
  created_at: string;
};

type Handler = (payload: RealtimePostgresChangesPayload<MessageRow>) => void;

// Single, reference-counted Realtime subscription to public.messages,
// shared by every screen that needs it (inbox, thread), instead of each
// screen creating its own channel.
//
// Fixes a real bug: inbox.tsx and thread/[id].tsx each independently
// created a `supabase.channel(...).on(...).subscribe()`. Calling .on()
// again on a channel that's already had .subscribe() called throws
// "cannot add postgres_changes callbacks ... after subscribe()", and this
// class of bug is easy to hit even with correct-looking cleanup: React's
// Strict Mode double-invokes effects in development (mount, cleanup,
// mount again), and removeChannel()'s server-side unsubscribe is
// asynchronous, so a fast remount can create a new channel with the same
// topic name before the old one has actually finished tearing down.
//
// This sidesteps the whole problem: .on() is only ever called once, right
// when the single shared channel is first created, subscribe() is called
// exactly once for the lifetime of the module (or until every consumer
// has unsubscribed and a fresh one is created later), and each screen's
// own cleanup just removes its callback from a plain Set rather than
// touching the channel object directly. The channel name also includes a
// random suffix, so even in a pathological case where an old channel
// object briefly lingers, a freshly created one can never collide with it
// on topic name.
let channel: ReturnType<typeof supabase.channel> | null = null;
let refCount = 0;
const insertHandlers = new Set<Handler>();
const updateHandlers = new Set<Handler>();

function ensureChannel() {
  if (channel) return;
  channel = supabase
    .channel(`messages-shared-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => insertHandlers.forEach((h) => h(payload as RealtimePostgresChangesPayload<MessageRow>))
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => updateHandlers.forEach((h) => h(payload as RealtimePostgresChangesPayload<MessageRow>))
    )
    .subscribe();
}

export function subscribeToMessages(options: { onInsert?: Handler; onUpdate?: Handler }): () => void {
  refCount += 1;
  ensureChannel();
  if (options.onInsert) insertHandlers.add(options.onInsert);
  if (options.onUpdate) updateHandlers.add(options.onUpdate);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    if (options.onInsert) insertHandlers.delete(options.onInsert);
    if (options.onUpdate) updateHandlers.delete(options.onUpdate);
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}
