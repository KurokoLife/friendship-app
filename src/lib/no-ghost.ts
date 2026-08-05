import { supabase } from '@/lib/supabase';

// Fix #2: rebuilt to match blueprint Section 10's locked timeline
// (0/20/36/72/120/125h/7 days, "receiver always receives escalating
// prompt before sender"). See supabase/migrations/20260720000000 for
// the schema and evaluator side of this same rebuild, and that
// migration's own header comment for what the previous system actually
// was (a different, undocumented rewrite, not the 48/72/96/120h table
// AGENTS.md used to describe).
export type NoGhostTriggerId = 'R1' | 'R2' | 'R3' | 'S1';

export type NoGhostPrompt = {
  id: string;
  connection_id: string;
  user_id: string;
  trigger_id: NoGhostTriggerId;
  fired_at: string;
  dismissed_at: string | null;
  remind_at: string | null;
  draft_content: string | null;
};

export async function fetchActivePrompts(): Promise<NoGhostPrompt[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('no_ghost_prompts')
    .select('*')
    .is('dismissed_at', null)
    .or(`remind_at.is.null,remind_at.lte.${nowIso}`);
  return (data ?? []) as NoGhostPrompt[];
}

// A connection's rows for the current viewer are always either all-sender
// (S1) or all-receiver (R1/R2/R3), the last message's sender/recipient
// determines both roles simultaneously, a viewer can't be both, so this
// ranking only needs to be monotonic within each role's own escalation
// order.
const TRIGGER_RANK: Record<NoGhostTriggerId, number> = { R1: 1, R2: 2, R3: 3, S1: 4 };

export function bestPromptPerConnection(prompts: NoGhostPrompt[]): Map<string, NoGhostPrompt> {
  const byConnection = new Map<string, NoGhostPrompt>();
  for (const p of prompts) {
    const existing = byConnection.get(p.connection_id);
    if (!existing || TRIGGER_RANK[p.trigger_id] > TRIGGER_RANK[existing.trigger_id]) {
      byConnection.set(p.connection_id, p);
    }
  }
  return byConnection;
}

export function isSenderTrigger(triggerId: NoGhostTriggerId): boolean {
  return triggerId === 'S1';
}

export async function dismissPrompt(promptId: string) {
  await supabase.from('no_ghost_prompts').update({ dismissed_at: new Date().toISOString() }).eq('id', promptId);
}

export const HONEST_EXIT_SENDER_TEXT =
  "Choosing honesty over silence takes real courage. That's what genuine care looks like.";
export const HONEST_EXIT_RECEIVER_TEXT =
  "Honest endings are harder to receive than to give. You deserved that honesty. That's not nothing.";

// Kept for F25's own before-you-cancel identity mirror, which still
// uses a gendered variant. F17's own identity mirror below is
// deliberately universal: the blueprint's own Section 10 copy (read
// directly from the source document for this rebuild) has no gendered
// branch anywhere in the receiver/sender message tables, a single line
// each, so building two gendered variants around it would mean writing
// new wrapper copy that was never actually given, not just relaying
// what's there. Kept gender-neutral, matching how the previous rewrite
// already (independently) reached the same conclusion.
export type GenderBucket = 'women' | 'men';

export function genderBucket(genderIdentity: string | null): GenderBucket {
  return genderIdentity === 'man' ? 'men' : 'women';
}

// Sender-only, client-computed reassurance, no DB row (same "computed,
// not stored" approach this system has always used for passive,
// non-actionable content). Blueprint: 20h shows the recipient's usual
// reply rhythm plus reassurance; 72h ("in Chat") shows a second,
// different reassurance line, still no push, still no action attached.
// Both verbatim from blueprint Section 10's "Sender messages" table,
// the 20h line's opening clause substituted with the same
// otherName/responseTimePhrase pattern this app already established
// (RESPONSE_TIME_PHRASES in thread/[id].tsx) rather than the table's
// own literal "They usually reply within two days" example line, since
// that line is itself just one instantiation of the template for a
// "1-2 days" responder.
export function senderReassuranceLine(
  otherName: string,
  responseTimePhrase: string | null,
  hoursSinceSent: number,
  hasReply: boolean
): string | null {
  if (hasReply) return null;
  if (hoursSinceSent >= 20 && hoursSinceSent < 72) {
    if (!responseTimePhrase) return null;
    return `${otherName} ${responseTimePhrase}. A delayed response can have many explanations, so it may be too soon to draw a conclusion.`;
  }
  if (hoursSinceSent >= 72 && hoursSinceSent < 125) {
    return 'Life gets busy. You may keep waiting or send a gentle follow-up. Their delay is information, but it is not proof of why they have not replied.';
  }
  return null;
}

// Identity mirror shown alongside every actionable trigger (R2, R3,
// S1), the five-step structure's own step, kept exactly as the
// previous rewrite already established it (gender-neutral, per the
// reasoning above).
export const CONVERSATION_IDENTITY_MIRROR = 'You came here to show up for people. Does going quiet feel right to you?';
export const R_PERSPECTIVE_SHIFT = "From their side, silence can feel like rejection even when it isn't.";

// Awareness text, verbatim from blueprint Section 10's receiver/sender
// message tables (em dashes replaced with plain sentence breaks, this
// app's own no-em-dash rule, not a content change). R1 no longer
// branches on conversation depth, the previous rewrite's "shallow vs.
// genuine" split wasn't part of the blueprint's own copy at all, it
// came from whatever other instruction produced the last rewrite; the
// blueprint gives one fixed line for the 36/20h checkpoint, used as-is.
export function triggerAwarenessText(triggerId: NoGhostTriggerId): string {
  switch (triggerId) {
    case 'R1':
      return 'You have a message waiting. You do not need a perfect reply. A short, honest response helps the other person know where things stand.';
    case 'R2':
      return 'Still deciding? Choose what is true for you: reply, pause because life is busy, or end the connection respectfully.';
    case 'R3':
      return 'Please close the loop. Reply, pause, or end the connection. AI can help you write, but nothing will be sent without your approval.';
    case 'S1':
      return 'You deserve clarity. Keep waiting, send one final follow-up, or close the connection and make room for another.';
  }
}

export type ReceiverEscalationOptionKey = 'reply' | 'pause' | 'exit';

// R2 and R3 share the same three choices per the blueprint table
// ("Reply, Pause or consider Honest Exit" at 72h, "Reply, Pause or End"
// at 120h), just escalating urgency in the surrounding awareness text.
// Pause is now the formal per-connection state (pauseConnection below),
// a real status change, not a message, so it's handled as a direct
// action in the UI rather than through this fixed-draft list; reply and
// exit both open a blank compose field instead (AI philosophy fix: a
// canned message pre-filled the moment an option was picked left no
// real choice, the user's own words must come first).
export const RECEIVER_ESCALATION_OPTIONS: { key: ReceiverEscalationOptionKey; label: string }[] = [
  { key: 'reply', label: 'Reply' },
  { key: 'exit', label: 'End the connection' },
];

export async function resolveNoGhostPromptWithMessage(
  prompt: NoGhostPrompt,
  connectionId: string,
  senderId: string,
  content: string,
  messageType: 'text' | 'honest_exit' = 'text'
) {
  await supabase.from('messages').insert({ connection_id: connectionId, sender_id: senderId, content, type: messageType });
  await dismissPrompt(prompt.id);
}

// "End the connection" is now a real action, not just a message: this
// calls end_connection_with_message (20260817000000, extended
// 20260818000000), a single atomic SECURITY DEFINER RPC that flips
// connections.status to 'ended' together with an optional message and an
// optional private reason, matching block_user()'s own "one call does the
// whole atomic thing" pattern rather than several separate, skippable
// client calls. No separate dismissPrompt call is needed here: the status
// transition itself fires clear_prompts_on_connection_closed, which
// deletes every no_ghost_prompts row for this connection (this one
// included) as a direct side effect.
//
// content is now optional (20260818000000): omitting it is the
// message-less closure path, distinct from S1's own deliberately silent
// "close and make room for another" (setConnectionInactive below), this
// path still notifies, the other participant still sees the real,
// already-built honest 'ended' banner in the thread (identical either
// way, since that banner was never conditioned on a message existing).
// Both existing call sites (the no-ghost R2/R3 escalation card, the
// meetup-outcome rough card) still always pass real content, unaffected.
//
// reason is private (20260818000000): stored only in
// connection_end_reasons, own-row RLS, never read back by any other
// participant-facing code path, structurally distinct from Report's own
// non-private category system.
export type ConnectionEndReason =
  | 'capacity'
  | 'not_a_match'
  | 'communication_mismatch'
  | 'leaving_app'
  | 'safety'
  | 'other';

export const CONNECTION_END_REASONS: { key: ConnectionEndReason; label: string }[] = [
  { key: 'capacity', label: "I don't have the capacity right now" },
  { key: 'not_a_match', label: 'Not the right friendship match' },
  { key: 'communication_mismatch', label: "Our communication styles don't fit" },
  { key: 'leaving_app', label: "I'm leaving the app" },
  { key: 'safety', label: 'Safety concern' },
  { key: 'other', label: 'Other' },
];

// Verbatim from blueprint Section 10's own "Suggested user-approved
// wording" table (Friendship_App_Blueprint_v4.docx), no changes beyond
// this app's own no-em-dash rule (none of the three lines had one). Still
// gated on the same "user must edit before sending" convention the rest
// of this app already enforces for every AI-draft/template flow, per
// explicit instruction: picking one only pre-fills the field, it does not
// enable Send on its own.
export const CONNECTION_END_TEMPLATES: { key: string; label: string; text: string }[] = [
  {
    key: 'not_a_match',
    label: 'Not a match',
    text: "Thank you for taking the time to talk with me. I don't think we're the right friendship match, so I'm going to close the connection. I genuinely wish you well.",
  },
  {
    key: 'limited_capacity',
    label: 'Limited capacity',
    text: "I've realized I don't have the capacity to build another friendship right now. I wanted to be honest rather than disappear. I wish you the best.",
  },
  {
    key: 'communication_mismatch',
    label: 'Communication mismatch',
    text: "I appreciate getting to know you. I don't think our communication styles are the best fit, so I'm going to step away.",
  },
];

export async function endConnectionWithMessage(
  connectionId: string,
  options: { content?: string; reason?: ConnectionEndReason } = {}
) {
  const { error } = await supabase.rpc('end_connection_with_message', {
    p_connection_id: connectionId,
    p_content: options.content ?? null,
    p_reason: options.reason ?? null,
  });
  if (error) throw error;
}

// S1's "close the connection and make room for another": no message
// sent, no penalty, quiet archive, same mechanism as before, just
// reached from the new final checkpoint.
export async function setConnectionInactive(connectionId: string, promptId: string) {
  await supabase.rpc('set_connection_inactive', { p_connection_id: connectionId });
  await dismissPrompt(promptId);
}

// Formal Pause (Fix #2, new): a real per-connection status, not a
// message. Stops the no-ghost timer immediately (the RPC also clears
// any prompt already fired for this connection, both participants).
export async function pauseConnection(connectionId: string, promptId?: string) {
  await supabase.rpc('pause_connection', { p_connection_id: connectionId });
  if (promptId) await dismissPrompt(promptId);
}

export async function resumeConnection(connectionId: string) {
  await supabase.rpc('resume_connection', { p_connection_id: connectionId });
}
