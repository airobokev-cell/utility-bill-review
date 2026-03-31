const { FEDERAL_ITC_RATE, STATE_INCENTIVE_VALUE } = require('../constants');

function calculateIncentives(systemSizeKw, grossSystemCost, annualProductionKwh) {
  // No federal ITC (expired for homeowner-owned systems after 2025)
  const itcValue = grossSystemCost * FEDERAL_ITC_RATE;

  // Colorado: no state SRECs, no state tax credit
  const stateIncentiveValue = STATE_INCENTIVE_VALUE;

  const incentives = {
    federalITC: {
      name: 'Federal Investment Tax Credit (ITC)',
      rate: FEDERAL_ITC_RATE,
      value: itcValue,
      description: FEDERAL_ITC_RATE > 0
        ? `${(FEDERAL_ITC_RATE * 100).toFixed(0)}% of gross system cost.`
        : 'The residential solar tax credit (Section 25D) expired after December 31, 2025. No federal tax credit is available.',
    },
    stateIncentives: {
      name: 'State Incentives',
      value: stateIncentiveValue,
      description: 'Colorado does not currently offer state solar tax credits or SREC programs.',
    },
    propertyTaxExemption: {
      name: 'Colorado Solar Property Tax Exemption',
      value: 0,
      description: 'Solar panels are exempt from increasing your property tax assessment in Colorado.',
    },
    totalIncentiveValue: itcValue + stateIncentiveValue,
  };

  console.log(`[incentives] ITC: $${Math.round(itcValue)}, State: $${Math.round(stateIncentiveValue)}, Total: $${Math.round(incentives.totalIncentiveValue)}`);
  return incentives;
}

module.exports = { calculateIncentives };
