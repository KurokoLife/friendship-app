import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';

const MUTED_ICON_COLOR = '#a8a29e'; // stone-400

export type PlaceValue = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export const EMPTY_PLACE: PlaceValue = { name: '', address: null, lat: null, lng: null };

type Suggestion = PlaceValue & { key: string };

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

// Place search for meetup plans (2026-10-09). Searches OpenStreetMap
// through Photon (free, no account or key needed) and keeps the place's
// name, street address and map position, so the plan can open in Google
// Maps or Apple Maps. Typing a place without picking a suggestion still
// works, it is just saved as typed. Results lean towards the person's own
// city from their profile.
function toSuggestion(f: PhotonFeature, i: number): Suggestion | null {
  const p = f.properties ?? {};
  const coords = f.geometry?.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street;
  if (!name) return null;
  const area = [p.city || p.town || p.village || p.locality || p.district, p.state].filter(Boolean).join(', ');
  const address = [street !== name ? street : '', area].filter(Boolean).join(', ') || null;
  return {
    key: `${p.osm_type ?? ''}${p.osm_id ?? i}`,
    name: name.slice(0, 120),
    address: address ? address.slice(0, 200) : null,
    lat: coords ? coords[1] : null,
    lng: coords ? coords[0] : null,
  };
}

async function searchPlaces(text: string, bias: { lat: number; lng: number } | null): Promise<Suggestion[]> {
  const params = new URLSearchParams({ q: text, limit: '6', lang: 'en' });
  if (bias) {
    // Rounded: the search only needs a rough area, not an exact location.
    params.set('lat', bias.lat.toFixed(1));
    params.set('lon', bias.lng.toFixed(1));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  (json.features ?? []).forEach((f, i) => {
    const s = toSuggestion(f, i);
    if (!s) return;
    const k = `${s.name}|${s.address}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out.slice(0, 5);
}

export function PlaceField({
  value,
  onChange,
  disabled,
  placeholder = 'Search for a cafe, park, or address',
}: {
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const bias = useRef<{ lat: number; lng: number } | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('location_lat, location_lng')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data?.location_lat != null && data?.location_lng != null) {
        bias.current = { lat: data.location_lat as number, lng: data.location_lng as number };
      }
    })().catch(() => undefined);
  }, []);

  // Search while typing, but only for text the person typed (not a picked place).
  useEffect(() => {
    const text = value.name.trim();
    if (!open || text.length < 3 || value.lat != null) {
      setResults([]);
      setSearching(false);
      return;
    }
    const id = ++requestId.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(text, bias.current);
        if (id !== requestId.current) return;
        setResults(found);
        setSearchFailed(false);
      } catch {
        if (id !== requestId.current) return;
        setResults([]);
        setSearchFailed(true);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [value.name, value.lat, open]);

  const picked = value.lat != null && value.address != null;

  return (
    <View className="gap-1">
      <TextInput
        value={value.name}
        onChangeText={(t) => {
          setOpen(true);
          onChange({ name: t, address: null, lat: null, lng: null });
        }}
        placeholder={placeholder}
        placeholderTextColor={MUTED_ICON_COLOR}
        maxLength={120}
        editable={!disabled}
        className="rounded-xl border border-stone-300 px-3 py-2 text-body text-stone-900 dark:border-stone-700 dark:text-stone-50"
      />
      {picked && (
        <Text className="text-caption text-stone-500 dark:text-stone-400">📍 {value.address}</Text>
      )}
      {open && !picked && value.name.trim().length >= 3 && (
        <View className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
          {searching && results.length === 0 ? (
            <View className="flex-row items-center gap-2 px-3 py-2">
              <ActivityIndicator size="small" color={MUTED_ICON_COLOR} />
              <Text className="text-caption text-stone-500 dark:text-stone-400">Searching places...</Text>
            </View>
          ) : results.length === 0 ? (
            <Text className="px-3 py-2 text-caption text-stone-500 dark:text-stone-400">
              {searchFailed
                ? "Place search isn't working right now. You can keep what you typed."
                : 'No places found. You can keep what you typed.'}
            </Text>
          ) : (
            results.map((r) => (
              <Pressable
                key={r.key}
                onPress={() => {
                  setOpen(false);
                  setResults([]);
                  onChange({ name: r.name, address: r.address, lat: r.lat, lng: r.lng });
                }}
                className="gap-0.5 border-b border-stone-100 px-3 py-2 active:bg-stone-100 dark:border-stone-700/60 dark:active:bg-stone-700">
                <Text className="text-body text-stone-900 dark:text-stone-50">{r.name}</Text>
                {r.address && <Text className="text-caption text-stone-500 dark:text-stone-400">{r.address}</Text>}
              </Pressable>
            ))
          )}
          <Text className="px-3 py-1 text-[10px] text-stone-400 dark:text-stone-500">Place data © OpenStreetMap</Text>
        </View>
      )}
    </View>
  );
}
