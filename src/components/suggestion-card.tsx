import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Face, InlineLink, Pill } from '@/components/ui';
import { CIRCLE_LABELS, RHYTHM_LABELS, friendPhotoUrl, nextCheckInLine, type Rhythm } from '@/lib/circle';
import {
  CAN_USE_CONTACTS,
  CHECK_IN_WHY,
  PATTERN_OPTIONS,
  PATTERN_QUESTION,
  answerPattern,
  contactWays,
  openCall,
  openEmail,
  openText,
  resolveSuggestion,
  suggestionLine,
  type ContactWays,
  type Suggestion,
} from '@/lib/suggestions';

// The suggestion card at the top of Your circle (rebuild stage 3,
// 2026-10-28). Honey background (design guide). Notice first, action
// optional: the person decides whether and how to reach out, in their own
// words. Lines that 05 doesn't give are drafts (docs/DECISIONS.md section 15).
type Phase = { kind: 'card' } | { kind: 'asked' } | { kind: 'done'; line: string };

export function SuggestionCard({ suggestion, onDone }: { suggestion: Suggestion; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'card' });
  const [whyOpen, setWhyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ways, setWays] = useState<ContactWays | null>(null);
  const [photo, setPhoto] = useState<string | null>(suggestion.photo_url ?? null);

  const name = suggestion.name ?? '';
  const firstName = name.trim().split(/\s+/)[0] || 'them';
  const isLimen = suggestion.person_kind === 'limen';
  const linked = suggestion.person_kind === 'outside' && !!suggestion.contact_id && CAN_USE_CONTACTS;

  useEffect(() => {
    setPhase({ kind: 'card' });
    setWhyOpen(false);
    if (suggestion.person_kind === 'outside') friendPhotoUrl(suggestion.photo_path ?? null).then(setPhoto);
    if (linked && suggestion.contact_id) contactWays(suggestion.contact_id).then(setWays);
    else setWays(null);
  }, [suggestion.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = 'gap-3 rounded-2xl border border-honey-line bg-honey p-5 dark:border-stone-700 dark:bg-stone-800';

  if (phase.kind === 'done') {
    return (
      <View className={card} accessibilityLabel="Suggestion">
        <Text className="text-body text-stone-800 dark:text-stone-100">{phase.line}</Text>
        <Pill label="Got it" className="self-start" onPress={onDone} />
      </View>
    );
  }

  // ---- The "what gets in the way?" question --------------------------------
  if (suggestion.person_kind === 'pattern') {
    return (
      <View className={card} accessibilityLabel="Suggestion">
        <Text className="text-body font-semibold text-stone-900 dark:text-stone-50">{PATTERN_QUESTION}</Text>
        <Text className="text-caption text-stone-600 dark:text-stone-300">Only you see your answer.</Text>
        <View className="gap-2">
          {PATTERN_OPTIONS.map((o) => (
            <Pill
              key={o.key}
              label={o.label}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                await answerPattern(suggestion.id, o.key);
                setBusy(false);
                setPhase({ kind: 'done', line: o.line });
              }}
            />
          ))}
          <Pill
            label="Not now"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              await answerPattern(suggestion.id, null);
              setBusy(false);
              onDone();
            }}
          />
        </View>
      </View>
    );
  }

  const { line, why, source } = suggestionLine(suggestion);

  const finish = async (outcome: 'reached' | 'not_now' | 'fewer') => {
    setBusy(true);
    const r = await resolveSuggestion(suggestion.id, outcome);
    setBusy(false);
    if (r.status === 'reached') {
      setPhase({
        kind: 'done',
        line: `Noted. ${CHECK_IN_WHY} ${nextCheckInLine(name, r.next_day, (suggestion.rhythm ?? 'week') as Rhythm)}`,
      });
    } else if (r.status === 'not_now') {
      setPhase({ kind: 'done', line: `Okay. Limen will bring ${firstName} up again another time.` });
    } else if (r.status === 'fewer') {
      setPhase({
        kind: 'done',
        line:
          r.rhythm === 'none'
            ? `Okay. Limen won't bring ${firstName} up on its own now.`
            : `Okay. Limen will bring ${firstName} up ${RHYTHM_LABELS[r.rhythm].toLowerCase()} from now on.`,
      });
    } else if (r.status === 'slowest') {
      setPhase({
        kind: 'done',
        line: `That's already as seldom as Limen brings up someone in ${CIRCLE_LABELS[r.circle]}. To hear less about ${firstName}, you can move them to another circle on their page.`,
      });
    } else {
      onDone();
    }
  };

  const openPerson = () => {
    if (isLimen && suggestion.connection_id) {
      router.push({ pathname: '/thread/[id]', params: { id: suggestion.connection_id } });
    } else if (suggestion.person_id) {
      router.push({ pathname: '/friend/[id]', params: { id: suggestion.person_id } });
    }
  };

  // After Text, Call or Email: one optional question.
  if (phase.kind === 'asked') {
    return (
      <View className={card} accessibilityLabel="Suggestion">
        <Text className="text-body text-stone-800 dark:text-stone-100">Did you reach out to {firstName}?</Text>
        <View className="flex-row flex-wrap gap-2">
          <Pill label="Yes" variant="filled" disabled={busy} onPress={() => finish('reached')} />
          <Pill label="Not yet" disabled={busy} onPress={() => setPhase({ kind: 'card' })} />
        </View>
      </View>
    );
  }

  const phone = ways && typeof ways === 'object' ? ways.phone : null;
  const email = ways && typeof ways === 'object' ? ways.email : null;
  const reach = (open: () => Promise<unknown>) => async () => {
    try {
      await open();
    } catch {
      // The phone couldn't open its app; the card stays.
      return;
    }
    setPhase({ kind: 'asked' });
  };

  return (
    <View className={card} accessibilityLabel="Suggestion">
      <Pressable
        onPress={openPerson}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        className="flex-row items-center gap-3 active:opacity-80">
        <Face name={name} photoUrl={photo} circle={suggestion.circle ?? 'friends'} size={48} />
        <Text className="flex-1 text-body font-semibold text-stone-900 dark:text-stone-50">{line}</Text>
      </Pressable>
      <Text className="text-caption text-stone-600 dark:text-stone-300">
        {why} <InlineLink onPress={() => setWhyOpen((v) => !v)}>Why we say this</InlineLink>
      </Text>
      {whyOpen && <Text className="text-caption text-stone-500 dark:text-stone-400">{source}</Text>}

      {isLimen ? (
        <View className="flex-row flex-wrap gap-2">
          <Pill label="Open chat" variant="filled" onPress={openPerson} />
          <Pill label="I reached out" disabled={busy} onPress={() => finish('reached')} />
        </View>
      ) : phone || email ? (
        <View className="flex-row flex-wrap gap-2">
          {phone && <Pill label="Text" icon="chatbubble-outline" variant="filled" onPress={reach(() => openText(phone))} />}
          {phone && <Pill label="Call" icon="call-outline" onPress={reach(() => openCall(phone))} />}
          {email && (
            <Pill label="Email" icon="mail-outline" variant={phone ? 'outline' : 'filled'} onPress={reach(() => openEmail(email))} />
          )}
          <Pill label="I reached out" disabled={busy} onPress={() => finish('reached')} />
        </View>
      ) : (
        <View className="gap-2">
          <Text className="text-body text-stone-700 dark:text-stone-300">Reach out however you usually do.</Text>
          {CAN_USE_CONTACTS && !suggestion.contact_id && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              To text or call from here, link {firstName} to a contact on <InlineLink onPress={openPerson}>their page</InlineLink>.
            </Text>
          )}
          {ways === 'denied' && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Limen can&apos;t see your contacts. You can allow it in your phone&apos;s settings.
            </Text>
          )}
          <Pill label="I reached out" variant="filled" className="self-start" disabled={busy} onPress={() => finish('reached')} />
        </View>
      )}

      <View className="flex-row flex-wrap gap-2">
        <Pill label="Not now" disabled={busy} onPress={() => finish('not_now')} />
        <Pill label={`Fewer suggestions for ${firstName}`} disabled={busy} onPress={() => finish('fewer')} />
      </View>
    </View>
  );
}
