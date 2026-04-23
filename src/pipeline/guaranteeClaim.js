/**
 * Performance-guarantee claim detection and draft-letter generator.
 *
 * Most residential solar proposals include a production guarantee — typically
 * 90–95% of the estimated annual kWh for the first few years. If the system
 * underperforms, the installer usually owes the customer a check for the
 * shortfall at the utility's retail rate.
 *
 * This module:
 *   1. Detects whether the original proposal had a production guarantee.
 *   2. Compares actual vs. guaranteed threshold.
 *   3. If eligible, drafts a claim letter the homeowner can customize and send.
 */

function evaluateGuarantee({ proposalData, actualSavings, billData }) {
  if (!proposalData) return { eligible: false, reason: 'no-proposal' };

  const hasGuarantee = !!proposalData.warranty?.productionGuarantee;
  const guaranteePct = Number(proposalData.warranty?.productionGuaranteePercent) || null;
  const promisedAnnualKwh = Number(proposalData.production?.estimatedAnnualKwh) || null;
  const actualAnnualKwh = actualSavings.production.annualProducedKwh;

  if (!hasGuarantee) return { eligible: false, reason: 'no-guarantee-in-proposal' };
  if (!promisedAnnualKwh) return { eligible: false, reason: 'no-estimated-annual-kwh' };
  if (!actualAnnualKwh) return { eligible: false, reason: 'no-actual-production-data' };

  // Assume 90% threshold if the proposal named a guarantee but didn't specify
  const thresholdPct = guaranteePct && guaranteePct > 0 && guaranteePct <= 100
    ? guaranteePct
    : 90;
  const thresholdKwh = promisedAnnualKwh * (thresholdPct / 100);

  const shortfallKwh = thresholdKwh - actualAnnualKwh;
  const eligible = shortfallKwh > 0;

  const rate = Number(billData?.charges?.supply?.lineItems?.[0]?.rate)
    || 0.15;
  const estimatedReimbursementDollars = eligible ? shortfallKwh * rate : 0;

  return {
    eligible,
    reason: eligible ? 'underperforming-below-guarantee' : 'meeting-guarantee',
    thresholdPct,
    thresholdKwh: Math.round(thresholdKwh),
    promisedAnnualKwh: Math.round(promisedAnnualKwh),
    actualAnnualKwh: Math.round(actualAnnualKwh),
    shortfallKwh: Math.round(Math.max(0, shortfallKwh)),
    estimatedReimbursementDollars: Math.round(estimatedReimbursementDollars),
    assumedRate: rate,
  };
}

function draftClaimLetter({ evaluation, proposalData, billData, formInput }) {
  if (!evaluation?.eligible) return null;

  const customerName = billData?.customer?.name || '[Your Name]';
  const customerAddress = [
    billData?.customer?.address,
    billData?.customer?.city,
    billData?.customer?.state,
    billData?.customer?.zip,
  ].filter(Boolean).join(', ') || '[Your Address]';
  const installerName = proposalData?.installer?.name || '[Installer Name]';
  const installerAddress = proposalData?.installer?.address || '[Installer Address]';
  const installYear = formInput?.installYear || '[Install Year]';
  const systemSizeKw = formInput?.systemSizeKw || proposalData?.system?.sizeKw || '[System Size]';
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const body = `${today}

${installerName}
${installerAddress}

RE: Production Guarantee Shortfall Claim — ${customerName}, ${customerAddress}

To whom it may concern,

I am writing to formally submit a claim under the production guarantee in my solar installation agreement with ${installerName}. My ${systemSizeKw} kW system was installed in ${installYear}. According to the proposal and contract, the system was guaranteed to produce at least ${evaluation.thresholdPct}% of the estimated annual production of ${evaluation.promisedAnnualKwh.toLocaleString()} kWh, or ${evaluation.thresholdKwh.toLocaleString()} kWh per year.

Based on the production data from my monitoring system, my system has produced approximately ${evaluation.actualAnnualKwh.toLocaleString()} kWh over the last 12 months — a shortfall of approximately ${evaluation.shortfallKwh.toLocaleString()} kWh below the guaranteed threshold.

At my current utility rate of approximately $${evaluation.assumedRate.toFixed(4)} per kWh, this represents a financial shortfall of approximately $${evaluation.estimatedReimbursementDollars.toLocaleString()} that I believe I am owed under the guarantee.

I would like to request the following:
  1. A written acknowledgement of this claim within 14 days.
  2. A site visit or remote diagnostic to identify the root cause of the underperformance (possible issues include inverter faults, soiling, shade growth, or string failures).
  3. Payment of the shortfall as outlined in the guarantee, or correction of the system such that it meets the guaranteed threshold going forward.

I have attached:
  • A copy of the original sales proposal and guarantee language.
  • Screenshots of the monitoring dashboard showing 12-month production.
  • Copies of recent utility bills showing the current retail rate.

Please confirm receipt and let me know the next step. I can be reached at the contact information below.

Sincerely,

${customerName}
${customerAddress}
`;

  return {
    subject: `Production Guarantee Shortfall — ${customerName} — ${customerAddress}`,
    body,
    checklist: [
      'Pull the original signed contract and identify the exact production guarantee clause',
      'Export the full lifetime production CSV from your monitoring app',
      'Keep your last 3 utility bills to prove the retail rate',
      'Send this letter certified mail AND by email (keeps a paper trail)',
      'Give the installer 14 days to acknowledge; 30 days for substantive response',
      'If they don\'t respond, escalate to your state\'s contractor licensing board or Attorney General consumer protection division',
    ],
  };
}

module.exports = { evaluateGuarantee, draftClaimLetter };
