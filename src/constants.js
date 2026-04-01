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
  FEDERAL_ITC_RATE: 0,           // Section 25D expired Dec 31, 2025 for residential
  SYSTEM_COST_PER_WATT: 2.25,   // Our installed price to customer (no ITC, no markup)
  ANNUAL_DEGRADATION: 0.005,    // 0.5% per year panel degradation
  ANALYSIS_YEARS: 25,           // Standard solar warranty period
  DISCOUNT_RATE: 0.04,          // 4% for NPV calculations

  // Battery defaults — market pricing ranges $400-600/kWh installed (2026)
  BATTERY_COST_PER_KWH: 500,            // $/kWh installed (mid-range market rate)
  BATTERY_CAPACITY_KWH: 13.5,           // Standard residential battery (e.g. Tesla Powerwall 3)
  BATTERY_ROUND_TRIP_EFFICIENCY: 0.90,  // 90% round-trip efficiency
  BATTERY_ANNUAL_DEGRADATION: 0.02,     // ~2% capacity loss per year (conservative; range 0.5-3%)
  BATTERY_WARRANTY_YEARS: 10,

  // Loan defaults (our financing product)
  DEFAULT_LOAN_RATE: 0.065,     // 6.5% APR — no dealer fee
  DEFAULT_LOAN_TERM_YEARS: 25,

  // Colorado / Xcel Energy defaults (primary market)
  MARKET: 'colorado',

  // ── Xcel Energy Residential Rate Schedules ──────────────────────────
  // Source: Xcel Energy Colorado tariff sheets (effective 2025-2026)
  XCEL_FLAT_RATE: {
    name: 'Residential R',
    supplyPerKwh: 0.085,           // ~8.5¢ generation
    deliveryPerKwh: 0.055,         // ~5.5¢ transmission + distribution
    totalPerKwh: 0.152,            // ~15.2¢ all-in effective rate
    fixedChargeMonthly: 10.20,     // Monthly service/meter charge
  },
  XCEL_TOU_RATE: {
    name: 'Residential TOU-R',
    onPeak: {                      // Weekdays 3-7 PM (summer) / 6-10 AM & 5-9 PM (winter)
      supplyPerKwh: 0.12,
      deliveryPerKwh: 0.08,
      totalPerKwh: 0.20,
    },
    offPeak: {                     // All other hours
      supplyPerKwh: 0.045,
      deliveryPerKwh: 0.035,
      totalPerKwh: 0.08,
    },
    fixedChargeMonthly: 10.20,
    // Solar mostly produces during off-peak/shoulder in Xcel's TOU-R schedule
    // Peak is 3-7 PM summer when solar is declining; winter peak has no solar
    solarOnPeakFraction: 0.15,     // ~15% of solar generation falls in on-peak
    solarOffPeakFraction: 0.85,    // ~85% of solar generation falls in off-peak
    consumptionOnPeakFraction: 0.35, // ~35% of consumption is during on-peak
    consumptionOffPeakFraction: 0.65,
  },

  // Colorado net metering — SB 23-258 (effective 2024)
  // New net metering customers receive credits at a reduced "net metering credit rate"
  // rather than full retail. The credit rate is set by the PUC and is typically
  // close to the avoided cost of energy, not the full retail rate.
  NET_METERING_CREDIT_RATE: 0.75, // ~75% of retail (SB 23-258 reduced credit for new systems)
  AVOIDED_COST_RATE: 0.04,        // $/kWh for annual true-up cashout

  // Colorado historical rate escalation: ~2-3% annual average
  // (Xcel has had some aggressive years, but long-term average is lower than 5%)
  ANNUAL_RATE_ESCALATION: 0.03,  // 3% — Colorado historical average

  // Colorado has no SRECs or state solar credit
  STATE_INCENTIVE_VALUE: 0,

  // Colorado solar property tax exemption (C.R.S. 39-1-104(16))
  // Solar energy systems are 100% exempt from property tax assessment
  COLORADO_PROPERTY_TAX_EXEMPT: true,

  // Seasonal consumption factors (Jan-Dec) for Colorado Front Range
  // Heating-driven winters + AC summers, bimodal pattern
  SEASONAL_FACTORS: [1.10, 1.00, 0.85, 0.70, 0.65, 0.80, 1.05, 1.10, 0.85, 0.70, 0.85, 1.05],

  // ── Energy Efficiency Audit Defaults ─────────────────────────────────
  COLORADO_MEDIAN_ANNUAL_KWH: 7200,  // ~600 kWh/month median for Xcel territory
  DENVER_ALTITUDE_FT: 5280,          // Altitude affects HVAC performance
  // Furnaces lose ~4% efficiency per 1,000 ft altitude
  // Heat pump COP reduction: ~15-20% at Denver altitude vs sea level

  // Upload limits
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
};
