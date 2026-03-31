const { BATTERY_COST_13KWH, NET_METERING_CREDIT_RATE } = require('../constants');

function analyzeBatteryValue(currentRates) {
  const batteryCost = BATTERY_COST_13KWH;
  const batteryCapacityKwh = 13.5;

  // Value stream 1: Backup power during outages
  // Colorado Front Range: winter storms, occasional summer severe weather
  const backupAnnualValue = 400;

  // Value stream 2: Rate arbitrage (TOU spread)
  // Xcel Energy RE-TOU rate has meaningful peak/off-peak spread
  // Peak: ~$0.18-0.22/kWh, Off-peak: ~$0.10-0.12/kWh
  // Spread of ~$0.08-0.10/kWh
  const touSpreadPerKwh = 0.08; // conservative estimate
  // Battery cycles once per day during peak, ~280 effective days/year
  const arbitrageAnnualValue = Math.round(batteryCapacityKwh * 0.9 * touSpreadPerKwh * 280);

  // Value stream 3: Self-consumption optimization
  // With full retail net metering, grid acts as free battery
  // With reduced NEM: value = (retail - export credit) * kWh shifted
  let selfConsumptionAnnualValue = 0;
  if (NET_METERING_CREDIT_RATE < 1.0) {
    const spreadPerKwh = currentRates.supplyPerKwh * (1 - NET_METERING_CREDIT_RATE);
    selfConsumptionAnnualValue = Math.round(batteryCapacityKwh * 0.9 * spreadPerKwh * 300);
  }

  // Value stream 4: Xcel demand response programs
  // Xcel offers programs that pay for battery dispatch during grid peaks
  const demandResponseAnnualValue = 75; // conservative estimate

  const totalAnnualValue = backupAnnualValue + arbitrageAnnualValue + selfConsumptionAnnualValue + demandResponseAnnualValue;
  const simplePaybackYears = totalAnnualValue > 0 ? batteryCost / totalAnnualValue : Infinity;

  const recommended = simplePaybackYears <= 15;

  const analysis = {
    batterySize: `${batteryCapacityKwh} kWh`,
    estimatedCost: batteryCost,
    valueStreams: {
      backupPower: {
        annualValue: backupAnnualValue,
        reasoning: 'Estimated 3-4 outages/year from winter storms and severe weather. Avoids spoilage, inconvenience, and generator costs.',
      },
      rateArbitrage: {
        annualValue: arbitrageAnnualValue,
        reasoning: `Xcel Energy TOU rates have a ~$0.08/kWh peak-to-off-peak spread. Battery charges during off-peak and discharges during peak hours.`,
      },
      selfConsumption: {
        annualValue: selfConsumptionAnnualValue,
        reasoning: NET_METERING_CREDIT_RATE >= 1.0
          ? 'Full retail net metering means the grid acts as a free battery. Minimal additional value from storage for self-consumption.'
          : `Reduced net metering creates a spread the battery can capture.`,
      },
      demandResponse: {
        annualValue: demandResponseAnnualValue,
        reasoning: 'Xcel Energy offers demand response programs that compensate battery owners for grid support during peak events.',
      },
    },
    totalAnnualValue,
    simplePaybackYears: simplePaybackYears === Infinity ? null : Math.round(simplePaybackYears * 10) / 10,
    recommended,
    recommendation: recommended ? 'WORTH CONSIDERING' : 'OPTIONAL',
    summary: recommended
      ? `Battery storage pays for itself in ~${Math.round(simplePaybackYears)} years through TOU arbitrage, backup power, and demand response programs. If backup power is important to you, it's a solid add.`
      : `Battery payback is ~${Math.round(simplePaybackYears)} years. The main value is backup power during outages. If that matters to you, it's worth the investment. If not, solar alone gives you the best return.`,
  };

  console.log(`[batteryAnalysis] ${analysis.recommendation} — payback: ${analysis.simplePaybackYears || '∞'} years, annual value: $${totalAnnualValue}`);
  return analysis;
}

module.exports = { analyzeBatteryValue };
