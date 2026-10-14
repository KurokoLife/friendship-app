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

type Suggestion = PlaceValue & { key: string; distance?: string | null; googleId?: string };

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};

// Place search for meetup plans (2026-10-09). Since 2026-10-13 it asks
// Google Places first (server function place-search, key kept on the
// server) and falls back to OpenStreetMap through Photon (free, no key) and keeps the place's
// name, street address and map position, so the plan can open in Google
// Maps or Apple Maps. Typing a place without picking a suggestion still
// works, it is just saved as typed. Results stay near the person's own
// city from their profile (see searchPlaces).
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

type Area = { lat: number; lng: number; miles: number };

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const x =
    Math.sin(r(a.lat)) * Math.sin(r(b.lat)) + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng) - r(a.lng));
  return 3959 * Math.acos(Math.min(1, Math.max(-1, x)));
}

// "@Eatalian, gardena" -> "Eatalian gardena": symbols and commas only get
// in the way of the search.
export function cleanPlaceQuery(text: string): string {
  return text
    .replace(/[@#*"“”]/g, ' ')
    .replace(/[,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function photon(params: URLSearchParams): Promise<PhotonFeature[]> {
  const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  return json.features ?? [];
}

// Near the person only (2026-10-13): when their profile has a location,
// results are limited to a box around it (their Discover distance, at
// least 25 and at most 75 miles) and sorted by distance, so a search in Los
// Angeles never lists places in another state or country.
async function searchPlaces(raw: string, area: Area | null): Promise<Suggestion[]> {
  const text = cleanPlaceQuery(raw);
  if (text.length < 2) return [];
  const base = () => new URLSearchParams({ q: text, limit: '15', lang: 'en' });
  let features: PhotonFeature[];
  if (area) {
    const dLat = area.miles / 69;
    const dLng = area.miles / (69 * Math.max(0.2, Math.cos((area.lat * Math.PI) / 180)));
    const params = base();
    params.set('bbox', [area.lng - dLng, area.lat - dLat, area.lng + dLng, area.lat + dLat].map((n) => n.toFixed(3)).join(','));
    params.set('lat', area.lat.toFixed(2));
    params.set('lon', area.lng.toFixed(2));
    params.set('location_bias_scale', '0.1');
    features = await photon(params);
  } else {
    features = await photon(base());
  }
  const seen = new Set<string>();
  const out: (Suggestion & { miles: number | null })[] = [];
  features.forEach((f, i) => {
    const s = toSuggestion(f, i);
    if (!s) return;
    const k = `${s.name}|${s.address}`;
    if (seen.has(k)) return;
    seen.add(k);
    const miles = area && s.lat != null && s.lng != null ? milesBetween(area, { lat: s.lat, lng: s.lng }) : null;
    if (area && miles != null && miles > area.miles * 1.5) return;
    out.push({ ...s, miles });
  });
  if (area) out.sort((a, b) => (a.miles ?? 9999) - (b.miles ?? 9999));
  return out.slice(0, 6).map(({ miles, ...s }) => ({
    ...s,
    distance: distanceText(miles),
  }));
}

function newSession(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function distanceText(miles: number | null): string | null {
  if (miles == null) return null;
  return miles < 1 ? 'Under a mile away' : `${Math.round(miles)} mi away`;
}

// Google Places through our own server function (2026-10-13). Returns null
// when Google isn't set up or doesn't answer, so OpenStreetMap is used.
async function searchGoogle(raw: string, area: Area | null, session: string): Promise<Suggestion[] | null> {
  const input = cleanPlaceQuery(raw);
  if (input.length < 2) return [];
  const { data, error } = await supabase.functions.invoke('place-search', {
    body: { action: 'autocomplete', input, session, lat: area?.lat, lng: area?.lng, miles: area?.miles },
  });
  if (error || !data || data.unavailable || !Array.isArray(data.suggestions)) return null;
  return (data.suggestions as { id: string; name: string; address: string | null; meters: number | null }[])
    .slice()
    .sort((a, b) => (a.meters ?? 1e9) - (b.meters ?? 1e9))
    .map((g) => ({
      key: `g:${g.id}`,
      googleId: g.id,
      name: g.name,
      address: g.address,
      lat: null,
      lng: null,
      distance: distanceText(g.meters == null ? null : g.meters / 1609),
    }));
}

async function googleDetails(id: string, session: string): Promise<PlaceValue | null> {
  const { data, error } = await supabase.functions.invoke('place-search', { body: { action: 'details', id, session } });
  const p = data?.place;
  if (error || !p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
  return { name: p.name || '', address: p.address ?? null, lat: p.lat, lng: p.lng };
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
  const area = useRef<Area | null>(null);
  const requestId = useRef(0);
  const session = useRef(newSession());
  const googleOff = useRef(false);
  const [source, setSource] = useState<'google' | 'osm'>('osm');

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('location_lat, location_lng, search_radius_miles')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data?.location_lat != null && data?.location_lng != null) {
        const radius = Number(data.search_radius_miles) || 25;
        area.current = {
          lat: data.location_lat as number,
          lng: data.location_lng as number,
          miles: Math.min(75, Math.max(25, radius)),
        };
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
        let found: Suggestion[] | null = null;
        if (!googleOff.current) {
          found = await searchGoogle(text, area.current, session.current).catch(() => null);
          if (found === null) googleOff.current = true;
        }
        const from = found === null ? 'osm' : 'google';
        if (found === null) found = await searchPlaces(text, area.current);
        if (id !== requestId.current) return;
        setSource(from);
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
                : area.current
                  ? 'No places found near you. Try just the name, or keep what you typed.'
                  : 'No places found. You can keep what you typed.'}
            </Text>
          ) : (
            results.map((r) => (
              <Pressable
                key={r.key}
                onPress={async () => {
                  setOpen(false);
                  setResults([]);
                  if (r.googleId) {
                    const id = r.googleId;
                    const token = session.current;
                    session.current = newSession();
                    // Shows the name at once; the address and map position fill in.
                    onChange({ name: r.name, address: null, lat: null, lng: null });
                    const place = await googleDetails(id, token).catch(() => null);
                    onChange(
                      place
                        ? { ...place, name: r.name || place.name }
                        : { name: r.name, address: r.address, lat: null, lng: null }
                    );
                    return;
                  }
                  onChange({ name: r.name, address: r.address, lat: r.lat, lng: r.lng });
                }}
                className="gap-0.5 border-b border-stone-100 px-3 py-2 active:bg-stone-100 dark:border-stone-700/60 dark:active:bg-stone-700">
                <Text className="text-body text-stone-900 dark:text-stone-50">{r.name}</Text>
                {(r.address || r.distance) && (
                  <Text className="text-caption text-stone-500 dark:text-stone-400">
                    {[r.address, r.distance].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </Pressable>
            ))
          )}
          <Text className="px-3 py-1 text-[10px] text-stone-400 dark:text-stone-500">
            {source === 'google' ? 'Powered by Google' : 'Place data © OpenStreetMap'}
          </Text>
        </View>
      )}
    </View>
  );
}
