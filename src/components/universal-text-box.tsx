import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

// Limen v2 (2026-10-03), see docs/LIMEN_V2_DECISIONS.md.
//
// "Reflect first." A few questions and tips shown before (or while) the
// person writes. Static text, no server call, nothing about the message is
// sent anywhere. The app never writes, rewrites or checks a message.
//
// 2026-10-10: "Check" is removed (founder decision). It sent the draft and
// the last 5 messages to be looked at, which shared the other person's
// words. In its place, the reply questions carry more tips for thinking
// about how to respond.

// Kept as named exports so existing imports don't break.
export class DraftServiceError extends Error {}
export class CreditBlockedError extends DraftServiceError {
  tier?: string;
  constructor(message: string, tier?: string) {
    super(message);
    this.tier = tier;
  }
}

export type ReflectionContext = 'reply' | 'profile' | 'exit' | 'plan';

type Section = { heading: string; items: string[] };

// Replies in a chat: notice, respond, keep it going.
const REPLY_SECTIONS: Section[] = [
  {
    heading: 'Notice',
    items: [
      'What did they share? What part seems to matter most to them?',
      'Did they ask you something? Answer that first.',
      'Not sure what they meant? Ask them, like "what do you mean?" or "how so?" Only they know.',
    ],
  },
  {
    heading: 'Respond',
    items: [
      'If you had shared this, how would you want someone to respond?',
      'Reply to one thing they said before adding your own news.',
      'Share a little of yourself back, about as much as they shared.',
    ],
  },
  {
    heading: 'Keep it going',
    items: [
      'Ask one open question, like "what was that like?" or "how did it go?", rather than a yes or no.',
      "A short, warm reply is enough. It doesn't need to be perfect.",
      'If you\'d like to meet, you could suggest a time or a place.',
      "Not sure how they like to be responded to? You could ask them.",
    ],
  },
];

const DEFAULT_QUESTIONS: Record<Exclude<ReflectionContext, 'reply'>, string[]> = {
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
  disabled?: boolean;
};

export function UniversalTextBox({
  context = 'reply',
  reflectionQuestions,
  otherCareStyle,
  otherName,
  disabled,
}: Props) {
  const [showReflect, setShowReflect] = useState(false);

  const sections: Section[] = reflectionQuestions
    ? [{ heading: '', items: reflectionQuestions }]
    : context === 'reply'
      ? REPLY_SECTIONS
      : [{ heading: '', items: DEFAULT_QUESTIONS[context] }];

  return (
    <View className="gap-2">
      <Pressable onPress={() => setShowReflect((s) => !s)} disabled={disabled} className="self-start">
        <Text className="text-caption font-semibold text-accent-500">
          {showReflect ? 'Hide questions' : 'Reflect first'}
        </Text>
      </Pressable>

      {showReflect && (
        // Scrolls inside a short box so the chat above stays in view on a phone.
        <ScrollView
          nestedScrollEnabled
          className="max-h-48 rounded-xl border border-stone-200 dark:border-stone-800"
          contentContainerClassName="gap-3 p-3">
          {sections.map((sec) => (
            <View key={sec.heading || sec.items[0]} className="gap-1">
              {sec.heading ? (
                <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">{sec.heading}</Text>
              ) : null}
              {sec.items.map((q) => (
                <Text key={q} className="text-caption text-stone-600 dark:text-stone-300">
                  • {q}
                </Text>
              ))}
            </View>
          ))}
          {context === 'reply' && otherCareStyle ? (
            <View className="gap-1">
              <Text className="text-caption font-semibold text-stone-500 dark:text-stone-400">
                {otherName ? `How ${otherName} likes care, in their words` : 'How they like care, in their words'}
              </Text>
              <Text className="text-caption italic text-stone-600 dark:text-stone-300">“{otherCareStyle}”</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
