const real = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('places.googleapis.com/v1/places:autocomplete')) {
    const b = JSON.parse(init.body);
    console.error('AUTOCOMPLETE', JSON.stringify(b));
    return new Response(JSON.stringify({ suggestions: [
      { placePrediction: { placeId: 'far1', structuredFormat: { mainText: { text: 'Eatalian Cafe' }, secondaryText: { text: 'Gardena, CA, USA' } }, distanceMeters: 22000 } },
      { placePrediction: { placeId: 'near1', structuredFormat: { mainText: { text: 'Eatalian Express' }, secondaryText: { text: 'Los Angeles, CA, USA' } }, distanceMeters: 900 } },
    ] }), { status: 200 });
  }
  if (url.includes('places.googleapis.com/v1/places/')) {
    console.error('DETAILS', url, JSON.stringify(init.headers));
    return new Response(JSON.stringify({ displayName: { text: 'Eatalian Cafe' }, formattedAddress: '1007 W 190th St, Gardena, CA 90248, USA', location: { latitude: 33.858, longitude: -118.293 } }), { status: 200 });
  }
  return real(input, init);
}) as typeof fetch;
await import('../supabase/functions/place-search/index.ts');
