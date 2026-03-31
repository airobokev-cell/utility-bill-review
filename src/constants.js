module.exports = {
  PORT: parseInt(process.env.PORT) || 3002,
  CLAUDE_MODEL: 'claude-sonnet-4-5-20250929',
  CLAUDE_TIMEOUT_MS: 120000,

  // API endpoints
  PVWATTS_BASE_URL: 'https://developer.nrel.gov/api/pvwatts/v8.json',
  GOOGLE_SOLAR_BASE_URL: 'https://solar.googleapis.com/v1/buildingInsights:findClosest',
  GEOCODING_BASE_URL: 'https://maps.googleapis.com/maps/api/geocode/json',
  CENSUS_GEOCODING_URL: 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',

  // Solar system defaults
  DEFAULT_MODULE_TYPE: 1,       // 0=Standard, 1=Premium, 2=Thin film
  DEFAULT_LOSSES: 14.08,        // System losses % (NREL default)
  DEFAULT_ARRAY_TYPE: 1,        // Fixed roof mount
  DEFAULT_TILT: 20,             // Typical roof pitch degrees
  DEFAULT_AZIMUTH: 180,         // South-facing
  DEFAULT_DC_AC_RATIO: 1.2,
  PANEL_WATTAGE: 400,           // Watts per panel (modern standard)

  // Financial defaults — OUR pricing (vertical installer, no ITC)
  FEDERAL_ITC_RATE: 0,           // We skip the ITC entirely
  SYSTEM_COST_PER_WATT: 2.25,   // Our installed price to customer (no ITC, no markup)
  BATTERY_COST_13KWH: 10000,    // Our battery price (13.5 kWh installed)
  ANNUAL_DEGRADATION: 0.005,    // 0.5% per year panel degradation
  ANALYSIS_YEARS: 25,           // Standard solar warranty period
  DISCOUNT_RATE: 0.04,          // 4% for NPV calculations

  // Loan defaults (our financing product)
  DEFAULT_LOAN_RATE: 0.065,     // 6.5% APR — no dealer fee
  DEFAULT_LOAN_TERM_YEARS: 25,

  // Colorado / Xcel Energy defaults (primary market)
  MARKET: 'colorado',
  NET_METERING_CREDIT_RATE: 1.0, // Colorado: full retail net metering credit
  AVOIDED_COST_RATE: 0.04,      // $/kWh for annual true-up cashout
  ANNUAL_RATE_ESCALATION: 0.05, // 5% — Xcel has been raising rates aggressively

  // Colorado has no SRECs or state solar credit
  STATE_INCENTIVE_VALUE: 0,

  // Seasonal consumption factors (Jan-Dec) for Colorado Front Range
  // Heating-driven winters + AC summers, bimodal pattern
  SEASONAL_FACTORS: [1.10, 1.00, 0.85, 0.70, 0.65, 0.80, 1.05, 1.10, 0.85, 0.70, 0.85, 1.05],

  // Upload limits
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
};
