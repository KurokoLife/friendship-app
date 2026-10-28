import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Pill } from '@/components/ui';
import { setFriendPhoto, type OutsideFriend } from '@/lib/circle';
import {
  CAN_USE_CONTACTS,
  contactWays,
  linkContact,
  markOutsideReached,
  openCall,
  openEmail,
  openText,
  pickContact,
  type ContactWays,
} from '@/lib/suggestions';

// Reach-out buttons on a friend's own page (rebuild stage 3, 2026-10-28; 05,
// "Desktop option A"). Phone app with a linked contact: Text / Call / Email
// open the phone's own app with an empty message, then one optional "Did you
// reach out?". A computer (or no contact): "Reach out however you usually
// do" and "I reached out". Limen never stores a number or an email.
export function ReachOut({ friend, onChanged }: { friend: OutsideFriend; onChanged: () => void }) {
  const first = friend.name.trim().split(/\s+/)[0] || 'them';
  const [ways, setWays] = useState<ContactWays | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setAsked(false);
    if (CAN_USE_CONTACTS && friend.contact_id) contactWays(friend.contact_id).then(setWays);
    else setWays(null);
  }, [friend.id, friend.contact_id]);

  const reached = async () => {
    setBusy(true);
    const ok = await markOutsideReached(friend.id);
    setBusy(false);
    setAsked(false);
    setNote(ok ? `Noted. A check-in tells someone they matter to you.` : "That didn't save. Please try again.");
    if (ok) onChanged();
  };

  const link = async () => {
    setNote(null);
    const picked = await pickContact();
    if (picked === 'denied') {
      setNote("Limen can't open your contacts. You can allow it in your phone's settings.");
      return;
    }
    if (!picked) return;
    setBusy(true);
    const ok = await linkContact(friend.id, picked.id);
    // The contact's photo, if there is one and no photo is set yet.
    if (ok && !friend.photo_path && picked.imageBase64) {
      await setFriendPhoto(friend.id, { base64: picked.imageBase64, contentType: 'image/jpeg', ext: 'jpg', uri: '' });
    }
    setBusy(false);
    setNote(ok ? null : "That didn't save. Please try again.");
    if (ok) onChanged();
  };

  const unlink = async () => {
    setBusy(true);
    const ok = await linkContact(friend.id, null);
    setBusy(false);
    if (ok) onChanged();
  };

  const go = (open: () => Promise<unknown>) => async () => {
    try {
      await open();
      setAsked(true);
    } catch {
      setNote("Your phone couldn't open that. You can reach out however you usually do.");
    }
  };

  const phone = ways && typeof ways === 'object' ? ways.phone : null;
  const email = ways && typeof ways === 'object' ? ways.email : null;

  return (
    <View className="gap-3 rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-stone-800" accessibilityLabel="Reach out">
      {asked ? (
        <>
          <Text className="text-body text-stone-800 dark:text-stone-100">Did you reach out to {first}?</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pill label="Yes" variant="filled" disabled={busy} onPress={reached} />
            <Pill label="Not yet" disabled={busy} onPress={() => setAsked(false)} />
          </View>
        </>
      ) : phone || email ? (
        <>
          <View className="flex-row flex-wrap gap-2">
            {phone && <Pill label="Text" icon="chatbubble-outline" variant="filled" onPress={go(() => openText(phone))} />}
            {phone && <Pill label="Call" icon="call-outline" onPress={go(() => openCall(phone))} />}
            {email && <Pill label="Email" icon="mail-outline" variant={phone ? 'outline' : 'filled'} onPress={go(() => openEmail(email))} />}
          </View>
          <Text className="text-caption text-stone-500 dark:text-stone-400">
            Opens your phone with an empty message. Limen doesn&apos;t keep their number or email.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Pill label="I reached out" disabled={busy} onPress={reached} />
            <Pill label="Unlink contact" disabled={busy} onPress={unlink} />
          </View>
        </>
      ) : (
        <>
          <Text className="text-body text-stone-700 dark:text-stone-300">Reach out however you usually do.</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pill label="I reached out" variant="filled" disabled={busy} onPress={reached} />
            {CAN_USE_CONTACTS && !friend.contact_id && <Pill label="Link to a contact" icon="person-outline" disabled={busy} onPress={link} />}
            {CAN_USE_CONTACTS && friend.contact_id && <Pill label="Unlink contact" disabled={busy} onPress={unlink} />}
          </View>
          {CAN_USE_CONTACTS && !friend.contact_id && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Link {first} to a contact to text, call or email from here. Limen keeps only which contact it is, never their
              number or email.
            </Text>
          )}
          {ways === 'denied' && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              Limen can&apos;t see your contacts. You can allow it in your phone&apos;s settings.
            </Text>
          )}
          {ways === 'missing' && friend.contact_id && (
            <Text className="text-caption text-stone-500 dark:text-stone-400">
              The linked contact isn&apos;t on this phone. You can unlink it and link another.
            </Text>
          )}
        </>
      )}
      {note && <Text className="text-caption text-stone-600 dark:text-stone-300">{note}</Text>}
    </View>
  );
}
