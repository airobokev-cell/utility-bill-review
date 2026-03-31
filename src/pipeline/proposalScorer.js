const { SYSTEM_COST_PER_WATT, BATTERY_COST_13KWH, DEFAULT_LOAN_RATE, DEFAULT_LOAN_TERM_YEARS, ANNUAL_RATE_ESCALATION } = require('../constants');

/**
 * Score a competitor's solar proposal and generate a comparison against our offering.
 * Returns a structured analysis with issues, our counter-offer, and a side-by-side.
 */
function scoreProposal(proposalData, productionData, currentRates) {
  const issues = [];
  const competitor = proposalData;
  const sizeKw = competitor.system.sizeKw || 0;
  const sizeW = sizeKw * 1000;

  // ── Price Analysis ──────────────────────────────────────────────────
  const theirPricePerWatt = competitor.pricing.pricePerWatt || 0;
  const theirTotalPrice = competitor.pricing.priceBeforeIncentives || competitor.pricing.totalPrice || 0;
  const ourPricePerWatt = SYSTEM_COST_PER_WATT;
  const ourTotalPrice = Math.round(sizeW * ourPricePerWatt);
  const priceDifference = theirTotalPrice - ourTotalPrice;

  let priceRating;
  if (theirPricePerWatt > 4.0) {
    priceRating = 'overpriced';
    issues.push({
      severity: 'high',
      category: 'price',
      message: `At $${theirPricePerWatt.toFixed(2)}/W, this quote is significantly above market. Fair price for this system is $${ourPricePerWatt.toFixed(2)}/W.`,
    });
  } else if (theirPricePerWatt > 3.0) {
    priceRating = 'above-average';
    issues.push({
      severity: 'medium',
      category: 'price',
      message: `At $${theirPricePerWatt.toFixed(2)}/W, this quote is above average. You can get the same system for $${ourPricePerWatt.toFixed(2)}/W.`,
    });
  } else if (theirPricePerWatt > 2.5) {
    priceRating = 'average';
  } else {
    priceRating = 'competitive';
  }

  // ── ITC Check (expired for homeowner-owned systems after 2025) ─────
  const itcAmount = competitor.pricing.federalITCAmount || 0;
  const itcPercent = competitor.pricing.federalITCPercent || 0;
  if (itcAmount > 0 || itcPercent > 0) {
    issues.push({
      severity: 'high',
      category: 'itc',
      message: `This quote shows a ${itcPercent || 30}% federal tax credit ($${itcAmount.toLocaleString()}). The residential solar tax credit (Section 25D) expired after December 31, 2025. This credit is no longer available for homeowner-owned systems. The actual cost is $${theirTotalPrice.toLocaleString()}, not $${(theirTotalPrice - itcAmount).toLocaleString()}.`,
    });
  }

  // ── Production Accuracy ─────────────────────────────────────────────
  let productionRating = 'accurate';
  const theirAnnualKwh = competitor.production.estimatedAnnualKwh || 0;
  const pvwattsAnnualKwh = productionData?.acAnnual || 0;

  if (theirAnnualKwh > 0 && pvwattsAnnualKwh > 0) {
    const productionDiff = (theirAnnualKwh - pvwattsAnnualKwh) / pvwattsAnnualKwh;
    if (productionDiff > 0.15) {
      productionRating = 'overstated';
      issues.push({
        severity: 'medium',
        category: 'production',
        message: `Their estimated production (${theirAnnualKwh.toLocaleString()} kWh/yr) is ${Math.round(productionDiff * 100)}% higher than the independent NREL estimate (${Math.round(pvwattsAnnualKwh).toLocaleString()} kWh/yr). Your actual savings may be lower than they project.`,
      });
    } else if (productionDiff < -0.15) {
      productionRating = 'understated';
    }
  }

  // ── Financing Analysis ──────────────────────────────────────────────
  const finType = (competitor.financing.type || '').toLowerCase();

  // Dealer fee detection
  if (competitor.pricing.dealerFee > 0 || competitor.pricing.dealerFeePercent > 0) {
    const feeAmount = competitor.pricing.dealerFee || Math.round(theirTotalPrice * (competitor.pricing.dealerFeePercent / 100));
    issues.push({
      severity: 'high',
      category: 'financing',
      message: `This loan includes a $${feeAmount.toLocaleString()} dealer fee (${competitor.pricing.dealerFeePercent || Math.round((feeAmount / theirTotalPrice) * 100)}%) baked into your loan amount. You're financing the fee plus interest on it for the full loan term. Our loans have zero dealer fees.`,
    });
  }

  // Escalator check for lease/PPA
  if ((finType === 'lease' || finType === 'ppa') && competitor.financing.escalatorPercent > 0) {
    const esc = competitor.financing.escalatorPercent;
    if (esc > 2.5) {
      issues.push({
        severity: 'high',
        category: 'financing',
        message: `This ${finType.toUpperCase()} has a ${esc}% annual escalator. That means your payment increases every year. At ${esc}%, your payment will be ${Math.round(Math.pow(1 + esc / 100, 15) * 100 - 100)}% higher in year 15 and ${Math.round(Math.pow(1 + esc / 100, 25) * 100 - 100)}% higher in year 25. With utility rates rising at ~${(ANNUAL_RATE_ESCALATION * 100).toFixed(0)}%, a ${esc}% escalator means you could end up PAYING MORE than your utility bill.`,
      });
    } else if (esc > 0) {
      issues.push({
        severity: 'low',
        category: 'financing',
        message: `This ${finType.toUpperCase()} has a ${esc}% annual escalator. Your payment increases each year. Make sure this still results in savings by year 10+.`,
      });
    }
  }

  // ── Our Counter-Proposal ────────────────────────────────────────────
  const ourMonthlyPayment = calculateMonthlyPayment(ourTotalPrice, DEFAULT_LOAN_RATE, DEFAULT_LOAN_TERM_YEARS);
  const ourProductionKwh = pvwattsAnnualKwh || (sizeKw * 1400); // fallback estimate
  const effectiveRate = currentRates?.totalEffectiveRate || 0.164; // CO default
  const ourAnnualSavings = Math.round(ourProductionKwh * effectiveRate);
  const ourMonthlySavings = Math.round(ourAnnualSavings / 12);

  // Calculate their monthly payment if not given
  let theirMonthlyPayment = competitor.financing.monthlyPayment || 0;
  if (!theirMonthlyPayment && finType === 'loan' && competitor.financing.loanRate) {
    theirMonthlyPayment = calculateMonthlyPayment(
      theirTotalPrice + (competitor.pricing.dealerFee || 0),
      competitor.financing.loanRate / 100,
      competitor.financing.loanTerm || 25
    );
  }
  if (!theirMonthlyPayment && (finType === 'lease' || finType === 'ppa')) {
    theirMonthlyPayment = competitor.financing.leaseMonthly || 0;
  }

  // 25-year cost comparison
  const our25YearCost = ourMonthlyPayment * 12 * DEFAULT_LOAN_TERM_YEARS;
  let their25YearCost = 0;
  if (finType === 'lease' || finType === 'ppa') {
    const esc = (competitor.financing.escalatorPercent || 0) / 100;
    for (let y = 0; y < 25; y++) {
      their25YearCost += theirMonthlyPayment * 12 * Math.pow(1 + esc, y);
    }
  } else {
    their25YearCost = theirMonthlyPayment * 12 * (competitor.financing.loanTerm || 25);
  }

  const counterProposal = {
    systemSizeKw: sizeKw,
    panelCount: Math.ceil(sizeW / 400),
    totalPrice: ourTotalPrice,
    pricePerWatt: ourPricePerWatt,
    monthlyPayment: ourMonthlyPayment,
    loanRate: DEFAULT_LOAN_RATE * 100,
    loanTerm: DEFAULT_LOAN_TERM_YEARS,
    annualProductionKwh: Math.round(ourProductionKwh),
    annualSavings: ourAnnualSavings,
    monthlySavings: ourMonthlySavings,
    paybackYears: Math.round((ourTotalPrice / ourAnnualSavings) * 10) / 10,
    total25YearCost: Math.round(our25YearCost),
    batteryPrice: BATTERY_COST_13KWH,
  };

  // ── Side-by-Side Comparison ─────────────────────────────────────────
  const comparison = {
    systemSize: { theirs: sizeKw, ours: sizeKw, unit: 'kW' },
    totalPrice: { theirs: theirTotalPrice, ours: ourTotalPrice, savings: priceDifference, unit: '$' },
    pricePerWatt: { theirs: theirPricePerWatt, ours: ourPricePerWatt, unit: '$/W' },
    monthlyPayment: { theirs: theirMonthlyPayment, ours: ourMonthlyPayment, unit: '$/mo' },
    annualProduction: { theirs: theirAnnualKwh, ours: Math.round(ourProductionKwh), unit: 'kWh' },
    estimatedMonthlySavings: { theirs: Math.round((competitor.production.estimatedYear1Savings || 0) / 12), ours: ourMonthlySavings, unit: '$/mo' },
    total25YearCost: { theirs: Math.round(their25YearCost), ours: Math.round(our25YearCost), unit: '$' },
    escalator: { theirs: `${competitor.financing.escalatorPercent || 0}%`, ours: '0% (fixed)', unit: '' },
    dealerFee: { theirs: `$${(competitor.pricing.dealerFee || 0).toLocaleString()}`, ours: '$0', unit: '' },
    itcRequired: { theirs: itcAmount > 0 ? 'Yes (expired)' : 'No', ours: 'No', unit: '' },
  };

  // ── Overall Score ───────────────────────────────────────────────────
  const highIssues = issues.filter((i) => i.severity === 'high').length;
  const mediumIssues = issues.filter((i) => i.severity === 'medium').length;

  let overallVerdict;
  if (highIssues >= 2) {
    overallVerdict = 'bad-deal';
  } else if (highIssues >= 1 || mediumIssues >= 2) {
    overallVerdict = 'below-average';
  } else if (mediumIssues >= 1) {
    overallVerdict = 'average';
  } else {
    overallVerdict = 'fair';
  }

  return {
    overallVerdict,
    priceRating,
    productionRating,
    issues,
    comparison,
    counterProposal,
    competitor: {
      name: competitor.installer?.name || 'Unknown Installer',
      totalPrice: theirTotalPrice,
      pricePerWatt: theirPricePerWatt,
      monthlyPayment: theirMonthlyPayment,
      financing: finType,
    },
  };
}

function calculateMonthlyPayment(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return Math.round(principal / n);
  return Math.round((principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

module.exports = { scoreProposal };
