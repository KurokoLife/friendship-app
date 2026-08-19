import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { CoachMark } from '@/components/coach-mark';
import { purchaseAiCreditPack } from '@/lib/ai-credits';
import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// A distinct type for the specific, human-readable messages the backend
// itself returns (too long, truncated), as opposed to generic network or
// SDK-level errors, whose `.message` is often technical and not meant for
// display. Only this type's message is ever shown to the user; anything
// else falls back to the caller's own generic copy.
export class DraftServiceError extends Error {}

// 2026-07-29: a real cap/pool block with zero AI credits left, as opposed
// to any other DraftServiceError (too long, truncated). Distinguished so
// the "Buy 50 AI credits" affordance only ever shows for the specific
// case it actually fixes, not for every server-side message. `tier`
// (2026-08-12) carries the gate's own `data.tier` so the "Upgrade to
// Premium" link can be shown only for a free-tier block, a premium
// account hitting the pool cap has nothing to upgrade to.
export class CreditBlockedError extends DraftServiceError {
  tier?: string;
  constructor(message: string, tier?: string) {
    super(message);
    this.tier = tier;
  }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof DraftServiceError && err.message ? err.message : fallback;
}

function isCreditBlockedError(err: unknown): boolean {
  return err instanceof CreditBlockedError;
}

function creditBlockedTier(err: unknown): string | undefined {
  return err instanceof CreditBlockedError ? err.tier : undefined;
}

type BoxMode = 'idle' | 'prompting' | 'drafting' | 'cleaning';

type Props = {
  // Controls-only: this component renders no field of its own, not even
  // for the "what's the situation" step (that used to be a separate mini
  // field, a real bug, two boxes on screen at once wherever the caller's
  // own field stayed visible while empty). The user now types directly
  // into the caller's own already-visible field for every step, this
  // component only ever reads/writes it via these two props.
  value: string;
  onChangeText: (text: string) => void;
  // Shown as a plain caption once "Help me write" is tapped, inviting the
  // user to type their situation into the field above, replacing the old
  // separate field's placeholder text.
  situationPrompt?: string;
  // Draft generation is context-specific (a reply needs conversation
  // history, a profile field needs its own label, an honest cancellation
  // needs the reason), so the caller owns this by supplying either a
  // ready callback (onRequestDraft) or a purpose string (used with the
  // default callback below, which calls generate-reply-draft directly).
  // Cleanup does not vary by context (it's always "fix grammar/clarity,
  // change nothing else" on whatever text is already there), so it's
  // handled internally instead of requiring every caller to wire it up.
  onRequestDraft?: (situation: string) => Promise<string>;
  // Shorthand for the common case: no custom onRequestDraft, just a
  // purpose description passed straight through to generate-reply-draft
  // (e.g. "write a short bio about themselves for their profile").
  draftPurpose?: string;
  // Overrides the "prompting" submit button's label, "Draft it" by
  // default. No-ghost S1 (sender, 125h) passes "Help Me Write" here so its
  // compose flow reads consistently start to finish, a deliberately scoped
  // rename, not a default change for every caller.
  draftActionLabel?: string;
  // Part 1 of tonight's consolidated build: overrides the idle+hasContent
  // "Clean up" label, "Clean up" by default everywhere else. The no-ghost
  // cards pass "Help me reply" here so the same real polish mechanism
  // (generate-reply-draft's cleanup mode, unchanged) reads correctly in a
  // reply-composition context rather than a generic editing one.
  cleanupActionLabel?: string;
  disabled?: boolean;
};

// Single-box pattern (2026-07-27), fixing a real bug found in the field:
// the "Help me write" flow still opened a second, separate mini text
// field for the situation description, which showed up as two visible
// boxes stacked on screen (reported live in ReplyAssistPanel's "Write a
// reply" modal, but structurally present in every caller whose own field
// stays visible while empty, which is most of them). Fixed by never
// rendering a field of its own: "Help me write" now just reveals the
// draft action button below the caller's own (empty) field and a caption
// inviting them to type there, the user's situation description is typed
// directly into the one shared field, then replaced in place with the
// draft, exactly like Clean Up replaces content in place. Undo now
// applies to both actions identically (restores whatever was in the
// field immediately before the AI ran, whether that was a rough
// situation description or an already-written message), not just Clean
// Up, previously drafting from an empty field was treated as having
// nothing worth undoing back to, which stopped being true the moment the
// situation text lives in the same field being replaced.
export function UniversalTextBox({
  value,
  onChangeText,
  situationPrompt = "What's the situation, in your own words?",
  onRequestDraft,
  draftPurpose,
  draftActionLabel = 'Draft it',
  cleanupActionLabel = 'Clean up',
  disabled,
}: Props) {
  const [mode, setMode] = useState<BoxMode>('idle');
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-07-29: only set when the error above came from a real blocked
  // cap/pool response (not any other DraftServiceError), so the "Buy 50
  // AI credits" affordance only ever shows for the case it actually
  // fixes. lastAction remembers which handler to retry after a
  // successful purchase, matching the given spec's "credit purchase
  // immediately unblocks" requirement rather than making the user
  // re-trigger the action by hand.
  const [creditBlocked, setCreditBlocked] = useState(false);
  // 2026-08-12: only true for a free-tier block, alongside creditBlocked,
  // showing a real "Upgrade to Premium" link next to "Get 50 AI credits".
  // A premium account hitting the shared pool cap has nothing to upgrade
  // to, so this stays false for that case even though creditBlocked is
  // still true.
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [lastAction, setLastAction] = useState<'draft' | 'cleanup' | null>(null);

  const hasContent = value.trim().length > 0;
  const canDraft = Boolean(onRequestDraft || draftPurpose);

  const requestDraft = async (situationText: string): Promise<string> => {
    if (onRequestDraft) return onRequestDraft(situationText);
    const { data, error: fnError } = await supabase.functions.invoke('generate-reply-draft', {
      body: { rawInput: situationText, recentMessages: [], purpose: draftPurpose },
    });
    if (fnError) throw fnError;
    // 2026-07-29: a blocked cap/pool response shows through the same
    // DraftServiceError path every other server-side message already
    // uses, only the creditBlocked flag (set by the caller) is new.
    if (data?.blocked) throw new CreditBlockedError(data.message as string, data.tier as string | undefined);
    if (data?.error) throw new DraftServiceError(data.error as string);
    if (!data?.draft) throw new Error('No draft returned');
    return data.draft as string;
  };

  const handleDraftIt = async () => {
    const situationText = value.trim();
    if (!situationText || !canDraft) return;
    setMode('drafting');
    setError(null);
    setCreditBlocked(false);
    setShowUpgrade(false);
    setLastAction('draft');
    try {
      const draft = await requestDraft(situationText);
      // Same in-place-replace-plus-Undo mechanic as Clean Up: whatever the
      // user typed as their situation description is real, recoverable
      // content, not a throwaway prompt, capture it before overwriting.
      setPreviousValue(value);
      onChangeText(draft);
      setMode('idle');
    } catch (err) {
      // A specific server message (too long, truncated) takes priority
      // over the generic fallback, the whole point of surfacing it is so
      // the user learns why, not just that something went wrong.
      setError(errorMessage(err, "Couldn't draft that right now. Try again, or write your own."));
      setCreditBlocked(isCreditBlockedError(err));
      setShowUpgrade(creditBlockedTier(err) === 'free');
      setMode('prompting');
    }
  };

  const handleCleanUp = async () => {
    setMode('cleaning');
    setError(null);
    setCreditBlocked(false);
    setShowUpgrade(false);
    setLastAction('cleanup');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-reply-draft', {
        body: { mode: 'cleanup', text: value },
      });
      if (fnError) throw fnError;
      if (data?.blocked) throw new CreditBlockedError(data.message as string, data.tier as string | undefined);
      if (data?.error) throw new DraftServiceError(data.error as string);
      if (!data?.draft) throw new Error('No cleaned text returned');
      setPreviousValue(value);
      onChangeText(data.draft as string);
    } catch (err) {
      setError(errorMessage(err, "Couldn't clean that up right now."));
      setCreditBlocked(isCreditBlockedError(err));
      setShowUpgrade(creditBlockedTier(err) === 'free');
    } finally {
      setMode('idle');
    }
  };

  // Real purchase, real server-side receipt validation, the same
  // already-built `purchaseAiCreditPack` this app's Discover tab uses for
  // generate-match-suggestions' own cap, reused here rather than a second
  // purchase implementation. On success, retries whichever action was
  // actually blocked, since the whole point of "immediately unblocks" is
  // not requiring the user to notice and re-tap it themselves.
  const handleBuyCredits = async () => {
    setPurchasing(true);
    try {
      const result = await purchaseAiCreditPack();
      if (result.status === 'success') {
        setError(null);
        setCreditBlocked(false);
        setShowUpgrade(false);
        if (lastAction === 'draft') await handleDraftIt();
        else if (lastAction === 'cleanup') await handleCleanUp();
      } else if (result.status === 'error') {
        setError(result.message);
      }
    } catch {
      setError('Something went wrong with that purchase. Try again.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleUndo = () => {
    if (previousValue !== null) onChangeText(previousValue);
    setPreviousValue(null);
  };

  const handleCancel = () => {
    onChangeText('');
    setPreviousValue(null);
    setError(null);
  };

  return (
    <View className="gap-2">
      {error && <Text className="text-caption text-red-600 dark:text-red-400">{error}</Text>}

      {creditBlocked && (
        <View className="gap-3">
          <CoachMark
            markKey="credits_premium"
            text="Free plans include a daily/weekly cap on AI help. Once you hit it, you can buy a small pack of extra credits, or upgrade to Premium for a much larger monthly allowance."
            actionLabel="See Premium"
            onAction={() => router.push('/premium')}
          />
          <View className="flex-row flex-wrap items-center gap-3">
            <Pressable
              onPress={handleBuyCredits}
              disabled={purchasing}
              className={`self-start rounded-full bg-stone-900 px-4 py-2 active:opacity-80 dark:bg-stone-50 ${
                purchasing ? 'opacity-40' : ''
              }`}>
              <Text className="text-caption font-semibold text-stone-50 dark:text-stone-900">
                {purchasing ? 'Processing...' : 'Get 50 AI credits for $1.99'}
              </Text>
            </Pressable>
            {/* 2026-08-12: the blocked message itself already mentions
                "upgrade to Premium" as plain text (generate-reply-draft's
                blockedResponse), this makes that option actually tappable.
                Only shown for a free-tier block, not a premium account
                hitting the shared pool cap, which has nothing to upgrade
                to. */}
            {showUpgrade && (
              <Pressable onPress={() => router.push('/premium')} className="self-start">
                <Text className="text-caption font-semibold text-accent-500">Upgrade to Premium</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {mode === 'prompting' && (
        <View className="gap-2">
          <Text className="text-caption text-stone-500 dark:text-stone-400">{situationPrompt}</Text>
          <View className="flex-row items-center gap-3">
            <Pressable onPress={handleDraftIt} disabled={!hasContent}>
              <Text className={`text-caption font-semibold text-accent-500 ${!hasContent ? 'opacity-40' : ''}`}>
                {draftActionLabel}
              </Text>
            </Pressable>
            <Pressable onPress={() => setMode('idle')}>
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {(mode === 'drafting' || mode === 'cleaning') && (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator size="small" color={MUTED_ICON_COLOR} />
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            {mode === 'drafting' ? 'Drafting...' : 'Cleaning up...'}
          </Text>
        </View>
      )}

      {mode === 'idle' && !hasContent && canDraft && (
        <View className="flex-row">
          <Pressable onPress={() => setMode('prompting')} disabled={disabled}>
            <Text className="text-caption font-semibold text-accent-500">Help me write</Text>
          </Pressable>
        </View>
      )}

      {mode === 'idle' && hasContent && (
        <View className="flex-row items-center gap-3">
          <Pressable onPress={handleCleanUp} disabled={disabled}>
            <Text className="text-caption font-semibold text-accent-500">{cleanupActionLabel}</Text>
          </Pressable>
          <Pressable onPress={handleCancel} disabled={disabled}>
            <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">Cancel</Text>
          </Pressable>
          {previousValue !== null && (
            <Pressable onPress={handleUndo} disabled={disabled}>
              <Text className="text-caption font-semibold text-stone-400 dark:text-stone-600">Undo</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
