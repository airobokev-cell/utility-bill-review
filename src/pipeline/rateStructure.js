const { NET_METERING_CREDIT_RATE, AVOIDED_COST_RATE, XCEL_TOU_RATE, XCEL_FLAT_RATE } = require('../constants');

/**
 * Normalize a per-kWh rate to dollars.
 * Residential electricity rates are always < $1/kWh (typically $0.03-$0.30).
 * If a rate is > 1, it was likely extracted in cents — divide by 100.
 */
function normalizeRate(rate) {
  if (rate > 1) {
    console.warn(`[rateStructure] Rate ${rate} appears to be in cents, converting to dollars: ${rate / 100}`);
    return rate / 100;
  }
  return rate;
}

/**
 * Extract the current rate structure from parsed bill data.
 * Uses actual rates from the bill rather than external lookups.
 */
function extractCurrentRates(billData) {
  const usage = billData.meterReadings.totalUsageKwh;
  const supply = billData.charges.supply;
  const delivery = billData.charges.delivery;
  const taxes = billData.charges.taxesAndFees;

  // Calculate per-kWh rates from line items, normalizing to dollars
  let supplyRatePerKwh = 0;
  for (const item of supply.lineItems || []) {
    if (item.rate > 0) supplyRatePerKwh += normalizeRate(item.rate);
  }
  // If no line item rates, derive from total
  if (supplyRatePerKwh === 0 && usage > 0) {
    supplyRatePerKwh = supply.total / usage;
  }

  let deliveryVariablePerKwh = 0;
  let deliveryFixedMonthly = 0;

  for (const item of delivery.fixedCharges || []) {
    deliveryFixedMonthly += item.amount || 0;
  }
  for (const item of delivery.variableCharges || []) {
    if (item.rate > 0) deliveryVariablePerKwh += normalizeRate(item.rate);
  }
  // If no variable rates parsed, derive from total minus fixed
  if (deliveryVariablePerKwh === 0 && usage > 0) {
    const variableTotal = delivery.total - deliveryFixedMonthly;
    deliveryVariablePerKwh = Math.max(0, variableTotal / usage);
  }

  // Cross-check: if extracted rates produce a total wildly different from actual bill, recalculate
  if (usage > 0) {
    const computedTotal = supplyRatePerKwh * usage;
    if (computedTotal > supply.total * 2 || computedTotal < supply.total * 0.3) {
      console.warn(`[rateStructure] Supply rate cross-check failed (computed $${computedTotal.toFixed(2)} vs actual $${supply.total}), recalculating from totals`);
      supplyRatePerKwh = supply.total / usage;
    }
    const computedDeliveryVar = deliveryVariablePerKwh * usage;
    const actualDeliveryVar = delivery.total - deliveryFixedMonthly;
    if (actualDeliveryVar > 0 && (computedDeliveryVar > actualDeliveryVar * 2 || computedDeliveryVar < actualDeliveryVar * 0.3)) {
      console.warn(`[rateStructure] Delivery rate cross-check failed, recalculating from totals`);
      deliveryVariablePerKwh = Math.max(0, actualDeliveryVar / usage);
    }
  }

  const taxPerKwh = usage > 0 ? taxes.total / usage : 0;

  const rates = {
    supplyPerKwh: supplyRatePerKwh,
    deliveryVariablePerKwh,
    deliveryFixedMonthly,
    taxPerKwh,
    totalEffectiveRate: usage > 0 ? billData.totalAmountDue / usage : 0,

    supplyTotal: supply.total,
    deliveryTotal: delivery.total,
    taxesTotal: taxes.total,
  };

  console.log(`[rateStructure] Rates extracted — supply: $${rates.supplyPerKwh.toFixed(5)}/kWh, delivery var: $${rates.deliveryVariablePerKwh.toFixed(5)}/kWh, fixed: $${rates.deliveryFixedMonthly.toFixed(2)}/mo`);
  return rates;
}

/**
 * Determine post-solar rate structure.
 * Solar offsets supply charges via net metering.
 * Under Colorado SB 23-258, new net metering customers receive credits
 * at a reduced rate (not full retail).
 */
function getPostSolarRates(currentRates) {
  return {
    // Net metering credit rate for exported kWh (SB 23-258: reduced from full retail)
    netMeteringCreditPerKwh: currentRates.supplyPerKwh * NET_METERING_CREDIT_RATE,

    // Charges on imported kWh
    supplyPerKwh: currentRates.supplyPerKwh,
    deliveryVariablePerKwh: currentRates.deliveryVariablePerKwh,

    // Fixed charges (always owed regardless of solar)
    deliveryFixedMonthly: currentRates.deliveryFixedMonthly,

    // Tax rate proportional to remaining charges
    taxPerKwh: currentRates.taxPerKwh,

    // Avoided cost for annual true-up cashout
    avoidedCostPerKwh: AVOIDED_COST_RATE,
  };
}

/**
 * Calculate monthly post-solar bill.
 * Returns the bill amount and credit balance.
 */
function calculateMonthlyPostSolarBill(consumptionKwh, productionKwh, postSolarRates, bankedCreditKwh) {
  const selfConsumed = Math.min(productionKwh, consumptionKwh);
  const exported = Math.max(0, productionKwh - consumptionKwh);
  const imported = Math.max(0, consumptionKwh - productionKwh);

  // Supply charge on imported kWh, offset by banked credits
  let supplyCharge = imported * postSolarRates.supplyPerKwh;
  let newBankedCredits = bankedCreditKwh + exported;

  // Apply banked credits to reduce supply charge
  if (supplyCharge > 0 && newBankedCredits > 0) {
    const creditsNeeded = supplyCharge / postSolarRates.netMeteringCreditPerKwh;
    const creditsUsed = Math.min(newBankedCredits, creditsNeeded);
    supplyCharge -= creditsUsed * postSolarRates.netMeteringCreditPerKwh;
    newBankedCredits -= creditsUsed;
  }

  supplyCharge = Math.max(0, supplyCharge);

  // Delivery charge: variable portion on imported kWh + fixed charges
  const deliveryCharge = imported * postSolarRates.deliveryVariablePerKwh + postSolarRates.deliveryFixedMonthly;

  // Taxes proportional to remaining charges
  const taxes = imported > 0 ? imported * postSolarRates.taxPerKwh : postSolarRates.deliveryFixedMonthly * 0.05;

  const total = supplyCharge + deliveryCharge + taxes;

  return {
    total: Math.max(0, total),
    supplyCharge,
    deliveryCharge,
    taxes,
    imported,
    exported,
    selfConsumed,
    bankedCreditKwh: newBankedCredits,
  };
}

/**
 * Calculate TOU impact on solar ROI.
 * Models how solar production aligns with Xcel's TOU-R rate periods.
 *
 * Key insight: Solar produces most during midday (off-peak in Xcel's TOU-R),
 * so TOU rates can reduce solar's effective value vs flat rate.
 * However, batteries can shift value to on-peak.
 */
function calculateTOUImpact(annualConsumptionKwh, annualProductionKwh, currentRates) {
  const tou = XCEL_TOU_RATE;
  const flat = XCEL_FLAT_RATE;

  // ── Flat rate scenario ──────────────────────────────────────────
  const flatAnnualBillPreSolar = annualConsumptionKwh * flat.totalPerKwh + flat.fixedChargeMonthly * 12;
  const flatNetConsumption = Math.max(0, annualConsumptionKwh - annualProductionKwh);
  const flatExported = Math.max(0, annualProductionKwh - annualConsumptionKwh);
  const flatExportCredit = flatExported * flat.totalPerKwh * NET_METERING_CREDIT_RATE;
  const flatAnnualBillPostSolar = flatNetConsumption * flat.totalPerKwh + flat.fixedChargeMonthly * 12 - flatExportCredit;
  const flatSavings = flatAnnualBillPreSolar - Math.max(0, flatAnnualBillPostSolar);

  // ── TOU rate scenario ───────────────────────────────────────────
  // Pre-solar TOU bill
  const touOnPeakConsumption = annualConsumptionKwh * tou.consumptionOnPeakFraction;
  const touOffPeakConsumption = annualConsumptionKwh * tou.consumptionOffPeakFraction;
  const touAnnualBillPreSolar =
    touOnPeakConsumption * tou.onPeak.totalPerKwh +
    touOffPeakConsumption * tou.offPeak.totalPerKwh +
    tou.fixedChargeMonthly * 12;

  // Post-solar TOU: solar offsets mostly off-peak consumption
  const solarOnPeak = annualProductionKwh * tou.solarOnPeakFraction;
  const solarOffPeak = annualProductionKwh * tou.solarOffPeakFraction;

  // Solar first offsets same-period consumption, excess exported
  const onPeakOffset = Math.min(solarOnPeak, touOnPeakConsumption);
  const offPeakOffset = Math.min(solarOffPeak, touOffPeakConsumption);

  const remainingOnPeak = touOnPeakConsumption - onPeakOffset;
  const remainingOffPeak = touOffPeakConsumption - offPeakOffset;

  // Export credits at reduced NEM rate (weighted by period)
  const onPeakExport = Math.max(0, solarOnPeak - touOnPeakConsumption);
  const offPeakExport = Math.max(0, solarOffPeak - touOffPeakConsumption);
  const exportCredit =
    onPeakExport * tou.onPeak.totalPerKwh * NET_METERING_CREDIT_RATE +
    offPeakExport * tou.offPeak.totalPerKwh * NET_METERING_CREDIT_RATE;

  const touAnnualBillPostSolar =
    remainingOnPeak * tou.onPeak.totalPerKwh +
    remainingOffPeak * tou.offPeak.totalPerKwh +
    tou.fixedChargeMonthly * 12 -
    exportCredit;

  const touSavings = touAnnualBillPreSolar - Math.max(0, touAnnualBillPostSolar);

  // ── TOU + Battery scenario ──────────────────────────────────────
  // Battery shifts off-peak solar to on-peak consumption
  const batteryShiftKwh = XCEL_TOU_RATE.onPeak ? 13.5 * 0.9 * 280 : 0; // ~3,400 kWh/yr
  const batteryArbitrageValue = batteryShiftKwh * (tou.onPeak.totalPerKwh - tou.offPeak.totalPerKwh);
  const touWithBatterySavings = touSavings + batteryArbitrageValue;

  return {
    flatRate: {
      name: flat.name,
      ratePerKwh: flat.totalPerKwh,
      preSolarAnnualBill: Math.round(flatAnnualBillPreSolar),
      postSolarAnnualBill: Math.round(Math.max(0, flatAnnualBillPostSolar)),
      annualSavings: Math.round(flatSavings),
    },
    touRate: {
      name: tou.name,
      onPeakRate: tou.onPeak.totalPerKwh,
      offPeakRate: tou.offPeak.totalPerKwh,
      preSolarAnnualBill: Math.round(touAnnualBillPreSolar),
      postSolarAnnualBill: Math.round(Math.max(0, touAnnualBillPostSolar)),
      annualSavings: Math.round(touSavings),
      solarOnPeakPct: Math.round(tou.solarOnPeakFraction * 100),
      note: `Only ~${Math.round(tou.solarOnPeakFraction * 100)}% of solar production falls during on-peak hours. Most solar generation occurs during off-peak when rates are lower.`,
    },
    touWithBattery: {
      annualSavings: Math.round(touWithBatterySavings),
      batteryArbitrageValue: Math.round(batteryArbitrageValue),
      note: `Adding a battery to TOU-R shifts ~${Math.round(batteryShiftKwh).toLocaleString()} kWh/yr from off-peak to on-peak, adding ~$${Math.round(batteryArbitrageValue)}/yr in arbitrage value.`,
    },
    recommendation: flatSavings > touSavings
      ? `Flat rate (${flat.name}) saves you $${Math.round(flatSavings - touSavings)}/yr more with solar alone. TOU-R only wins if you add a battery.`
      : `TOU-R saves you $${Math.round(touSavings - flatSavings)}/yr more than flat rate with solar.`,
  };
}

module.exports = { extractCurrentRates, getPostSolarRates, calculateMonthlyPostSolarBill, calculateTOUImpact };
