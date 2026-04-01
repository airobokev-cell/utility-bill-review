/**
 * Virtual Energy Auditor — analyzes home energy efficiency from bill data
 * and optional property characteristics.
 *
 * Phase 1: Bill-only analysis (baseload, seasonality, peer comparison)
 * Phase 2: Property enrichment (year built, sqft → recommendations, post-upgrade sizing)
 *
 * Key Colorado insight: ~60% of Front Range homes have gas heat.
 * Winter electric spikes are usually NOT from space heating.
 * The scoring model accounts for this.
 */

const { getMedianForZip } = require('../data/coloradoMedianUsage');
const { getCodeEra, XCEL_REBATES } = require('../data/coloradoBuildingCodes');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Thresholds & Weights ─────────────────────────────────────────────

const BASELOAD_HIGH_THRESHOLD = 800;   // monthly kWh
const BASELOAD_LOW_THRESHOLD = 400;
const WINTER_SUMMER_RATIO_HIGH = 1.8;
const WINTER_SUMMER_RATIO_LOW = 0.6;
const DENVER_HDD_ANNUAL = 6020;
const DENVER_CDD_ANNUAL = 695;

// Score weights
const WEIGHT_PEER = 0.50;
const WEIGHT_SEASONAL = 0.30;
const WEIGHT_BASELOAD = 0.20;

// Efficiency measure cost estimates (Colorado 2026)
const EFFICIENCY_MEASURES = {
  attic_insulation: {
    name: 'Attic Insulation Upgrade',
    costRange: { low: 1500, high: 3500 },
    savingsKwhRange: { low: 400, high: 1200 },
    applicableSignals: ['high_usage', 'summer_spike', 'pre_2000_vintage'],
    priority: 1,
    description: 'Upgrade attic insulation to R-49 (current Colorado code). Reduces heating and cooling load.',
  },
  air_sealing: {
    name: 'Air Sealing',
    costRange: { low: 800, high: 1500 },
    savingsKwhRange: { low: 300, high: 900 },
    applicableSignals: ['high_usage', 'winter_spike', 'summer_spike', 'pre_1980_vintage'],
    priority: 2,
    description: 'Seal air leaks around windows, doors, attic penetrations, and foundation. Improves comfort and reduces HVAC runtime.',
  },
  duct_sealing: {
    name: 'Duct Sealing & Insulation',
    costRange: { low: 500, high: 2000 },
    savingsKwhRange: { low: 200, high: 800 },
    applicableSignals: ['high_usage', 'summer_spike', 'pre_2000_vintage'],
    priority: 3,
    description: 'Seal and insulate ductwork to reduce distribution losses. Especially impactful if ducts run through unconditioned space.',
  },
  smart_thermostat: {
    name: 'Smart Thermostat',
    costRange: { low: 150, high: 250 },
    savingsKwhRange: { low: 150, high: 500 },
    applicableSignals: ['high_baseload', 'summer_spike', 'winter_spike'],
    priority: 4,
    description: 'ENERGY STAR certified smart thermostat optimizes heating/cooling schedules automatically.',
  },
  heat_pump: {
    name: 'Heat Pump Conversion',
    costRange: { low: 8000, high: 18000 },
    savingsKwhRange: { low: 1500, high: 4000 },
    applicableSignals: ['electric_heat_detected'],
    priority: 5,
    requiresMiniAudit: true,
    description: 'Replace electric resistance heating with an air-source heat pump. Reduces heating electricity by up to 50-65% (altitude-adjusted for Denver).',
  },
};

// ── Phase 1: Bill-Only Analysis ──────────────────────────────────────

/**
 * Compute baseload, seasonality, and usage profile from monthly kWh data.
 */
function computeEfficiencyProfile(monthlyConsumption) {
  const annual = monthlyConsumption.reduce((s, v) => s + v, 0);

  // Baseload: average of lowest 3 months
  const sorted = [...monthlyConsumption].sort((a, b) => a - b);
  const baseloadMonthly = Math.round((sorted[0] + sorted[1] + sorted[2]) / 3);
  const baseloadAnnual = baseloadMonthly * 12;
  const baseloadSharePct = Math.round((baseloadAnnual / annual) * 100);
  const weatherSensitiveKwh = annual - baseloadAnnual;

  // Seasonality: winter (Nov, Dec, Jan, Feb) vs summer (Jun, Jul, Aug)
  const winterMonths = [monthlyConsumption[10], monthlyConsumption[11], monthlyConsumption[0], monthlyConsumption[1]];
  const summerMonths = [monthlyConsumption[5], monthlyConsumption[6], monthlyConsumption[7]];
  const winterAvg = winterMonths.reduce((s, v) => s + v, 0) / winterMonths.length;
  const summerAvg = summerMonths.reduce((s, v) => s + v, 0) / summerMonths.length;
  const seasonalityRatio = summerAvg > 0 ? +(winterAvg / summerAvg).toFixed(2) : null;

  // Detect heating/cooling signals
  let heatingSignal = 'none';
  let coolingSignal = 'none';

  if (seasonalityRatio !== null) {
    if (seasonalityRatio >= WINTER_SUMMER_RATIO_HIGH) heatingSignal = 'strong';
    else if (seasonalityRatio >= 1.4) heatingSignal = 'moderate';
    else if (seasonalityRatio >= 1.15) heatingSignal = 'weak';

    if (seasonalityRatio <= WINTER_SUMMER_RATIO_LOW) coolingSignal = 'strong';
    else if (seasonalityRatio <= 0.75) coolingSignal = 'moderate';
    else if (seasonalityRatio <= 0.9) coolingSignal = 'weak';
  }

  // Peak and trough months
  const maxIdx = monthlyConsumption.indexOf(Math.max(...monthlyConsumption));
  const minIdx = monthlyConsumption.indexOf(Math.min(...monthlyConsumption));

  return {
    baseloadMonthlyKwh: baseloadMonthly,
    baseloadAnnualKwh: baseloadAnnual,
    baseloadSharePct,
    weatherSensitiveKwh,
    seasonalityRatio,
    heatingSignal,
    coolingSignal,
    winterAvgKwh: Math.round(winterAvg),
    summerAvgKwh: Math.round(summerAvg),
    kwhPerMonth: monthlyConsumption,
    peakMonth: MONTH_NAMES[maxIdx],
    troughMonth: MONTH_NAMES[minIdx],
    annualKwh: annual,
  };
}

/**
 * Compare this home's usage to peer median in same zip code area.
 */
function computePeerComparison(annualKwh, zip, squareFeet) {
  const medianKwh = getMedianForZip(zip);
  const ratio = annualKwh / medianKwh;

  // Convert to percentile (approximate normal distribution)
  // Std dev of residential usage is roughly 30% of median
  const stdDev = medianKwh * 0.30;
  const zScore = (annualKwh - medianKwh) / stdDev;
  // Approximate percentile from z-score (simplified)
  const percentile = Math.min(99, Math.max(1, Math.round(50 + zScore * 30)));

  let comparisonLabel;
  if (percentile <= 25) comparisonLabel = 'Below Average';
  else if (percentile <= 60) comparisonLabel = 'Average';
  else if (percentile <= 80) comparisonLabel = 'Above Average';
  else comparisonLabel = 'High';

  const excessKwh = Math.max(0, annualKwh - medianKwh);
  const excessPct = medianKwh > 0 ? Math.round((excessKwh / medianKwh) * 100) : 0;

  return {
    annualKwh,
    medianKwh,
    percentile,
    comparisonLabel,
    excessKwh,
    excessPct,
    kwhPerSqFt: squareFeet ? +(annualKwh / squareFeet).toFixed(1) : null,
    medianKwhPerSqFt: squareFeet ? +(medianKwh / squareFeet).toFixed(1) : null,
  };
}

/**
 * Detect anomalies in usage patterns.
 */
function detectAnomalies(profile, peerComparison) {
  const anomalies = [];

  // High overall usage
  if (peerComparison.percentile >= 75) {
    anomalies.push({
      type: 'high_usage',
      severity: peerComparison.percentile >= 90 ? 'high' : 'moderate',
      description: `Your home uses ${peerComparison.excessPct}% more electricity than the median home in your area (${peerComparison.annualKwh.toLocaleString()} vs ${peerComparison.medianKwh.toLocaleString()} kWh/year).`,
    });
  }

  // High baseload
  if (profile.baseloadMonthlyKwh >= BASELOAD_HIGH_THRESHOLD) {
    anomalies.push({
      type: 'high_baseload',
      severity: profile.baseloadMonthlyKwh >= 1000 ? 'high' : 'moderate',
      description: `Your baseload (always-on) usage is ${profile.baseloadMonthlyKwh} kWh/month. This includes appliances, lighting, and always-on electronics. The typical range is 400-700 kWh/month.`,
    });
  }

  // Winter spike (possible electric heat)
  if (profile.heatingSignal === 'strong') {
    anomalies.push({
      type: 'winter_spike',
      severity: 'high',
      description: `Your winter usage is ${profile.seasonalityRatio}x your summer usage. This may indicate electric space heating, electric water heating, or a heated pool/spa. If your home has gas heat, this pattern warrants investigation.`,
    });
  } else if (profile.heatingSignal === 'moderate') {
    anomalies.push({
      type: 'winter_spike',
      severity: 'moderate',
      description: `Your winter usage is noticeably higher than summer (${profile.seasonalityRatio}x ratio). This is common but worth understanding — it could be electric supplemental heating, a humidifier, or holiday lighting.`,
    });
  }

  // Summer spike (AC-heavy)
  if (profile.coolingSignal === 'strong' || profile.coolingSignal === 'moderate') {
    anomalies.push({
      type: 'summer_spike',
      severity: profile.coolingSignal === 'strong' ? 'high' : 'moderate',
      description: `Your summer cooling usage is significantly higher than your baseline. In Colorado's dry climate, this may indicate an older/oversized AC system or poor insulation and air sealing.`,
    });
  }

  // Large month-to-month variation
  const maxMonth = Math.max(...profile.kwhPerMonth);
  const minMonth = Math.min(...profile.kwhPerMonth);
  if (minMonth > 0 && maxMonth / minMonth > 2.5) {
    anomalies.push({
      type: 'high_variability',
      severity: 'info',
      description: `Your highest month (${maxMonth} kWh in ${profile.peakMonth}) is ${(maxMonth / minMonth).toFixed(1)}x your lowest (${minMonth} kWh in ${profile.troughMonth}). High variability often means weather-sensitive loads are a big factor.`,
    });
  }

  return anomalies;
}

/**
 * Compute efficiency score (0-100, where 0 = very efficient, 100 = very wasteful).
 */
function computeEfficiencyScore(profile, peerComparison, assetScore) {
  // Peer component (0-100)
  const peerScore = Math.min(100, Math.max(0, peerComparison.percentile));

  // Seasonal component (0-100): high seasonality = more weather-sensitive waste
  let seasonalScore = 50; // neutral
  if (profile.seasonalityRatio !== null) {
    if (profile.seasonalityRatio > 2.0) seasonalScore = 90;
    else if (profile.seasonalityRatio > 1.5) seasonalScore = 70;
    else if (profile.seasonalityRatio > 1.2) seasonalScore = 55;
    else if (profile.seasonalityRatio > 0.8) seasonalScore = 40;
    else if (profile.seasonalityRatio > 0.5) seasonalScore = 60;
    else seasonalScore = 80;
  }

  // Baseload component (0-100)
  let baseloadScore;
  if (profile.baseloadMonthlyKwh >= 1000) baseloadScore = 90;
  else if (profile.baseloadMonthlyKwh >= 800) baseloadScore = 70;
  else if (profile.baseloadMonthlyKwh >= 600) baseloadScore = 50;
  else if (profile.baseloadMonthlyKwh >= 400) baseloadScore = 30;
  else baseloadScore = 15;

  // Weighted score
  let rawScore = Math.round(
    peerScore * WEIGHT_PEER +
    seasonalScore * WEIGHT_SEASONAL +
    baseloadScore * WEIGHT_BASELOAD
  );

  // Apply asset modifier if available (Phase 2)
  const modifier = assetScore ? assetScore.upgradeOpportunityModifier : 0;
  const finalScore = Math.min(100, Math.max(0, rawScore + modifier));

  // Confidence
  const confidenceFactors = [];
  if (profile.kwhPerMonth.filter(v => v > 0).length >= 12) {
    confidenceFactors.push('12 months of usage data');
  } else {
    confidenceFactors.push('Less than 12 months of data — lower confidence');
  }

  if (peerComparison.kwhPerSqFt !== null) {
    confidenceFactors.push('Square footage available for normalization');
  } else {
    confidenceFactors.push('No square footage — peer comparison uses area median only');
  }

  if (assetScore) {
    confidenceFactors.push('Property characteristics available');
  } else {
    confidenceFactors.push('No property data — scoring based on usage patterns only');
  }

  // Determine confidence level
  const hasFullData = profile.kwhPerMonth.filter(v => v > 0).length >= 12;
  const hasPropertyData = !!assetScore;
  let confidence;
  if (hasFullData && hasPropertyData) confidence = 'high';
  else if (hasFullData) confidence = 'medium';
  else confidence = 'low';

  return {
    score: finalScore,
    rawScore,
    modifier,
    confidence,
    confidenceFactors,
    components: {
      peer: { weight: WEIGHT_PEER, score: peerScore },
      seasonal: { weight: WEIGHT_SEASONAL, score: seasonalScore },
      baseload: { weight: WEIGHT_BASELOAD, score: baseloadScore },
    },
  };
}

// ── Phase 2: Property-Based Analysis ─────────────────────────────────

/**
 * Analyze property characteristics and infer asset-based efficiency signals.
 */
function analyzePropertyAssets(propertyData) {
  if (!propertyData || !propertyData.yearBuilt) return null;

  const era = getCodeEra(propertyData.yearBuilt);
  if (!era) return null;

  const heatingFuel = propertyData.heatingFuel || era.likelyHeatingFuel || 'unknown';

  return {
    yearBuilt: propertyData.yearBuilt,
    codeEra: era.label,
    vintageRisk: propertyData.yearBuilt < 1980 ? 'high'
      : propertyData.yearBuilt < 2000 ? 'medium' : 'low',
    likelyInsulation: era.likelyInsulation,
    likelyWindows: era.likelyWindows,
    likelyHvac: era.likelyHvac,
    heatingFuel,
    upgradeOpportunityModifier: era.upgradeOpportunityModifier,
    typicalMeasures: era.typicalMeasures,
    notes: era.notes,
  };
}

/**
 * Generate efficiency recommendations based on anomalies and property data.
 */
function generateRecommendations(anomalies, assetScore, profile, annualKwh, effectiveRate) {
  if (!assetScore) return [];

  const activeSignals = new Set();

  // Collect signals from anomalies
  for (const anomaly of anomalies) {
    activeSignals.add(anomaly.type);
  }

  // Add vintage-based signals
  if (assetScore.yearBuilt < 1980) activeSignals.add('pre_1980_vintage');
  if (assetScore.yearBuilt < 2000) activeSignals.add('pre_2000_vintage');
  if (profile.heatingSignal === 'strong' && assetScore.heatingFuel === 'electric') {
    activeSignals.add('electric_heat_detected');
  }

  const recommendations = [];
  const rate = effectiveRate || 0.152; // Default Xcel all-in rate

  for (const [key, measure] of Object.entries(EFFICIENCY_MEASURES)) {
    // Check if any of the measure's applicable signals are active
    const matches = measure.applicableSignals.filter(s => activeSignals.has(s));
    if (matches.length === 0) continue;

    // Skip heat pump recommendation unless we have strong electric heat signal
    if (key === 'heat_pump' && !activeSignals.has('electric_heat_detected')) continue;

    const rebate = XCEL_REBATES[key];
    const rebateAmount = rebate ? (typeof rebate.amount === 'number' ? rebate.amount : 0) : 0;

    const avgSavingsKwh = Math.round((measure.savingsKwhRange.low + measure.savingsKwhRange.high) / 2);
    const avgSavingsDollars = Math.round(avgSavingsKwh * rate);
    const avgCost = Math.round((measure.costRange.low + measure.costRange.high) / 2);
    const netCost = Math.max(0, avgCost - rebateAmount);
    const simplePayback = avgSavingsDollars > 0 ? +(netCost / avgSavingsDollars).toFixed(1) : null;

    recommendations.push({
      key,
      measure: measure.name,
      priority: measure.priority,
      costRange: measure.costRange,
      avgCost,
      savingsKwhRange: measure.savingsKwhRange,
      avgSavingsKwh,
      avgSavingsDollars,
      xcelRebate: rebateAmount,
      xcelRebateUrl: rebate?.url || null,
      netCost,
      simplePaybackYears: simplePayback,
      requiresMiniAudit: measure.requiresMiniAudit || false,
      confidence: assetScore.vintageRisk === 'high' ? 'medium' : 'low',
      description: measure.description,
      matchedSignals: matches,
    });
  }

  // Sort by priority
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations;
}

/**
 * Calculate post-upgrade load and solar sizing impact.
 */
function calculatePostUpgradeLoad(annualKwh, recommendations, systemCostPerWatt) {
  if (!recommendations || recommendations.length === 0) return null;

  // Conservative: only high-confidence, non-mini-audit measures
  const conservativeMeasures = recommendations.filter(r => !r.requiresMiniAudit);
  const conservativeSavings = conservativeMeasures.reduce((s, r) => s + r.savingsKwhRange.low, 0);

  // Moderate: all recommended measures at average savings
  const moderateSavings = recommendations
    .filter(r => !r.requiresMiniAudit)
    .reduce((s, r) => s + r.avgSavingsKwh, 0);

  // Aggressive: all measures including mini-audit at high end
  const aggressiveSavings = recommendations.reduce((s, r) => s + r.savingsKwhRange.high, 0);

  const conservativeLoad = annualKwh - conservativeSavings;
  const moderateLoad = annualKwh - moderateSavings;
  const aggressiveLoad = annualKwh - aggressiveSavings;

  // Solar sizing impact (using Colorado production factor)
  const productionFactor = 1400; // kWh/kW-year for Front Range (conservative)
  const currentSystemKw = +(annualKwh / productionFactor).toFixed(1);
  const postUpgradeSystemKw = +(moderateLoad / productionFactor).toFixed(1);
  const reductionKw = +(currentSystemKw - postUpgradeSystemKw).toFixed(1);

  const costPerWatt = systemCostPerWatt || 2.25;
  const solarCostSavings = Math.round(reductionKw * 1000 * costPerWatt);

  // Total efficiency investment
  const totalEfficiencyCost = recommendations
    .filter(r => !r.requiresMiniAudit)
    .reduce((s, r) => s + r.netCost, 0);

  const netAdditionalCost = totalEfficiencyCost - solarCostSavings;

  return {
    currentLoadKwh: annualKwh,
    postUpgradeLoadKwh: {
      conservative: Math.round(conservativeLoad),
      moderate: Math.round(moderateLoad),
      aggressive: Math.round(aggressiveLoad),
      recommended: Math.round(moderateLoad),
    },
    totalSavingsKwh: {
      conservative: conservativeSavings,
      moderate: moderateSavings,
      aggressive: aggressiveSavings,
    },
    solarSizingImpact: {
      currentSystemKw,
      postUpgradeSystemKw,
      reductionKw,
      solarCostSavings,
      totalEfficiencyCost,
      netAdditionalCost,
      narrative: reductionKw > 0
        ? `By investing ~$${totalEfficiencyCost.toLocaleString()} in efficiency upgrades (after Xcel rebates), you could install a ${reductionKw} kW smaller solar system, saving $${solarCostSavings.toLocaleString()} on solar. ${netAdditionalCost > 0 ? `Net additional cost: $${netAdditionalCost.toLocaleString()} for a more efficient, comfortable home.` : `Net savings: $${Math.abs(netAdditionalCost).toLocaleString()} — the efficiency upgrades more than pay for themselves through the smaller solar system.`}`
        : 'Your home is already relatively efficient — full-size solar is the right approach.',
    },
  };
}

// ── Main Entry Point ─────────────────────────────────────────────────

/**
 * Analyze home energy efficiency.
 * @param {object} billData - Parsed bill data
 * @param {object} consumptionData - From estimateAnnualConsumption()
 * @param {object} location - { lat, lon }
 * @param {object} [propertyData] - Optional: { yearBuilt, squareFeet, bedrooms, heatingFuel }
 * @returns {object} Full efficiency analysis
 */
function analyzeEfficiency(billData, consumptionData, location, propertyData) {
  console.log('[energyAudit] Starting energy efficiency analysis...');

  const monthlyConsumption = consumptionData.monthlyConsumption || new Array(12).fill(0);
  const annualKwh = consumptionData.annualConsumption || monthlyConsumption.reduce((s, v) => s + v, 0);
  const zip = billData?.customer?.zip;
  const squareFeet = propertyData?.squareFeet || null;

  // Phase 1: Usage profile
  const profile = computeEfficiencyProfile(monthlyConsumption);

  // Phase 1: Peer comparison
  const peerComparison = computePeerComparison(annualKwh, zip, squareFeet);

  // Phase 2: Asset analysis (if property data available)
  const assetScore = propertyData ? analyzePropertyAssets(propertyData) : null;

  // Phase 1: Anomaly detection
  const anomalies = detectAnomalies(profile, peerComparison);

  // Combined: Efficiency score
  const efficiencyScore = computeEfficiencyScore(profile, peerComparison, assetScore);

  // Phase 2: Recommendations (only if property data)
  const effectiveRate = billData?.charges?.totalAmount && billData?.meterReadings?.totalUsageKwh
    ? billData.charges.totalAmount / billData.meterReadings.totalUsageKwh
    : 0.152;

  const recommendations = generateRecommendations(
    anomalies, assetScore, profile, annualKwh, effectiveRate
  );

  // Phase 2: Post-upgrade load
  const postUpgradeAnalysis = calculatePostUpgradeLoad(annualKwh, recommendations);

  const result = {
    efficiencyProfile: profile,
    peerComparison,
    assetScore,
    anomalies,
    efficiencyScore,
    recommendations,
    postUpgradeAnalysis,
    hasPropertyData: !!propertyData,
  };

  console.log(`[energyAudit] Score: ${efficiencyScore.score}/100 (${efficiencyScore.confidence} confidence). ` +
    `${anomalies.length} anomalies, ${recommendations.length} recommendations.`);

  return result;
}

module.exports = { analyzeEfficiency };
