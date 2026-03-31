const { FEDERAL_ITC_RATE, STATE_INCENTIVE_VALUE, COLORADO_PROPERTY_TAX_EXEMPT, SYSTEM_COST_PER_WATT } = require('../constants');

function calculateIncentives(systemSizeKw, grossSystemCost, annualProductionKwh) {
  // No federal ITC (Section 25D expired for residential after Dec 31, 2025)
  const itcValue = grossSystemCost * FEDERAL_ITC_RATE;

  // Colorado: no state SRECs, no state tax credit
  const stateIncentiveValue = STATE_INCENTIVE_VALUE;

  // Colorado solar property tax exemption (C.R.S. 39-1-104(16))
  // Estimate the avoided property tax increase from the solar installation
  // Average Colorado mill levy ~80 mills, residential assessment rate 6.95% (2025)
  const assessmentRate = 0.0695;
  const millLevy = 80; // mills (varies by county; 80 is Front Range average)
  const annualPropertyTaxAvoided = COLORADO_PROPERTY_TAX_EXEMPT
    ? Math.round(grossSystemCost * assessmentRate * (millLevy / 1000))
    : 0;
  // 25-year value of property tax exemption (not discounted, for simplicity)
  const propertyTaxExemption25yr = annualPropertyTaxAvoided * 25;

  const incentives = {
    federalITC: {
      name: 'Federal Investment Tax Credit (ITC)',
      rate: FEDERAL_ITC_RATE,
      value: itcValue,
      description: FEDERAL_ITC_RATE > 0
        ? `${(FEDERAL_ITC_RATE * 100).toFixed(0)}% of gross system cost.`
        : 'The residential solar tax credit (Section 25D) expired after December 31, 2025. No federal tax credit is available for homeowner-owned systems.',
    },
    stateIncentives: {
      name: 'State Incentives',
      value: stateIncentiveValue,
      description: 'Colorado does not currently offer state solar tax credits or SREC programs.',
    },
    propertyTaxExemption: {
      name: 'Colorado Solar Property Tax Exemption',
      value: propertyTaxExemption25yr,
      annualValue: annualPropertyTaxAvoided,
      description: COLORADO_PROPERTY_TAX_EXEMPT
        ? `Under C.R.S. 39-1-104(16), solar energy systems are 100% exempt from property tax assessment in Colorado. Your solar system will not increase your property taxes — saving approximately $${annualPropertyTaxAvoided}/year ($${propertyTaxExemption25yr.toLocaleString()} over 25 years).`
        : 'No property tax exemption available.',
    },
    // Note: property tax exemption is NOT subtracted from system cost (it's an ongoing benefit, not upfront)
    totalIncentiveValue: itcValue + stateIncentiveValue,
  };

  console.log(`[incentives] ITC: $${Math.round(itcValue)}, State: $${Math.round(stateIncentiveValue)}, Property tax savings: $${annualPropertyTaxAvoided}/yr, Total upfront: $${Math.round(incentives.totalIncentiveValue)}`);
  return incentives;
}

module.exports = { calculateIncentives };
