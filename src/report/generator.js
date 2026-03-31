const fs = require('fs').promises;
const path = require('path');
const { ANNUAL_RATE_ESCALATION, SYSTEM_COST_PER_WATT, DEFAULT_LOAN_RATE, DEFAULT_LOAN_TERM_YEARS } = require('../constants');
const { VERIFICATION_STATUS } = require('../pipeline/verification');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Route to the correct report generator based on mode.
 */
async function generateReport(data) {
  const mode = data.mode || 'bill';

  if (mode === 'proposal') {
    return generateProposalReport(data);
  } else if (mode === 'combined') {
    return generateCombinedReport(data);
  } else {
    return generateBillReport(data);
  }
}

// ── Proposal Report ──────────────────────────────────────────────────

async function generateProposalReport({ proposalData, score, productionData, batteryAnalysis }) {
  const templatePath = path.join(__dirname, 'template-proposal.html');
  let html = await fs.readFile(templatePath, 'utf-8');

  const comp = score.competitor;
  const counter = score.counterProposal;
  const comparison = score.comparison;

  // Verdict
  const verdicts = {
    'bad-deal': { headline: "This quote is a bad deal.", sub: `${comp.name} is charging you significantly more than this system is worth.` },
    'below-average': { headline: "This quote is below average.", sub: `There are several issues with ${comp.name}'s offer that you should know about.` },
    'average': { headline: "This quote is about average.", sub: `${comp.name}'s pricing is in the normal range, but you can still do better.` },
    'fair': { headline: "This quote is fair.", sub: `${comp.name} is offering a reasonable deal — but we can still save you money.` },
  };

  const verdict = verdicts[score.overallVerdict] || verdicts['average'];
  const priceSavings = comparison.totalPrice.savings;

  // Build issues HTML
  let issuesHtml = '';
  if (score.issues.length > 0) {
    issuesHtml = '<div class="card"><div class="card-title">Issues We Found</div>';
    for (const issue of score.issues) {
      issuesHtml += `<div class="issue ${issue.severity}">
        <div class="issue-label">${issue.severity === 'high' ? 'Warning' : issue.severity === 'medium' ? 'Note' : 'Info'}</div>
        ${issue.message}
      </div>`;
    }
    issuesHtml += '</div>';
  }

  const replacements = {
    '{{VERDICT_CLASS}}': score.overallVerdict,
    '{{VERDICT_HEADLINE}}': verdict.headline,
    '{{VERDICT_SUBTEXT}}': verdict.sub,
    '{{PRICE_SAVINGS}}': formatNum(priceSavings, 0),
    '{{COMPETITOR_NAME}}': comp.name,
    '{{THEIR_SIZE}}': comparison.systemSize.theirs,
    '{{OUR_SIZE}}': comparison.systemSize.ours,
    '{{THEIR_PRICE}}': formatNum(comparison.totalPrice.theirs, 0),
    '{{OUR_PRICE}}': formatNum(comparison.totalPrice.ours, 0),
    '{{THEIR_PPW}}': comparison.pricePerWatt.theirs.toFixed(2),
    '{{OUR_PPW}}': SYSTEM_COST_PER_WATT.toFixed(2),
    '{{THEIR_MONTHLY}}': formatNum(comparison.monthlyPayment.theirs, 0),
    '{{OUR_MONTHLY}}': formatNum(comparison.monthlyPayment.ours, 0),
    '{{THEIR_PRODUCTION}}': formatNum(comparison.annualProduction.theirs, 0),
    '{{OUR_PRODUCTION}}': formatNum(comparison.annualProduction.ours, 0),
    '{{THEIR_ESCALATOR}}': comparison.escalator.theirs,
    '{{THEIR_DEALER_FEE}}': comparison.dealerFee.theirs,
    '{{THEIR_ITC}}': comparison.itcRequired.theirs,
    '{{ISSUES_SECTION}}': issuesHtml,
    '{{LOAN_RATE}}': (DEFAULT_LOAN_RATE * 100).toFixed(1),
    '{{LOAN_TERM}}': DEFAULT_LOAN_TERM_YEARS,
    '{{PAYBACK_YEARS}}': counter.paybackYears,
    '{{BATTERY_TAG_CLASS}}': batteryAnalysis.recommended ? 'yes' : 'no',
    '{{BATTERY_VERDICT}}': batteryAnalysis.recommendation,
    '{{BATTERY_SUMMARY}}': batteryAnalysis.summary,
    '{{BATTERY_COST}}': formatNum(batteryAnalysis.estimatedCost, 0),
    '{{BATTERY_PAYBACK}}': batteryAnalysis.simplePaybackYears || 'N/A',
    '{{RATE_ESCALATION}}': (ANNUAL_RATE_ESCALATION * 100).toFixed(0),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, String(value));
  }

  return html;
}

// ── Bill Report (updated from original) ──────────────────────────────

async function generateBillReport({ billData, savingsResult, currentRates, postSolarRates, incentives, roofData, verification }) {
  const templatePath = path.join(__dirname, 'template-bill.html');
  let html = await fs.readFile(templatePath, 'utf-8');

  const endDate = new Date(billData.servicePeriod.endDate);
  const billMonth = endDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const fullAddress = `${billData.customer.address}, ${billData.customer.city}, ${billData.customer.state} ${billData.customer.zip}`;

  const postBarWidth = savingsResult.year1.avgMonthlyPreSolar > 0
    ? Math.round((savingsResult.year1.avgMonthlyPostSolar / savingsResult.year1.avgMonthlyPreSolar) * 100)
    : 10;

  const battery = savingsResult.battery;
  const batteryPayback = battery.simplePaybackYears ? `${battery.simplePaybackYears} years` : 'N/A';

  const replacements = {
    '{{ADDRESS}}': fullAddress,
    '{{UTILITY_NAME}}': billData.utilityName || 'Your Utility',
    '{{ACCOUNT_NUMBER}}': billData.account?.number || 'N/A',
    '{{REPORT_DATE}}': new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    '{{BILL_MONTH}}': billMonth,
    '{{CURRENT_MONTHLY_BILL}}': formatNum(billData.totalAmountDue),
    '{{MONTHLY_USAGE_KWH}}': formatNum(billData.meterReadings.totalUsageKwh, 0),
    '{{ESTIMATED_ANNUAL_BILL}}': formatNum(savingsResult.year1.preSolarAnnualBill, 0),
    '{{EFFECTIVE_RATE}}': currentRates.totalEffectiveRate.toFixed(3),
    '{{SYSTEM_SIZE_KW}}': savingsResult.system.sizeKw,
    '{{PANEL_COUNT}}': savingsResult.system.panels,
    '{{OFFSET_PCT}}': savingsResult.system.offsetPercentage,
    '{{ANNUAL_PRODUCTION}}': formatNum(savingsResult.system.annualProductionKwh, 0),
    '{{MONTHLY_SAVINGS}}': formatNum(savingsResult.year1.avgMonthlySavings, 0),
    '{{ANNUAL_SAVINGS}}': formatNum(savingsResult.year1.annualSavings, 0),
    '{{AVG_MONTHLY_PRE}}': formatNum(savingsResult.year1.avgMonthlyPreSolar, 0),
    '{{AVG_MONTHLY_POST}}': formatNum(savingsResult.year1.avgMonthlyPostSolar, 0),
    '{{POST_BAR_WIDTH}}': Math.max(5, postBarWidth),
    '{{GROSS_COST}}': formatNum(savingsResult.costs.grossCost, 0),
    '{{NET_COST}}': formatNum(savingsResult.costs.netCost, 0),
    '{{PRICE_PER_WATT}}': SYSTEM_COST_PER_WATT.toFixed(2),
    '{{PAYBACK_YEARS}}': savingsResult.payback.simpleYears,
    '{{TOTAL_25YR_SAVINGS}}': formatNum(savingsResult.twentyFiveYear.totalSavings, 0),
    '{{BATTERY_TAG_CLASS}}': battery.recommended ? 'yes' : 'no',
    '{{BATTERY_VERDICT}}': battery.recommendation,
    '{{BATTERY_SUMMARY}}': battery.summary,
    '{{BATTERY_COST}}': formatNum(battery.estimatedCost, 0),
    '{{BATTERY_PAYBACK}}': batteryPayback,
    '{{RATE_ESCALATION}}': (ANNUAL_RATE_ESCALATION * 100).toFixed(0),
    '{{LOAN_RATE}}': (DEFAULT_LOAN_RATE * 100).toFixed(1),
    '{{LOAN_TERM}}': DEFAULT_LOAN_TERM_YEARS,
    '{{MONTHLY_PAYMENT}}': formatNum(calculateMonthlyPayment(savingsResult.costs.netCost, DEFAULT_LOAN_RATE, DEFAULT_LOAN_TERM_YEARS), 0),
    '{{MONTHLY_CHART}}': buildMonthlyChart(
      savingsResult.consumption.monthlyKwh,
      savingsResult.monthlyProductionKwh
    ),
    '{{MONTHLY_TABLE}}': buildMonthlyTable(savingsResult.monthlyBreakdown),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, String(value));
  }

  return html;
}

// ── Combined Report ──────────────────────────────────────────────────

async function generateCombinedReport(data) {
  // For combined, we generate the proposal comparison report
  // but enhanced with real bill data
  return generateProposalReport(data);
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildMonthlyChart(consumption, production) {
  const W = 700, H = 250;
  const pad = { top: 20, right: 20, bottom: 40, left: 55 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const allVals = [...consumption, ...production];
  const maxVal = Math.ceil(Math.max(...allVals) / 500) * 500 || 2000;

  const xStep = plotW / 11;
  const scaleY = (v) => pad.top + plotH - (v / maxVal) * plotH;
  const scaleX = (i) => pad.left + i * xStep;

  const consumptionPoints = consumption.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');
  const productionPoints = production.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');

  const consumptionFill = `${scaleX(0)},${scaleY(0)} ${consumptionPoints} ${scaleX(11)},${scaleY(0)}`;
  const productionFill = `${scaleX(0)},${scaleY(0)} ${productionPoints} ${scaleX(11)},${scaleY(0)}`;

  const gridSteps = 5;
  const gridInterval = maxVal / gridSteps;
  let gridLines = '';
  for (let i = 0; i <= gridSteps; i++) {
    const val = Math.round(gridInterval * i);
    const y = scaleY(val);
    gridLines += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
    gridLines += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#9ca3af" font-size="11">${val.toLocaleString()}</text>`;
  }

  let xLabels = '';
  for (let i = 0; i < 12; i++) {
    xLabels += `<text x="${scaleX(i)}" y="${H - pad.bottom + 20}" text-anchor="middle" fill="#6b7280" font-size="11">${MONTH_LABELS[i]}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px; font-family: -apple-system, sans-serif;">
    ${gridLines}
    <polygon points="${consumptionFill}" fill="rgba(239,68,68,0.08)"/>
    <polygon points="${productionFill}" fill="rgba(34,197,94,0.08)"/>
    <polyline points="${consumptionPoints}" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linejoin="round"/>
    <polyline points="${productionPoints}" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round"/>
    ${consumption.map((v, i) => `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="3" fill="#ef4444"/>`).join('')}
    ${production.map((v, i) => `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="3" fill="#22c55e"/>`).join('')}
    ${xLabels}
    <text x="${pad.left}" y="${H - 2}" fill="#9ca3af" font-size="10">kWh</text>
    <line x1="${W - pad.right - 120}" y1="${pad.top}" x2="${W - pad.right - 100}" y2="${pad.top}" stroke="#ef4444" stroke-width="2.5"/>
    <text x="${W - pad.right - 95}" y="${pad.top + 4}" fill="#6b7280" font-size="11">Your Usage</text>
    <line x1="${W - pad.right - 120}" y1="${pad.top + 18}" x2="${W - pad.right - 100}" y2="${pad.top + 18}" stroke="#22c55e" stroke-width="2.5"/>
    <text x="${W - pad.right - 95}" y="${pad.top + 22}" fill="#6b7280" font-size="11">Solar Production</text>
  </svg>`;
}

function buildMonthlyTable(monthlyBreakdown) {
  const rows = monthlyBreakdown.map((m) => {
    const netClass = m.netGridKwh < 0 ? ' class="net-export"' : '';
    return `<tr>
      <td>${m.month}</td>
      <td>${m.consumptionKwh.toLocaleString()}</td>
      <td>${m.solarGenKwh.toLocaleString()}</td>
      <td${netClass}>${m.netGridKwh.toLocaleString()}</td>
      <td>$${m.billBefore.toLocaleString()}</td>
      <td>$${m.billAfter.toLocaleString()}</td>
      <td class="savings-cell">$${m.savings.toLocaleString()}</td>
    </tr>`;
  }).join('\n');

  const totals = monthlyBreakdown.reduce((acc, m) => ({
    consumption: acc.consumption + m.consumptionKwh,
    solarGen: acc.solarGen + m.solarGenKwh,
    netGrid: acc.netGrid + m.netGridKwh,
    billBefore: acc.billBefore + m.billBefore,
    billAfter: acc.billAfter + m.billAfter,
    savings: acc.savings + m.savings,
  }), { consumption: 0, solarGen: 0, netGrid: 0, billBefore: 0, billAfter: 0, savings: 0 });

  return `<table class="monthly-table">
    <thead><tr>
      <th>Month</th><th>Usage</th><th>Solar</th><th>Net</th><th>Before</th><th>After</th><th>Savings</th>
    </tr></thead>
    <tbody>${rows}
      <tr class="total-row">
        <td>Total</td>
        <td>${totals.consumption.toLocaleString()}</td>
        <td>${totals.solarGen.toLocaleString()}</td>
        <td>${totals.netGrid.toLocaleString()}</td>
        <td>$${totals.billBefore.toLocaleString()}</td>
        <td>$${totals.billAfter.toLocaleString()}</td>
        <td class="savings-cell">$${totals.savings.toLocaleString()}</td>
      </tr>
    </tbody>
  </table>`;
}

function calculateMonthlyPayment(principal, annualRate, years) {
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return Math.round(principal / n);
  return Math.round((principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

function formatNum(num, decimals = 2) {
  if (num == null || isNaN(num)) return '0';
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

module.exports = { generateReport };
