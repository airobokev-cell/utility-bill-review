const {
  SYSTEM_COST_PER_WATT,
  ANNUAL_DEGRADATION,
  ANNUAL_RATE_ESCALATION,
  ANALYSIS_YEARS,
  DISCOUNT_RATE,
  SEASONAL_FACTORS,
  PANEL_WATTAGE,
} = require('../constants');
const { calculateMonthlyPostSolarBill } = require('./rateStructure');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Convert a 3-letter month abbreviation to 0-indexed month number.
 */
function monthNameToIndex(name) {
  const normalized = name.slice(0, 3).charAt(0).toUpperCase() + name.slice(1, 3).toLowerCase();
  const idx = MONTH_NAMES.indexOf(normalized);
  return idx >= 0 ? idx : 0;
}

/**
 * Build a 12-month consumption array using ALL available real data from the bill,
 * then fill any gaps with a seasonal curve calibrated to the known months.
 *
 * Priority order:
 *   1. Real monthly usage from the bill's usage history bar chart (any months available)
 *   2. The current bill month's kWh (always available — used as anchor if not in history)
 *   3. Missing months filled via SEASONAL_FACTORS scaled to match the known data
 *
 * If NREL solrad data is provided, we derive a location-specific seasonal curve
 * instead of using the generic Colorado SEASONAL_FACTORS.
 */
function estimateAnnualConsumption(billData, nrelSolradMonthly) {
  const monthlyConsumption = new Array(12).fill(null); // null = unknown
  const knownMonths = new Set();

  // ── Step 1: Load all real months from usage history ─────────────────
  const billKwh = billData.meterReadings.totalUsageKwh;

  if (billData.usageHistory && billData.usageHistory.length > 0) {
    // Sanity check: if history values are wildly inconsistent with the bill's kWh,
    // the history might be gas data (therms/ccf) mislabeled as kWh.
    // Discard history if average is < 15% of the bill month's kWh.
    const historyAvg = billData.usageHistory.reduce((s, e) => s + (e.kWh || 0), 0) / billData.usageHistory.length;
    if (historyAvg > 0 && historyAvg < billKwh * 0.15) {
      console.warn(`[savingsCalc] Usage history avg (${Math.round(historyAvg)} kWh) is <15% of bill kWh (${billKwh}). Likely gas data — discarding history.`);
    } else {
      // Sort chronologically and take the most recent entry per month
      const sorted = [...billData.usageHistory].sort((a, b) => {
        const yearDiff = (a.year || 2024) - (b.year || 2024);
        if (yearDiff !== 0) return yearDiff;
        return monthNameToIndex(a.month) - monthNameToIndex(b.month);
      });

      // If we have > 12 entries, take the last 12
      const recent = sorted.length > 12 ? sorted.slice(-12) : sorted;

      for (const entry of recent) {
        if (entry.kWh > 0) {
          const monthIdx = monthNameToIndex(entry.month);
          monthlyConsumption[monthIdx] = Math.round(entry.kWh);
          knownMonths.add(monthIdx);
        }
      }
    }
  }

  // ── Step 2: Anchor the current bill month (always trust the actual bill) ─
  const endDate = new Date(billData.servicePeriod.endDate);
  const billMonthIdx = endDate.getMonth();

  if (billKwh > 0) {
    // If history had a different value for this month, prefer the bill's exact value
    if (monthlyConsumption[billMonthIdx] !== null &&
        Math.abs(monthlyConsumption[billMonthIdx] - billKwh) > billKwh * 0.15) {
      console.warn(`[savingsCalc] Mismatch: bill says ${billKwh} kWh for ${MONTH_NAMES[billMonthIdx]}, history has ${monthlyConsumption[billMonthIdx]}. Using bill value.`);
    }
    monthlyConsumption[billMonthIdx] = Math.round(billKwh);
    knownMonths.add(billMonthIdx);
  }

  const knownCount = knownMonths.size;
  console.log(`[savingsCalc] Real monthly data: ${knownCount}/12 months from bill`);
  console.log(`[savingsCalc] Known months: ${[...knownMonths].map(i => MONTH_NAMES[i]).join(', ')}`);

  // ── Step 3: If all 12 months known, we're done ─────────────────────
  if (knownCount >= 12) {
    const annualConsumption = monthlyConsumption.reduce((s, v) => s + v, 0);
    console.log(`[savingsCalc] Full 12-month history: ${annualConsumption} kWh/year`);
    console.log(`[savingsCalc] Monthly: ${monthlyConsumption.map((v, i) => `${MONTH_NAMES[i]}=${v}`).join(', ')}`);
    return { monthlyConsumption, annualConsumption, source: 'history', knownMonths: knownCount };
  }

  // ── Step 4: Build the seasonal curve for gap-filling ───────────────
  // If NREL solar radiation data is available, derive a consumption curve from it.
  // Higher solar radiation → warmer → more AC but less heating.
  // For Colorado (gas heat dominant): consumption correlates with INVERSE of solar
  // radiation (cold dark months = higher electric for lighting, fans, misc).
  // But summer AC creates a secondary peak → use a blended U-shaped curve.
  let seasonalCurve;
  if (nrelSolradMonthly && nrelSolradMonthly.length === 12) {
    // Build location-specific curve from NREL TMY solar radiation
    // Consumption model: baseload + heating_proxy + cooling_proxy
    // heating_proxy ∝ inverse of solar radiation (cold months)
    // cooling_proxy ∝ solar radiation above threshold (hot months)
    const maxSolrad = Math.max(...nrelSolradMonthly);
    const minSolrad = Math.min(...nrelSolradMonthly);
    const midSolrad = (maxSolrad + minSolrad) / 2;

    seasonalCurve = nrelSolradMonthly.map((solrad) => {
      // Heating component: inverse of solar (higher in winter)
      const heatingProxy = 1 - (solrad - minSolrad) / (maxSolrad - minSolrad);
      // Cooling component: excess solar above midpoint (higher in summer)
      const coolingProxy = Math.max(0, (solrad - midSolrad) / (maxSolrad - midSolrad));
      // Blend: 40% baseload + 30% heating + 30% cooling → U-shaped curve
      return 0.40 + 0.30 * heatingProxy + 0.30 * coolingProxy;
    });
    console.log(`[savingsCalc] Using NREL-derived seasonal curve for gap-filling`);
  } else {
    seasonalCurve = SEASONAL_FACTORS;
    console.log(`[savingsCalc] Using default Colorado seasonal curve for gap-filling`);
  }

  // ── Step 5: Calibrate the curve to match known months ──────────────
  // Find the scaling factor: what multiplier on the seasonal curve
  // best matches the actual kWh values we have?
  let sumKnownActual = 0;
  let sumKnownCurve = 0;
  for (const idx of knownMonths) {
    sumKnownActual += monthlyConsumption[idx];
    sumKnownCurve += seasonalCurve[idx];
  }
  const scaleFactor = sumKnownActual / sumKnownCurve;

  console.log(`[savingsCalc] Calibration: avg known = ${Math.round(sumKnownActual / knownCount)} kWh/mo, scale factor = ${scaleFactor.toFixed(1)}`);

  // ── Step 6: Fill missing months with calibrated curve ──────────────
  const filledMonths = [];
  for (let m = 0; m < 12; m++) {
    if (monthlyConsumption[m] === null) {
      monthlyConsumption[m] = Math.round(scaleFactor * seasonalCurve[m]);
      filledMonths.push(MONTH_NAMES[m]);
    }
  }

  if (filledMonths.length > 0) {
    console.log(`[savingsCalc] Estimated months: ${filledMonths.join(', ')}`);
  }

  const annualConsumption = monthlyConsumption.reduce((s, v) => s + v, 0);
  const sourceLabel = knownCount >= 6 ? 'hybrid-majority-real' :
                      knownCount >= 2 ? 'hybrid-partial' : 'estimated';

  console.log(`[savingsCalc] Annual consumption: ${annualConsumption} kWh/year (${knownCount} real + ${12 - knownCount} estimated months)`);
  console.log(`[savingsCalc] Monthly: ${monthlyConsumption.map((v, i) => `${MONTH_NAMES[i]}=${v}${knownMonths.has(i) ? '*' : ''}`).join(', ')} (* = real)`);

  return { monthlyConsumption, annualConsumption, source: sourceLabel, knownMonths: knownCount };
}

/**
 * Determine optimal system size based on usage and roof constraints.
 */
function calculateSystemSize(annualConsumption, roofData, productionPerKw) {
  const targetKw = annualConsumption / productionPerKw * 0.95;
  const maxRoofKw = roofData.maxSystemKw;
  const systemKw = Math.min(targetKw, maxRoofKw);
  const roundedKw = Math.round(systemKw * 2) / 2;
  const panels = Math.ceil((roundedKw * 1000) / PANEL_WATTAGE);

  console.log(`[savingsCalc] Target: ${targetKw.toFixed(1)} kW, roof max: ${maxRoofKw} kW, final: ${roundedKw} kW (${panels} panels)`);
  return { systemKw: roundedKw, panels };
}

/**
 * Run the full 25-year savings calculation.
 */
function calculateSavings({ billData, systemSizeKw, panels, productionData, currentRates, postSolarRates, incentives, batteryAnalysis }) {
  const { monthlyConsumption, annualConsumption, source: consumptionSource } = estimateAnnualConsumption(billData, productionData.solradMonthly);
  const monthlyProduction = productionData.acMonthly;

  // ── Year 1 pre-solar bill (estimated from current rates) ─────────
  const year1PreSolarMonthly = monthlyConsumption.map((kwh) => {
    const supply = kwh * currentRates.supplyPerKwh;
    const delivery = kwh * currentRates.deliveryVariablePerKwh + currentRates.deliveryFixedMonthly;
    const taxes = kwh * currentRates.taxPerKwh;
    return supply + delivery + taxes;
  });
  const year1PreSolarAnnual = year1PreSolarMonthly.reduce((s, v) => s + v, 0);

  // ── Year 1 post-solar bill (month by month with net metering) ────
  let bankedCredits = 0;
  const year1PostSolarMonthly = [];
  for (let m = 0; m < 12; m++) {
    const result = calculateMonthlyPostSolarBill(
      monthlyConsumption[m],
      monthlyProduction[m],
      postSolarRates,
      bankedCredits
    );
    year1PostSolarMonthly.push(result);
    bankedCredits = result.bankedCreditKwh;
  }

  // Annual true-up: cash out remaining credits at avoided cost
  const trueUpCashout = bankedCredits * postSolarRates.avoidedCostPerKwh;
  const year1PostSolarAnnual = year1PostSolarMonthly.reduce((s, m) => s + m.total, 0) - trueUpCashout;
  const year1Savings = year1PreSolarAnnual - Math.max(0, year1PostSolarAnnual);

  // ── Monthly breakdown for the report table ─────────────────────
  const monthlyBreakdown = MONTH_NAMES.map((name, m) => ({
    month: name,
    consumptionKwh: monthlyConsumption[m],
    solarGenKwh: Math.round(monthlyProduction[m]),
    netGridKwh: monthlyConsumption[m] - Math.round(monthlyProduction[m]),
    billBefore: Math.round(year1PreSolarMonthly[m]),
    billAfter: Math.round(year1PostSolarMonthly[m].total),
    savings: Math.round(year1PreSolarMonthly[m] - year1PostSolarMonthly[m].total),
  }));

  // ── System cost ──────────────────────────────────────────────────
  const grossCost = systemSizeKw * 1000 * SYSTEM_COST_PER_WATT;
  const netCost = grossCost - incentives.totalIncentiveValue;
  const effectiveNetCost = Math.max(0, netCost);

  // ── 25-year projection ───────────────────────────────────────────
  const yearlyProjection = [];
  let cumulativeSavings = 0;
  let cumulativeNPV = 0;
  let paybackYear = null;

  for (let year = 1; year <= ANALYSIS_YEARS; year++) {
    const degradation = Math.pow(1 - ANNUAL_DEGRADATION, year - 1);
    const escalation = Math.pow(1 + ANNUAL_RATE_ESCALATION, year - 1);

    const yearPreSolar = year1PreSolarAnnual * escalation;

    const yearPostSolarRates = {
      ...postSolarRates,
      supplyPerKwh: postSolarRates.supplyPerKwh * escalation,
      netMeteringCreditPerKwh: postSolarRates.netMeteringCreditPerKwh * escalation,
      deliveryVariablePerKwh: postSolarRates.deliveryVariablePerKwh * escalation,
      deliveryFixedMonthly: postSolarRates.deliveryFixedMonthly * escalation,
      taxPerKwh: postSolarRates.taxPerKwh * escalation,
      avoidedCostPerKwh: postSolarRates.avoidedCostPerKwh * escalation,
    };

    let yearBanked = 0;
    let yearPostSolar = 0;
    for (let m = 0; m < 12; m++) {
      const result = calculateMonthlyPostSolarBill(
        monthlyConsumption[m],
        monthlyProduction[m] * degradation,
        yearPostSolarRates,
        yearBanked
      );
      yearPostSolar += result.total;
      yearBanked = result.bankedCreditKwh;
    }
    yearPostSolar -= yearBanked * yearPostSolarRates.avoidedCostPerKwh;
    yearPostSolar = Math.max(0, yearPostSolar);

    const yearSavings = yearPreSolar - yearPostSolar;
    cumulativeSavings += yearSavings;

    const discountFactor = Math.pow(1 + DISCOUNT_RATE, -year);
    cumulativeNPV += yearSavings * discountFactor;

    if (!paybackYear && cumulativeSavings >= effectiveNetCost) {
      paybackYear = year;
    }

    yearlyProjection.push({
      year,
      production: Math.round(productionData.acAnnual * degradation),
      preSolarBill: Math.round(yearPreSolar),
      postSolarBill: Math.round(yearPostSolar),
      savings: Math.round(yearSavings),
      cumulativeSavings: Math.round(cumulativeSavings),
    });
  }

  const totalSavings25yr = cumulativeSavings;
  const npv = cumulativeNPV - effectiveNetCost;
  const roi = effectiveNetCost > 0 ? ((totalSavings25yr - effectiveNetCost) / effectiveNetCost) * 100 : 0;

  const avgMonthlyPreSolar = year1PreSolarAnnual / 12;
  const avgMonthlyPostSolar = Math.max(0, year1PostSolarAnnual) / 12;
  const avgMonthlySavings = year1Savings / 12;

  const offsetPercentage = (productionData.acAnnual / annualConsumption) * 100;

  const result = {
    system: {
      sizeKw: systemSizeKw,
      panels,
      annualProductionKwh: Math.round(productionData.acAnnual),
      offsetPercentage: Math.round(offsetPercentage),
    },
    consumption: {
      monthlyKwh: monthlyConsumption,
      annualKwh: annualConsumption,
      billMonthKwh: billData.meterReadings.totalUsageKwh,
      source: consumptionSource,
    },
    monthlyProductionKwh: monthlyProduction.map((v) => Math.round(v)),
    monthlyBreakdown,
    costs: {
      grossCost: Math.round(grossCost),
      federalITC: Math.round(incentives.federalITC.value),
      stateIncentives: Math.round(incentives.stateIncentives?.value || 0),
      netCost: Math.round(effectiveNetCost),
    },
    year1: {
      preSolarAnnualBill: Math.round(year1PreSolarAnnual),
      postSolarAnnualBill: Math.round(Math.max(0, year1PostSolarAnnual)),
      annualSavings: Math.round(year1Savings),
      avgMonthlyPreSolar: Math.round(avgMonthlyPreSolar),
      avgMonthlyPostSolar: Math.round(avgMonthlyPostSolar),
      avgMonthlySavings: Math.round(avgMonthlySavings),
    },
    payback: {
      simpleYears: effectiveNetCost > 0 ? Math.round((effectiveNetCost / year1Savings) * 10) / 10 : 0,
      actualYears: paybackYear,
    },
    twentyFiveYear: {
      totalSavings: Math.round(totalSavings25yr),
      npv: Math.round(npv),
      roi: Math.round(roi),
    },
    yearlyProjection,
    battery: batteryAnalysis,
  };

  console.log(`[savingsCalc] Year 1 savings: $${result.year1.annualSavings}, payback: ${result.payback.simpleYears} years, 25yr total: $${result.twentyFiveYear.totalSavings}`);
  return result;
}

module.exports = { calculateSavings, estimateAnnualConsumption, calculateSystemSize };
