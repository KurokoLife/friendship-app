// Supabase Edge Function: geocode-city
//
// Deploy: supabase functions deploy geocode-city
//
// Fix 2a (2026-07-16): turns a plain city name into lat/lng using
// OpenStreetMap's free Nominatim geocoding API (no API key required). Done
// server-side rather than calling Nominatim directly from the client: their
// usage policy requires a real, identifying User-Agent header and a
// maximum of one request per second, both easier to guarantee from one
// server-side place than from every device running this app.
//
// Fix 1 (2026-07-17): accepts structured {city, state, country} instead of
// a single free-text string, and now uses Nominatim's structured search
// parameters (city=/state=/country=) plus addressdetails=1 so the response
// carries Nominatim's own normalized city/state/country strings back,
// instead of trusting whatever capitalization/spelling the user typed.
// This is the actual fix for "los angeles, ca" vs "Los Angeles, CA": both
// now resolve to the same standardized values before they're ever stored.
//
// Fix 2 (2026-07-17): also accepts {zip, country} as an alternative to
// {city, state, country}, for the client's new "Enter zip code" path.
// Country is required whenever zip is used (postal codes collide across
// countries, verified live: "73301" with no country resolved to a village
// in Estonia instead of the intended Austin, TX area).
//
// For United States zips specifically, this calls Zippopotam.us
// (api.zippopotam.us, also free, no key) instead of Nominatim's own
// postalcode search. Verified live that Nominatim's postalcode search for
// US zips only returns county/state in its address breakdown, never an
// actual city ("90001" resolved to just "Los Angeles County, California",
// no city field at all, and reverse-geocoding the returned coordinates at
// various zoom levels came back with an inconsistent, sometimes wrong,
// nearby place name instead), an unreliable basis for exactly what this
// alternative path is supposed to do. Zippopotam is purpose-built for zip
// to place-name lookups and returned the correct city for every real zip
// tested ("90001" to Los Angeles, "73301" to Austin). Every other country
// still goes through Nominatim's postalcode search, the same known
// county-only limitation applies there, a deliberate scope narrowing
// (this app's current seed data and real usage is US-only) rather than
// integrating a third geocoding provider for global postal code coverage.
//
// Requires a real signed-in user (same auth pattern as every other Edge
// Function in this app), but otherwise has no reason to touch the
// database at all, it's a pure lookup, the caller writes the result to
// their own profile themselves.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Nominatim's usage policy requires a real, identifying User-Agent, a
// generic or missing one risks being blocked outright.
const NOMINATIM_USER_AGENT = 'friendship-app/1.0 (geocode-city Edge Function)';

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

type ZippopotamResponse = {
  country: string;
  places: { 'place name': string; state: string; latitude: string; longitude: string }[];
};

type GeocodeResult = {
  lat: number;
  lng: number;
  city: string;
  state: string;
  country: string;
  displayName: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

async function geocodeUsZip(zip: string): Promise<GeocodeResult | null> {
  const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as ZippopotamResponse;
  const place = data.places?.[0];
  if (!place) return null;
  return {
    lat: parseFloat(place.latitude),
    lng: parseFloat(place.longitude),
    city: place['place name'],
    state: place.state,
    country: 'United States',
    displayName: `${place['place name']}, ${place.state}, United States`,
  };
}

async function geocodeViaNominatim(params: {
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
}): Promise<GeocodeResult | null> {
  const searchParams = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '1' });
  if (params.zip) {
    searchParams.set('postalcode', params.zip);
  } else {
    searchParams.set('city', params.city!);
    if (params.state) searchParams.set('state', params.state);
  }
  if (params.country) searchParams.set('country', params.country);

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) return null;

  const results = (await response.json()) as NominatimResult[];
  if (!results.length) return null;

  // Nominatim's address breakdown doesn't always use the "city" key (some
  // places only get "town" or "village", and postal-code searches often
  // only get county/state with no city-level field at all), fall back
  // through the options it actually provides before falling back to what
  // the user typed (or, in zip mode, to an empty string, there's no typed
  // city to fall back to). Same reasoning for state and country.
  const address = results[0].address ?? {};
  const resolvedCity =
    address.city || address.town || address.village || address.hamlet || address.municipality || params.city || '';
  const resolvedState = address.state || params.state || '';
  const resolvedCountry = address.country || params.country || '';

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    city: resolvedCity,
    state: resolvedState,
    country: resolvedCountry,
    displayName: results[0].display_name,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  let body: { city?: string; state?: string; country?: string; zip?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const city = body.city?.trim();
  const state = body.state?.trim();
  const country = body.country?.trim();
  const zip = body.zip?.trim();

  if (!city && !zip) {
    return jsonResponse({ error: 'city or zip is required' }, 400);
  }
  if (zip && !country) {
    return jsonResponse({ error: 'country is required when looking up a zip code' }, 400);
  }

  try {
    let result: GeocodeResult | null = null;

    if (zip && country === 'United States') {
      result = await geocodeUsZip(zip);
    }
    // Falls through to Nominatim both for non-US zips and as a fallback
    // if the direct US zip lookup above didn't find anything (an invalid
    // or discontinued zip Zippopotam doesn't have).
    if (!result) {
      result = await geocodeViaNominatim({ city, state, country, zip });
    }

    if (!result) {
      return jsonResponse({ error: zip ? 'Could not find that zip code' : 'Could not find that city' }, 404);
    }

    return jsonResponse(result);
  } catch {
    return jsonResponse({ error: 'Geocoding request failed' }, 502);
  }
});
