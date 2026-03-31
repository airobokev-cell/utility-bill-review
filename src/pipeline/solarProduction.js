const { fetchJSON } = require('../utils/apiClient');
const {
  PVWATTS_BASE_URL,
  DEFAULT_MODULE_TYPE,
  DEFAULT_LOSSES,
  DEFAULT_ARRAY_TYPE,
  DEFAULT_TILT,
  DEFAULT_AZIMUTH,
} = require('../constants');

async function estimateProduction(lat, lon, systemCapacityKw, signal) {
  if (!process.env.NREL_API_KEY) {
    console.warn('[solarProduction] No NREL_API_KEY set, using estimates');
    return estimateFallback(lat, systemCapacityKw);
  }

  const params = new URLSearchParams({
    api_key: process.env.NREL_API_KEY,
    system_capacity: systemCapacityKw.toString(),
    module_type: DEFAULT_MODULE_TYPE.toString(),
    losses: DEFAULT_LOSSES.toString(),
    array_type: DEFAULT_ARRAY_TYPE.toString(),
    tilt: DEFAULT_TILT.toString(),
    azimuth: DEFAULT_AZIMUTH.toString(),
    lat: lat.toString(),
    lon: lon.toString(),
  });

  const url = `${PVWATTS_BASE_URL}?${params}`;
  console.log(`[solarProduction] Querying PVWatts for ${systemCapacityKw} kW at ${lat}, ${lon}`);

  const data = await fetchJSON(url, { signal });

  if (data.errors && data.errors.length > 0) {
    throw new Error(`PVWatts error: ${data.errors.join(', ')}`);
  }

  const result = {
    acAnnual: data.outputs.ac_annual,
    acMonthly: data.outputs.ac_monthly,
    solradAnnual: data.outputs.solrad_annual,
    solradMonthly: data.outputs.solrad_monthly,
    capacityFactor: data.outputs.capacity_factor,
  };

  console.log(`[solarProduction] Annual production: ${Math.round(result.acAnnual)} kWh`);
  return result;
}

function estimateFallback(lat, systemCapacityKw) {
  // Rough estimate: northern IL gets ~1,200-1,300 kWh/kW/year
  const kwhPerKw = lat > 40 ? 1250 : lat > 35 ? 1400 : 1550;
  const acAnnual = systemCapacityKw * kwhPerKw;

  // Monthly distribution for northern IL (approximate)
  const monthlyFactors = [0.05, 0.06, 0.08, 0.09, 0.10, 0.11, 0.12, 0.11, 0.10, 0.08, 0.06, 0.04];
  const acMonthly = monthlyFactors.map((f) => acAnnual * f);

  console.log(`[solarProduction] Fallback estimate: ${Math.round(acAnnual)} kWh/year`);
  return {
    acAnnual,
    acMonthly,
    solradAnnual: kwhPerKw / 365,
    solradMonthly: monthlyFactors.map((f) => (acAnnual * f) / 30 / systemCapacityKw),
    capacityFactor: kwhPerKw / 8760 * 100,
  };
}

module.exports = { estimateProduction };
