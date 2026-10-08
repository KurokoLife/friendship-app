import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

// Limen v2 (2026-10-03), see docs/LIMEN_V2_DECISIONS.md.
//
// "Reflect before you reply." This component used to be the universal
// "Help me write" / "Clean up" box, which had the AI draft or rewrite the
// user's words. That is gone. The AI now never produces text the user
// could send. What's left:
//
//   - Reflect: a few questions shown before (or while) the user writes.
//     For replies these are: notice what they shared, how you would want
//     someone to respond to you, and what you know about how THEY like to
//     be responded to (their own "How I like care" words, when they've
//     written any), then "if you don't know, you could ask." These are
//     static questions, no AI call at all.
//   - Check: optional, fact-only observations about what the user already
//     wrote (a point they didn't respond to, no question, answering their
//     own question, only questions, a big jump in depth). Never tone,
//     warmth, or "empathy" grading, and never a rewrite. Users show care
//     their own way.
//
// The component still renders no field of its own; the caller owns the
// TextInput and passes value/onChangeText, same as before.

// Kept as named exports so existing imports don't break. Nothing throws
// CreditBlockedError anymore (AI credits are no longer sold), but older
// call sites may still reference the types.
export class DraftServiceError extends Error {}
export class CreditBlockedError extends DraftServiceError {
  tier?: string;
  constructor(message: string, tier?: string) {
    super(message);
    this.tier = tier;
  }
}

export type ReflectionContext = 'reply' | 'profile' | 'exit' | 'plan';
export type CoachContextMessage = { sender: 'me' | 'them'; content: string };

type Observation = { code: string; text: string };

const DEFAULT_QUESTIONS: Record<ReflectionContext, string[]> = {
  reply: [
    'What did they share? What part matters most to you?',
    'If you had shared this, how would you want someone to respond?',
    "What do you know about how they like to be responded to? If you don't know yet, you could ask them.",
  ],
  profile: [
    'Think of a specific moment, not a summary. What happened?',
    'What would a new friend only learn about you after a few meetups?',
    'Say it the way you would say it out loud to someone you trust.',
  ],
  exit: [
    'What is the honest reason, in one sentence, for you?',
    'If you were on the other side, what would you want to hear, and what would you not want to hear?',
    'Is there anything you appreciated that you want them to know?',
  ],
  plan: [
    'What would you genuinely enjoy doing with them?',
    'What do you know about what they enjoy, or what they mentioned recently?',
    "If you're not sure what works for them, you could ask.",
  ],
};

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  context?: ReflectionContext;
  // Overrides the default questions for this context.
  reflectionQuestions?: string[];
  // The other person's own, user-written "How I like care" text, if any.
  otherCareStyle?: string | null;
  otherName?: string | null;
  // Recent conversation, used only by Check to notice a missed point.
  recentMessages?: CoachContextMessage[];
  // Check is for messages. Off by default for profile fields.
  checkEnabled?: boolean;
  disabled?: boolean;
};

export function UniversalTextBox({
  value,
  context = 'reply',
  reflectionQuestions,
  otherCareStyle,
  otherName,
  recentMessages = [],
  checkEnabled,
  disabled,
}: Props) {
  const [showReflect, setShowReflect] = useState(false);
  const [checking, setChecking] = useState(false);
  const [observations, setObservations] = useState<Observation[] | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const questions = reflectionQuestions ?? DEFAULT_QUESTIONS[context];
  const hasContent = value.trim().length > 0;
  const canCheck = (checkEnabled ?? context !== 'profile') && hasContent;
  const stale = checkedText !== null && checkedText !== value;

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('reflection-coach', {
        body: { mode: 'check', text: value, recentMessages },
      });
      if (fnError) throw fnError;
      if (data?.blocked) {
        setError(data.message as string);
        return;
      }
      if (data?.error) {
        setError(data.error as string);
        return;
      }
      setObservations((data?.observations ?? []) as Observation[]);
      setCheckedText(value);
    } catch {
      setError("Couldn't check that right now. Your own words are enough, send it when it feels right.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-3">
        <Pressable onPress={() => setShowReflect((s) => !s)} disabled={disabled}>
          <Text className="text-caption font-semibold text-accent-500">
            {showReflect ? 'Hide questions' : 'Reflect first'}
          </Text>
        </Pressable>
        {canCheck && (
          <Pressable onPress={handleCheck} disabled={disabled || checking}>
            <Text className={`text-caption font-semibold text-accent-500 ${checking ? 'opacity-40' : ''}`}>
              Check
            </Text>
          </Pressable>
        )}
        {checking && <ActivityIndicator size="small" color={MUTED_ICON_COLOR} />}
      </View>

      {showReflect && (
        <View className="gap-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
          {questions.map((q) => (
            <Text key={q} className="text-caption text-stone-600 dark:text-stone-300">
              • {q}
            </Text>
          ))}
          {context === 'reply' && otherCareStyle ? (
            <View className="gap-1 pt-1">
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                {otherName ? `How ${otherName} likes care, in their words` : 'How they like care, in their words'}
              </Text>
              <Text className="text-caption italic text-stone-600 dark:text-stone-300">“{otherCareStyle}”</Text>
            </View>
          ) : null}
        </View>
      )}

      {error && <Text className="text-caption text-stone-500 dark:text-stone-400">{error}</Text>}

      {observations && !stale && (
        <View className="gap-1">
          {observations.length === 0 ? (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Nothing to point out. It's yours, send it when it feels right.
            </Text>
          ) : (
            observations.map((o) => (
              <Text key={o.code} className="text-caption text-stone-600 dark:text-stone-300">
                • {o.text}
              </Text>
            ))
          )}
          <Text className="text-caption text-stone-400 dark:text-stone-600">
            These are only things to notice. You decide what, if anything, to change.
          </Text>
        </View>
      )}
    </View>
  );
}
