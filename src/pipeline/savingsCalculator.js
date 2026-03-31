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
 * Get 12-month consumption from actual usage history or estimate from a single bill.
 */
function estimateAnnualConsumption(billData) {
  // Prefer actual 12-month history from the bill's bar chart
  if (billData.usageHistory && billData.usageHistory.length >= 12) {
    // Sort chronologically by year then month to handle year boundaries correctly
    const sorted = [...billData.usageHistory].sort((a, b) => {
      const yearDiff = (a.year || 2024) - (b.year || 2024);
      if (yearDiff !== 0) return yearDiff;
      return monthNameToIndex(a.month) - monthNameToIndex(b.month);
    });
    const last12 = sorted.slice(-12);

    const monthlyConsumption = new Array(12).fill(0);
    for (const entry of last12) {
      const monthIdx = monthNameToIndex(entry.month);
      monthlyConsumption[monthIdx] = Math.round(entry.kWh);
    }

    // Validate: bill month's kWh should match the history entry for that month
    const billKwh = billData.meterReadings.totalUsageKwh;
    const endDate = new Date(billData.servicePeriod.endDate);
    const billMonthIdx = endDate.getMonth();
    const historyVal = monthlyConsumption[billMonthIdx];
    if (historyVal > 0 && Math.abs(historyVal - billKwh) > billKwh * 0.15) {
      console.warn(`[savingsCalc] Mismatch: bill says ${billKwh} kWh for ${MONTH_NAMES[billMonthIdx]}, history has ${historyVal}. Using bill value.`);
      monthlyConsumption[billMonthIdx] = billKwh;
    }

    const annualConsumption = monthlyConsumption.reduce((s, v) => s + v, 0);
    console.log(`[savingsCalc] Using actual 12-month history: ${annualConsumption} kWh/year`);
    console.log(`[savingsCalc] Monthly: ${monthlyConsumption.map((v, i) => `${MONTH_NAMES[i]}=${v}`).join(', ')}`);
    return { monthlyConsumption, annualConsumption, source: 'history' };
  }

  // Fallback: extrapolate from single bill month using seasonal factors
  const monthlyUsage = billData.meterReadings.totalUsageKwh;
  const endDate = new Date(billData.servicePeriod.endDate);
  const billMonth = endDate.getMonth();

  const billFactor = SEASONAL_FACTORS[billMonth];
  const baseMonthly = monthlyUsage / billFactor;

  const monthlyConsumption = SEASONAL_FACTORS.map((factor) => Math.round(baseMonthly * factor));
  const annualConsumption = monthlyConsumption.reduce((sum, v) => sum + v, 0);

  console.log(`[savingsCalc] Extrapolating from bill month ${billMonth} (factor ${billFactor}), base: ${Math.round(baseMonthly)} kWh/mo`);
  console.log(`[savingsCalc] Estimated annual consumption: ${annualConsumption} kWh`);

  return { monthlyConsumption, annualConsumption, source: 'estimated' };
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
  const { monthlyConsumption, annualConsumption, source: consumptionSource } = estimateAnnualConsumption(billData);
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
