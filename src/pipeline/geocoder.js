const { fetchJSON } = require('../utils/apiClient');
const { GEOCODING_BASE_URL, CENSUS_GEOCODING_URL } = require('../constants');

async function geocodeAddress(address, city, state, zip, signal) {
  const fullAddress = `${address}, ${city}, ${state} ${zip}`;
  console.log(`[geocoder] Geocoding: ${fullAddress}`);

  // Try Google Geocoding first if API key is available
  if (process.env.GOOGLE_API_KEY) {
    try {
      const url = `${GEOCODING_BASE_URL}?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_API_KEY}`;
      const data = await fetchJSON(url, { signal });

      if (data.results && data.results.length > 0) {
        const loc = data.results[0].geometry.location;
        console.log(`[geocoder] Google result: ${loc.lat}, ${loc.lng}`);
        return { lat: loc.lat, lon: loc.lng };
      }
    } catch (err) {
      // If aborted (client disconnected), re-throw — don't fall back
      if (signal?.aborted) throw err;
      console.warn(`[geocoder] Google geocoding failed, trying Census fallback: ${err.message}`);
    }
  }

  // Fallback: US Census Bureau geocoder (free, no key)
  const url = `${CENSUS_GEOCODING_URL}?address=${encodeURIComponent(fullAddress)}&benchmark=Public_AR_Current&format=json`;
  const data = await fetchJSON(url, { signal });

  const matches = data.result?.addressMatches;
  if (!matches || matches.length === 0) {
    throw new Error(`Could not geocode address: ${fullAddress}`);
  }

  const coords = matches[0].coordinates;
  console.log(`[geocoder] Census result: ${coords.y}, ${coords.x}`);
  return { lat: coords.y, lon: coords.x };
}

module.exports = { geocodeAddress };
