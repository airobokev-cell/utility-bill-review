const { NET_METERING_CREDIT_RATE, AVOIDED_COST_RATE } = require('../constants');

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
 * Delivery and fixed charges remain for imported kWh.
 */
function getPostSolarRates(currentRates) {
  return {
    // Net metering credit rate for exported kWh
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
  const taxableCharges = supplyCharge + deliveryCharge;
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

module.exports = { extractCurrentRates, getPostSolarRates, calculateMonthlyPostSolarBill };
