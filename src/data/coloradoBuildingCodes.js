/**
 * Colorado building code eras — maps year built to likely insulation,
 * windows, HVAC characteristics, and upgrade opportunity.
 *
 * Used by the Virtual Energy Auditor to infer asset-based efficiency
 * signals from property data (year built).
 *
 * Note: ~60% of Front Range homes have gas furnaces, so winter electric
 * spikes are usually NOT from space heating. This is critical context.
 */
const COLORADO_CODE_ERAS = [
  {
    range: [0, 1949],
    label: 'Pre-code',
    likelyInsulation: 'None to R-5 walls, R-0 to R-11 attic',
    likelyWindows: 'Single pane wood',
    likelyHvac: 'Gravity furnace or floor furnace, no AC',
    likelyHeatingFuel: 'gas',
    notes: 'No building energy codes. Balloon framing common pre-1940. High air leakage.',
    upgradeOpportunityModifier: 15,
    typicalMeasures: ['air_sealing', 'attic_insulation', 'window_replacement', 'duct_sealing'],
  },
  {
    range: [1950, 1969],
    label: 'Post-war / minimal code',
    likelyInsulation: 'R-5 to R-11 walls, R-11 to R-19 attic',
    likelyWindows: 'Single pane aluminum or wood',
    likelyHvac: '60-70% AFUE furnace, window AC or evap cooler',
    likelyHeatingFuel: 'gas',
    notes: 'Denver adopted basic building codes. Insulation minimal by modern standards.',
    upgradeOpportunityModifier: 12,
    typicalMeasures: ['air_sealing', 'attic_insulation', 'duct_sealing', 'smart_thermostat'],
  },
  {
    range: [1970, 1979],
    label: 'Energy crisis era',
    likelyInsulation: 'R-11 walls, R-19 attic',
    likelyWindows: 'Single or early double pane',
    likelyHvac: '70-78% AFUE furnace, central AC emerging',
    likelyHeatingFuel: 'gas',
    notes: 'Post-1973 oil crisis drove first meaningful insulation requirements. Many CO ranch homes from this era.',
    upgradeOpportunityModifier: 10,
    typicalMeasures: ['attic_insulation', 'air_sealing', 'duct_sealing', 'smart_thermostat'],
  },
  {
    range: [1980, 1991],
    label: 'Early energy codes',
    likelyInsulation: 'R-13 walls, R-30 attic',
    likelyWindows: 'Double pane aluminum',
    likelyHvac: '78-80% AFUE furnace, SEER 8-10 AC',
    likelyHeatingFuel: 'gas',
    notes: 'Colorado adopted CABO MEC. Significant improvement but still below modern standards.',
    upgradeOpportunityModifier: 6,
    typicalMeasures: ['attic_insulation', 'air_sealing', 'smart_thermostat'],
  },
  {
    range: [1992, 2005],
    label: 'Modern codes / IECC adoption',
    likelyInsulation: 'R-13 to R-15 walls, R-38 attic',
    likelyWindows: 'Double pane vinyl, low-E emerging',
    likelyHvac: '80-90% AFUE furnace, SEER 10-13 AC',
    likelyHeatingFuel: 'gas',
    notes: 'Colorado jurisdictions adopted IECC variably. Significant variation by jurisdiction.',
    upgradeOpportunityModifier: 3,
    typicalMeasures: ['attic_insulation', 'smart_thermostat'],
  },
  {
    range: [2006, 2015],
    label: 'IECC 2006/2009',
    likelyInsulation: 'R-15+ walls, R-38 to R-49 attic',
    likelyWindows: 'Double pane low-E',
    likelyHvac: '90%+ AFUE furnace, SEER 13+ AC',
    likelyHeatingFuel: 'gas',
    notes: 'Most Front Range jurisdictions on IECC 2009 by 2012.',
    upgradeOpportunityModifier: 0,
    typicalMeasures: ['smart_thermostat'],
  },
  {
    range: [2016, 2099],
    label: 'Modern / IECC 2015+',
    likelyInsulation: 'R-20+ walls, R-49 attic',
    likelyWindows: 'Double or triple pane low-E',
    likelyHvac: '92%+ AFUE or heat pump, SEER 14+',
    likelyHeatingFuel: 'gas_or_electric',
    notes: 'Denver adopted IECC 2015+. Newer homes unlikely to have major efficiency gaps.',
    upgradeOpportunityModifier: -5,
    typicalMeasures: [],
  },
];

/**
 * Xcel Energy DSM (Demand Side Management) rebate programs — Colorado.
 * These reduce the homeowner's out-of-pocket cost for efficiency upgrades.
 * Source: Xcel Energy rebate catalog 2025-2026.
 */
const XCEL_REBATES = {
  attic_insulation: {
    name: 'Insulation Rebate',
    amount: 300,
    unit: 'per project',
    description: 'Xcel rebate for attic insulation upgrade to R-49+',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/heating_and_cooling/insulation',
  },
  air_sealing: {
    name: 'Home Energy Audit + Sealing',
    amount: 200,
    unit: 'per project',
    description: 'Xcel rebate for air sealing performed by qualifying contractor',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/home_energy_audit',
  },
  smart_thermostat: {
    name: 'Smart Thermostat Rebate',
    amount: 75,
    unit: 'per thermostat',
    description: 'Xcel rebate for ENERGY STAR certified smart thermostat',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/heating_and_cooling/smart_thermostat',
  },
  heat_pump: {
    name: 'Heat Pump Rebate',
    amount: 1000,
    unit: 'per system',
    description: 'Xcel rebate for qualifying air-source heat pump installation',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/heating_and_cooling/heat_pumps',
  },
  duct_sealing: {
    name: 'Duct Sealing Rebate',
    amount: 150,
    unit: 'per project',
    description: 'Xcel rebate for duct sealing and insulation',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/heating_and_cooling/insulation',
  },
  window_replacement: {
    name: 'Window Rebate',
    amount: 3, // per sqft
    unit: 'per sqft of window',
    description: 'Xcel rebate for ENERGY STAR certified window replacement',
    url: 'https://www.xcelenergy.com/programs_and_rebates/residential_programs_and_rebates/windows',
  },
};

/**
 * Look up building code era for a given year built.
 */
function getCodeEra(yearBuilt) {
  if (!yearBuilt) return null;
  return COLORADO_CODE_ERAS.find(era => yearBuilt >= era.range[0] && yearBuilt <= era.range[1]) || null;
}

module.exports = { COLORADO_CODE_ERAS, XCEL_REBATES, getCodeEra };
