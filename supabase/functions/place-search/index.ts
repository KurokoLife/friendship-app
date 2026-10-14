// Supabase Edge Function: place-search (2026-10-13)
//
// Place search for meetup plans through Google Places (New). The Google key
// stays here on the server (secret GOOGLE_PLACES_KEY), never in the app.
// When the key isn't set, or Google fails, this answers {unavailable: true}
// and the app falls back to OpenStreetMap search.
//
// Two steps, one billing "session" per search:
//   {action: "autocomplete", input, session, lat?, lng?, miles?}
//     -> {suggestions: [{id, name, address, meters}]}, near the person.
//   {action: "details", id, session}
//     -> {place: {name, address, lat, lng}} for the one they picked.
// Sending the same session token with both makes Google bill the typing
// as free and charge only the one details lookup (free under the monthly
// allowance). Only the person's rough area (from their profile) and what
// they typed are sent to Google.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_KEY') ?? '';
const TIMEOUT_MS = 6000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Signed-in people only, so the key can't be used by anyone on the web.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not authenticated' }, 401);

  if (!GOOGLE_KEY) return json({ unavailable: true });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  const session = text(body.session, 64);

  try {
    if (body.action === 'autocomplete') {
      const input = text(body.input, 120);
      if (input.length < 2) return json({ suggestions: [] });
      const lat = num(body.lat);
      const lng = num(body.lng);
      const miles = Math.min(75, Math.max(5, num(body.miles) ?? 30));
      const request: Record<string, unknown> = { input, languageCode: 'en' };
      if (session) request.sessionToken = session;
      if (lat !== null && lng !== null) {
        // Only places within the person's area, nearest ones ranked first.
        request.locationRestriction = { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(50000, miles * 1609) } };
        request.origin = { latitude: lat, longitude: lng };
      }
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return json({ unavailable: true, status: res.status });
      const data = await res.json();
      const suggestions = ((data?.suggestions ?? []) as Record<string, any>[])
        .map((s) => s.placePrediction)
        .filter((p) => p?.placeId)
        .slice(0, 6)
        .map((p) => ({
          id: String(p.placeId),
          name: text(p.structuredFormat?.mainText?.text ?? p.text?.text, 120),
          address: text(p.structuredFormat?.secondaryText?.text, 200) || null,
          meters: num(p.distanceMeters),
        }))
        .filter((s) => s.name);
      return json({ suggestions });
    }

    if (body.action === 'details') {
      const id = text(body.id, 300);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return json({ error: 'Bad place' }, 400);
      const url = new URL(`https://places.googleapis.com/v1/places/${id}`);
      if (session) url.searchParams.set('sessionToken', session);
      url.searchParams.set('languageCode', 'en');
      const res = await fetch(url, {
        headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return json({ unavailable: true, status: res.status });
      const p = await res.json();
      return json({
        place: {
          name: text(p?.displayName?.text, 120),
          address: text(p?.formattedAddress, 200) || null,
          lat: num(p?.location?.latitude),
          lng: num(p?.location?.longitude),
        },
      });
    }
  } catch {
    return json({ unavailable: true });
  }
  return json({ error: 'Unknown action' }, 400);
});
