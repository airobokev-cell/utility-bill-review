const { fetchJSON } = require('../utils/apiClient');
const { GOOGLE_SOLAR_BASE_URL, PANEL_WATTAGE } = require('../constants');

async function analyzeRoof(lat, lon, signal) {
  if (!process.env.GOOGLE_API_KEY) {
    console.warn('[roofAnalysis] No GOOGLE_API_KEY set, using defaults');
    return getDefaultRoofData();
  }

  try {
    const url = `${GOOGLE_SOLAR_BASE_URL}?location.latitude=${lat}&location.longitude=${lon}&requiredQuality=HIGH&key=${process.env.GOOGLE_API_KEY}`;
    console.log(`[roofAnalysis] Querying Google Solar API for ${lat}, ${lon}`);

    const data = await fetchJSON(url, { signal });

    if (!data.solarPotential) {
      console.warn('[roofAnalysis] No solar potential data, using defaults');
      return getDefaultRoofData();
    }

    const sp = data.solarPotential;
    const maxSystemKw = (sp.maxArrayPanelsCount * PANEL_WATTAGE) / 1000;

    const result = {
      maxPanels: sp.maxArrayPanelsCount,
      maxArrayAreaM2: sp.maxArrayAreaMeters2,
      maxSunshineHoursPerYear: sp.maxSunshineHoursPerYear,
      maxSystemKw,
      panelConfigs: (sp.solarPanelConfigs || []).slice(0, 10).map((c) => ({
        panelsCount: c.panelsCount,
        yearlyEnergyDcKwh: c.yearlyEnergyDcKwh,
        systemKw: (c.panelsCount * PANEL_WATTAGE) / 1000,
      })),
      // Roof segment details for panel designer
      roofSegments: (sp.roofSegmentStats || []).map((seg) => ({
        pitchDegrees: seg.pitchDegrees,
        azimuthDegrees: seg.azimuthDegrees,
        areaMeters2: seg.stats?.areaMeters2 || 0,
        sunshineQuantiles: seg.stats?.sunshineQuantiles || [],
        panelsCount: seg.panelsCount || 0,
      })),
      // Building center from the API response
      buildingCenter: data.center ? { lat: data.center.latitude, lon: data.center.longitude } : null,
      buildingBoundingBox: data.boundingBox || null,
      isEstimate: false,
    };

    console.log(`[roofAnalysis] Roof fits up to ${result.maxPanels} panels (${result.maxSystemKw} kW)`);
    return result;
  } catch (err) {
    // If aborted (client disconnected), re-throw — don't fall back to defaults
    if (signal?.aborted) throw err;
    console.warn(`[roofAnalysis] Google Solar API failed: ${err.message}, using defaults`);
    return getDefaultRoofData();
  }
}

function getDefaultRoofData() {
  // Conservative default: 800 sq ft usable roof ≈ 74 m²
  // At ~18 sq ft per panel (400W), that's ~44 panels = 17.6 kW
  const maxPanels = 44;
  const maxSystemKw = (maxPanels * PANEL_WATTAGE) / 1000;

  return {
    maxPanels,
    maxArrayAreaM2: 74,
    maxSunshineHoursPerYear: 1600,
    maxSystemKw,
    panelConfigs: [],
    isEstimate: true,
  };
}

module.exports = { analyzeRoof };
