const {
  BATTERY_COST_PER_KWH,
  BATTERY_CAPACITY_KWH,
  BATTERY_ROUND_TRIP_EFFICIENCY,
  BATTERY_ANNUAL_DEGRADATION,
  BATTERY_WARRANTY_YEARS,
  NET_METERING_CREDIT_RATE,
  XCEL_TOU_RATE,
  ANALYSIS_YEARS,
  DISCOUNT_RATE,
} = require('../constants');

function analyzeBatteryValue(currentRates, options = {}) {
  const capacityKwh = options.capacityKwh || BATTERY_CAPACITY_KWH;
  const costPerKwh = options.costPerKwh || BATTERY_COST_PER_KWH;
  const batteryCost = Math.round(capacityKwh * costPerKwh);
  const efficiency = BATTERY_ROUND_TRIP_EFFICIENCY;

  // ── Value stream 1: Backup power during outages ─────────────────
  // Colorado Front Range: winter storms, occasional summer severe weather
  const backupAnnualValue = 400;

  // ── Value stream 2: TOU rate arbitrage ──────────────────────────
  // Xcel Energy TOU-R: charge during off-peak, discharge during on-peak
  const touOnPeak = XCEL_TOU_RATE.onPeak.totalPerKwh;
  const touOffPeak = XCEL_TOU_RATE.offPeak.totalPerKwh;
  const touSpreadPerKwh = touOnPeak - touOffPeak; // ~$0.12 spread

  // Battery cycles once per day during peak, ~280 effective days/year
  // Account for round-trip efficiency losses
  const usableCapacity = capacityKwh * efficiency;
  const arbitrageAnnualValue = Math.round(usableCapacity * touSpreadPerKwh * 280);

  // ── Value stream 3: Self-consumption optimization ───────────────
  // With reduced NEM (SB 23-258): value = (retail - export credit) * kWh shifted
  let selfConsumptionAnnualValue = 0;
  if (NET_METERING_CREDIT_RATE < 1.0) {
    const retailRate = currentRates.totalEffectiveRate || currentRates.supplyPerKwh + currentRates.deliveryVariablePerKwh;
    const creditRate = currentRates.supplyPerKwh * NET_METERING_CREDIT_RATE;
    const spreadPerKwh = retailRate - creditRate;
    selfConsumptionAnnualValue = Math.round(usableCapacity * spreadPerKwh * 300);
  }

  // ── Value stream 4: Xcel demand response programs ───────────────
  // Xcel offers programs that pay for battery dispatch during grid peaks
  const demandResponseAnnualValue = 75;

  const year1TotalValue = backupAnnualValue + arbitrageAnnualValue + selfConsumptionAnnualValue + demandResponseAnnualValue;

  // ── Battery degradation modeling over warranty period ────────────
  // Model declining value as battery capacity degrades
  const degradationSchedule = [];
  let cumulativeValue = 0;
  let cumulativeNPV = 0;
  const yearsToModel = Math.min(ANALYSIS_YEARS, 25);

  for (let year = 1; year <= yearsToModel; year++) {
    const capacityFactor = Math.pow(1 - BATTERY_ANNUAL_DEGRADATION, year - 1);
    const effectiveCapacity = capacityKwh * capacityFactor;

    // Scale value streams by remaining capacity (backup value stays constant)
    const yearArbitrage = Math.round(effectiveCapacity * efficiency * touSpreadPerKwh * 280);
    let yearSelfConsumption = 0;
    if (NET_METERING_CREDIT_RATE < 1.0) {
      const retailRate = currentRates.totalEffectiveRate || currentRates.supplyPerKwh + currentRates.deliveryVariablePerKwh;
      const creditRate = currentRates.supplyPerKwh * NET_METERING_CREDIT_RATE;
      yearSelfConsumption = Math.round(effectiveCapacity * efficiency * (retailRate - creditRate) * 300);
    }
    const yearTotal = backupAnnualValue + yearArbitrage + yearSelfConsumption + demandResponseAnnualValue;
    cumulativeValue += yearTotal;

    const discountFactor = Math.pow(1 + DISCOUNT_RATE, -year);
    cumulativeNPV += yearTotal * discountFactor;

    degradationSchedule.push({
      year,
      capacityPct: Math.round(capacityFactor * 100),
      effectiveKwh: Math.round(effectiveCapacity * 10) / 10,
      annualValue: yearTotal,
      cumulativeValue: Math.round(cumulativeValue),
    });
  }

  const simplePaybackYears = year1TotalValue > 0 ? batteryCost / year1TotalValue : Infinity;
  const npv = cumulativeNPV - batteryCost;
  const recommended = simplePaybackYears <= 15;

  // ── TOU vs flat rate comparison ─────────────────────────────────
  const touComparison = {
    flatRateArbitrage: 0, // No arbitrage value on flat rate
    touArbitrage: arbitrageAnnualValue,
    touAdvantage: arbitrageAnnualValue,
    note: `On Xcel's TOU-R rate, the battery earns ~$${arbitrageAnnualValue}/yr in arbitrage by charging at ${(touOffPeak * 100).toFixed(0)}¢/kWh off-peak and discharging at ${(touOnPeak * 100).toFixed(0)}¢/kWh on-peak. On a flat rate, this value is $0.`,
  };

  const analysis = {
    batterySize: `${capacityKwh} kWh`,
    estimatedCost: batteryCost,
    costPerKwh: costPerKwh,
    warrantyYears: BATTERY_WARRANTY_YEARS,
    valueStreams: {
      backupPower: {
        annualValue: backupAnnualValue,
        reasoning: 'Estimated 3-4 outages/year from Colorado winter storms and severe weather. Avoids spoilage, inconvenience, and generator costs.',
      },
      rateArbitrage: {
        annualValue: arbitrageAnnualValue,
        reasoning: `Xcel Energy TOU-R rates: on-peak ${(touOnPeak * 100).toFixed(0)}¢/kWh vs off-peak ${(touOffPeak * 100).toFixed(0)}¢/kWh (${(touSpreadPerKwh * 100).toFixed(0)}¢ spread). Battery charges off-peak and discharges on-peak, accounting for ${Math.round(efficiency * 100)}% round-trip efficiency.`,
      },
      selfConsumption: {
        annualValue: selfConsumptionAnnualValue,
        reasoning: NET_METERING_CREDIT_RATE >= 1.0
          ? 'Full retail net metering means the grid acts as a free battery. Minimal additional value from storage for self-consumption.'
          : `Colorado SB 23-258 reduced net metering credits to ~${Math.round(NET_METERING_CREDIT_RATE * 100)}% of retail. Battery captures the spread between retail rate and export credit rate.`,
      },
      demandResponse: {
        annualValue: demandResponseAnnualValue,
        reasoning: 'Xcel Energy offers demand response programs that compensate battery owners for grid support during peak events.',
      },
    },
    totalAnnualValue: year1TotalValue,
    simplePaybackYears: simplePaybackYears === Infinity ? null : Math.round(simplePaybackYears * 10) / 10,
    npv: Math.round(npv),
    degradation: {
      annualRate: `${(BATTERY_ANNUAL_DEGRADATION * 100).toFixed(1)}%`,
      warrantyEndCapacity: `${Math.round(Math.pow(1 - BATTERY_ANNUAL_DEGRADATION, BATTERY_WARRANTY_YEARS) * 100)}%`,
      schedule: degradationSchedule.filter(d => d.year <= 10), // Show first 10 years
    },
    touComparison,
    recommended,
    recommendation: recommended ? 'WORTH CONSIDERING' : 'OPTIONAL',
    summary: recommended
      ? `Battery storage (${capacityKwh} kWh at $${batteryCost.toLocaleString()}) pays for itself in ~${Math.round(simplePaybackYears)} years through TOU arbitrage, self-consumption optimization, backup power, and demand response. Colorado's reduced net metering credits (SB 23-258) increase the value of battery storage.`
      : `Battery payback is ~${Math.round(simplePaybackYears)} years at $${batteryCost.toLocaleString()}. The main value is backup power during Colorado storms and TOU arbitrage. If backup power matters, it's worth the investment. Otherwise, solar alone gives you the best return.`,
  };

  console.log(`[batteryAnalysis] ${analysis.recommendation} — payback: ${analysis.simplePaybackYears || 'N/A'} years, annual value: $${year1TotalValue}, NPV: $${Math.round(npv)}`);
  return analysis;
}

module.exports = { analyzeBatteryValue };
