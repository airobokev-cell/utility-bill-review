const { ANNUAL_DEGRADATION } = require('../constants');

function yearsSinceInstall(installYear) {
  if (!installYear) return null;
  const now = new Date();
  return Math.max(0, now.getFullYear() + now.getMonth() / 12 - installYear);
}

function ageDerate(installYear) {
  const years = yearsSinceInstall(installYear);
  if (years == null) return 1;
  return Math.pow(1 - ANNUAL_DEGRADATION, years);
}

function annualizeProduction(productionData) {
  if (Number(productionData.last12MonthsKwh) > 0) return productionData.last12MonthsKwh;
  if (Array.isArray(productionData.monthlyHistory) && productionData.monthlyHistory.length >= 12) {
    return productionData.monthlyHistory
      .slice(-12)
      .reduce((s, m) => s + (Number(m.kWh) || 0), 0);
  }
  if (Number(productionData.currentMonthKwh) > 0 && productionData.monthlyHistory?.length >= 3) {
    const avg = productionData.monthlyHistory.reduce((s, m) => s + (Number(m.kWh) || 0), 0) / productionData.monthlyHistory.length;
    return avg * 12;
  }
  if (Number(productionData.currentMonthKwh) > 0) return productionData.currentMonthKwh * 12;
  if (Number(productionData.dailyAverageKwh) > 0) return productionData.dailyAverageKwh * 365;
  return null;
}

function annualizeBillConsumption(billData) {
  const history = Array.isArray(billData.usageHistory) ? billData.usageHistory : [];
  const valid = history.filter((h) => Number(h.kWh) > 0);
  if (valid.length >= 12) {
    return valid.slice(-12).reduce((s, h) => s + Number(h.kWh), 0);
  }
  if (valid.length > 0) {
    const avg = valid.reduce((s, h) => s + Number(h.kWh), 0) / valid.length;
    return avg * 12;
  }
  const current = Number(billData.meterReadings?.totalUsageKwh) || 0;
  const days = Number(billData.servicePeriod?.days) || 30;
  return (current / days) * 365;
}

function annualizeBillCost(billData) {
  const billCost = Number(billData.charges?.electricityTotal)
    || Number(billData.totalAmountDue)
    || 0;
  const days = Number(billData.servicePeriod?.days) || 30;
  return (billCost / days) * 365;
}

/**
 * Compute actual savings for a homeowner who ALREADY has solar.
 *
 * Math (owned systems):
 *   annualImportedKwh  = 12-month net grid import (from bill)
 *   annualProducedKwh  = actual solar production (from monitoring)
 *   annualConsumedKwh  = imported + self-consumed-solar
 *     self_consumed    ≈ producedKwh - exportedKwh (if export known)
 *                     or ≈ min(producedKwh, importedKwh × 1.8)     [approximation]
 *   counterfactualCost = annualConsumedKwh × totalEffectiveRate + fixedMonthlyCharge × 12
 *   actualCost         = annualized bill electricity total
 *   annualSavings      = counterfactualCost - actualCost
 *   lifetimeSavings    = annualSavings × yearsSinceInstall (straight-line estimate)
 *
 * TPO systems subtract the PPA payment as an additional cost.
 */
function computeActualSavings({ billData, productionData, currentRates, formInput, expectedAnnualKwhUnderated }) {
  const {
    installYear,
    systemSizeKw,
    ownershipType = 'owned',
    ppaRatePerKwh = 0,
    ppaEscalatorPct = 0,
  } = formInput || {};

  const annualProducedKwh = annualizeProduction(productionData);
  const annualImportedKwh = annualizeBillConsumption(billData);
  const annualActualCost = annualizeBillCost(billData);

  // Self-consumption approximation
  let exportedKwh = Number(productionData.exportedToGridKwh) || 0;
  let selfConsumedKwh = Number(productionData.selfConsumedKwh) || 0;
  if (!selfConsumedKwh && annualProducedKwh) {
    if (exportedKwh > 0) {
      selfConsumedKwh = Math.max(0, annualProducedKwh - exportedKwh);
    } else {
      // Rough rule of thumb: residential solar self-consumes 30–50% without battery
      selfConsumedKwh = annualProducedKwh * 0.40;
    }
  }

  const annualGrossConsumptionKwh = annualImportedKwh + selfConsumedKwh;

  const rate = Number(currentRates.totalEffectiveRate) || 0.15;
  const fixedMonthly = Number(currentRates.deliveryFixedMonthly) || 0;
  const counterfactualAnnualCost = annualGrossConsumptionKwh * rate + fixedMonthly * 12;

  // PPA payment (TPO only)
  const isTpo = ownershipType === 'tpo';
  const ppaAnnualPayment = isTpo && annualProducedKwh
    ? annualProducedKwh * Number(ppaRatePerKwh || 0)
    : 0;

  const annualSavings = counterfactualAnnualCost - annualActualCost - ppaAnnualPayment;
  const monthlySavings = annualSavings / 12;

  // Performance: actual vs expected
  const expectedAnnualKwh = expectedAnnualKwhUnderated
    ? expectedAnnualKwhUnderated * ageDerate(installYear)
    : null;
  const performanceRatio = (annualProducedKwh && expectedAnnualKwh)
    ? annualProducedKwh / expectedAnnualKwh
    : null;

  // Lifetime savings (conservative straight-line; real value is higher if rates escalated)
  const years = yearsSinceInstall(installYear);
  const lifetimeSavings = (annualSavings && years)
    ? annualSavings * years
    : null;

  // Flag likely issues
  const flags = [];
  if (performanceRatio != null && performanceRatio < 0.80) {
    flags.push({
      code: 'underperforming',
      severity: 'high',
      label: `System producing ${(performanceRatio * 100).toFixed(0)}% of expected`,
      detail: 'Possible causes: shading (new tree growth, neighboring construction), soiled panels, failing microinverter or string inverter, or a partial string outage. Worth a check by your installer or an independent O&M service.',
    });
  } else if (performanceRatio != null && performanceRatio < 0.92) {
    flags.push({
      code: 'slightly-low',
      severity: 'medium',
      label: `System producing ${(performanceRatio * 100).toFixed(0)}% of expected`,
      detail: 'A few percent below expected. Common causes: a weak production year (weather), modest soiling, or minor shade growth. Monitor another month before taking action.',
    });
  }
  if (annualSavings != null && annualSavings <= 0) {
    flags.push({
      code: 'negative-savings',
      severity: 'high',
      label: 'Analysis shows you may not be saving money',
      detail: 'Double-check your PPA/lease rate and your current utility rate. Some TPO contracts escalate past what utility rates end up doing.',
    });
  }

  return {
    inputs: {
      installYear,
      systemSizeKw,
      ownershipType,
      ppaRatePerKwh,
      ppaEscalatorPct,
      yearsSinceInstall: years,
    },
    production: {
      annualProducedKwh: round(annualProducedKwh),
      expectedAnnualKwh: round(expectedAnnualKwh),
      expectedAnnualKwhNewSystem: round(expectedAnnualKwhUnderated),
      performanceRatio: performanceRatio != null ? round(performanceRatio, 3) : null,
      selfConsumedKwh: round(selfConsumedKwh),
      exportedKwh: round(exportedKwh),
      degradationApplied: round(1 - ageDerate(installYear), 3),
    },
    economics: {
      rate: round(rate, 4),
      counterfactualAnnualCost: round(counterfactualAnnualCost),
      actualAnnualCost: round(annualActualCost),
      ppaAnnualPayment: round(ppaAnnualPayment),
      annualSavings: round(annualSavings),
      monthlySavings: round(monthlySavings),
      lifetimeSavings: round(lifetimeSavings),
    },
    flags,
  };
}

/**
 * Compare what the original sales proposal promised to what the system is actually
 * delivering. Returns null if no proposal was uploaded.
 */
function computePromisedVsReality({ proposalData, actualSavings }) {
  if (!proposalData) return null;

  const promisedAnnualKwh = Number(proposalData.production?.estimatedAnnualKwh) || null;
  const promisedYear1Savings = Number(proposalData.production?.estimatedYear1Savings) || null;
  const promisedMonthlyBillAfter = Number(proposalData.production?.estimatedMonthlyBillAfter) || null;

  const actualAnnualKwh = actualSavings.production.annualProducedKwh;
  const actualAnnualSavings = actualSavings.economics.annualSavings;
  const actualMonthlyBillAfter = (actualSavings.economics.actualAnnualCost || 0) / 12;

  return {
    kwh: (promisedAnnualKwh && actualAnnualKwh) ? {
      promised: round(promisedAnnualKwh),
      actual: round(actualAnnualKwh),
      delta: round(actualAnnualKwh - promisedAnnualKwh),
      deltaPct: round(((actualAnnualKwh - promisedAnnualKwh) / promisedAnnualKwh) * 100, 1),
      verdict: actualAnnualKwh >= promisedAnnualKwh ? 'meeting-or-exceeding' : 'below-promise',
    } : null,
    annualSavings: (promisedYear1Savings && actualAnnualSavings != null) ? {
      promised: round(promisedYear1Savings),
      actual: round(actualAnnualSavings),
      delta: round(actualAnnualSavings - promisedYear1Savings),
      deltaPct: promisedYear1Savings !== 0
        ? round(((actualAnnualSavings - promisedYear1Savings) / promisedYear1Savings) * 100, 1)
        : null,
      verdict: actualAnnualSavings >= promisedYear1Savings ? 'meeting-or-exceeding' : 'below-promise',
    } : null,
    monthlyBillAfter: (promisedMonthlyBillAfter && actualMonthlyBillAfter) ? {
      promised: round(promisedMonthlyBillAfter),
      actual: round(actualMonthlyBillAfter),
      delta: round(actualMonthlyBillAfter - promisedMonthlyBillAfter),
    } : null,
    installer: proposalData.installer?.name || null,
    systemSizePromised: Number(proposalData.system?.sizeKw) || null,
  };
}

function round(n, decimals = 0) {
  if (n == null || isNaN(n)) return null;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

module.exports = {
  computeActualSavings,
  computePromisedVsReality,
  ageDerate,
  yearsSinceInstall,
  annualizeProduction,
  annualizeBillConsumption,
};
