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

async function generateBillReport({ billData, savingsResult, currentRates, postSolarRates, incentives, roofData, verification, efficiencyAnalysis }) {
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
    '{{EFFICIENCY_SECTION}}': buildEfficiencySection(efficiencyAnalysis),
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

// ── Efficiency Section Builder ───────────────────────────────────────

function buildEfficiencySection(efficiencyAnalysis) {
  if (!efficiencyAnalysis) return '';

  const ea = efficiencyAnalysis;
  const profile = ea.efficiencyProfile;
  const peer = ea.peerComparison;
  const score = ea.efficiencyScore;
  const anomalies = ea.anomalies;
  const recs = ea.recommendations;
  const postUpgrade = ea.postUpgradeAnalysis;

  // Score color
  let scoreColor = '#22c55e'; // green
  if (score.score >= 70) scoreColor = '#ef4444'; // red
  else if (score.score >= 50) scoreColor = '#f59e0b'; // amber
  else if (score.score >= 30) scoreColor = '#3b82f6'; // blue

  // Score label
  let scoreLabel = 'Efficient';
  if (score.score >= 70) scoreLabel = 'High Usage';
  else if (score.score >= 50) scoreLabel = 'Above Average';
  else if (score.score >= 30) scoreLabel = 'Average';

  // Build monthly usage bar chart (inline SVG)
  const months = profile.kwhPerMonth;
  const maxKwh = Math.max(...months, 1);
  const baselineY = profile.baseloadMonthlyKwh;
  const barW = 42;
  const chartW = 580;
  const chartH = 160;
  const gap = (chartW - barW * 12) / 11;

  let barsHtml = '';
  for (let i = 0; i < 12; i++) {
    const x = i * (barW + gap);
    const h = (months[i] / maxKwh) * (chartH - 25);
    const y = chartH - 20 - h;
    const isAboveBase = months[i] > baselineY * 1.15;
    const color = isAboveBase ? '#f59e0b' : '#3b82f6';
    barsHtml += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${color}" opacity="0.8"/>`;
    barsHtml += `<text x="${x + barW / 2}" y="${chartH - 5}" text-anchor="middle" fill="#6b7280" font-size="10">${MONTH_LABELS[i]}</text>`;
    if (months[i] > 0) {
      barsHtml += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="#6b7280" font-size="9">${months[i]}</text>`;
    }
  }

  // Baseline line
  const baseH = (baselineY / maxKwh) * (chartH - 25);
  const baseY = chartH - 20 - baseH;
  barsHtml += `<line x1="0" y1="${baseY}" x2="${chartW}" y2="${baseY}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3"/>`;
  barsHtml += `<text x="${chartW}" y="${baseY - 4}" text-anchor="end" fill="#94a3b8" font-size="10">Baseload: ${baselineY} kWh/mo</text>`;

  const usageChart = `<svg viewBox="0 0 ${chartW} ${chartH}" width="100%" style="max-width:${chartW}px; font-family: -apple-system, sans-serif;">${barsHtml}</svg>`;

  // Peer comparison gauge
  const peerPct = peer.percentile;
  const gaugeWidth = 300;
  const needleX = (peerPct / 100) * gaugeWidth;
  const peerGauge = `<div style="margin: 12px 0;">
    <div style="position:relative; width:100%; max-width:${gaugeWidth}px; height:24px; background:linear-gradient(90deg, #22c55e 0%, #22c55e 25%, #3b82f6 25%, #3b82f6 50%, #f59e0b 50%, #f59e0b 75%, #ef4444 75%, #ef4444 100%); border-radius:12px; overflow:hidden;">
      <div style="position:absolute; left:${needleX}px; top:-2px; width:3px; height:28px; background:#0f172a; border-radius:2px;"></div>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-top:4px; max-width:${gaugeWidth}px;">
      <span>Efficient</span><span>Average</span><span>Above Avg</span><span>High</span>
    </div>
    <p style="font-size:14px; color:#334155; margin-top:8px;">
      Your home uses <strong>${peer.annualKwh.toLocaleString()} kWh/year</strong>.
      The median home in your area uses <strong>${peer.medianKwh.toLocaleString()} kWh/year</strong>.
      ${peer.excessKwh > 0
        ? `That's <strong>${peer.excessPct}% above average</strong>.`
        : `That's <strong>below average</strong> — your home is relatively efficient.`}
    </p>
  </div>`;

  // Anomalies
  let anomaliesHtml = '';
  if (anomalies.length > 0) {
    anomaliesHtml = anomalies.map(a => {
      const icon = a.severity === 'high' ? '⚠️' : a.severity === 'moderate' ? '💡' : 'ℹ️';
      const bg = a.severity === 'high' ? '#fef2f2' : a.severity === 'moderate' ? '#fffbeb' : '#f0f9ff';
      const border = a.severity === 'high' ? '#fecaca' : a.severity === 'moderate' ? '#fde68a' : '#bfdbfe';
      return `<div style="padding:12px; background:${bg}; border:1px solid ${border}; border-radius:8px; margin-bottom:8px; font-size:14px; color:#334155;">
        ${icon} ${a.description}
      </div>`;
    }).join('');
  }

  // Recommendations (Phase 2)
  let recsHtml = '';
  if (recs.length > 0) {
    recsHtml = `<div class="card" style="margin-top:16px;">
      <div class="card-title">Recommended Efficiency Upgrades</div>
      <p style="font-size:13px; color:#64748b; margin-bottom:12px;">Based on your home's usage patterns and characteristics. These upgrades could reduce your energy usage and allow a smaller, more cost-effective solar system.</p>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="border-bottom:2px solid #e2e8f0;">
          <th style="text-align:left; padding:8px 4px; color:#64748b;">Upgrade</th>
          <th style="text-align:right; padding:8px 4px; color:#64748b;">Est. Cost</th>
          <th style="text-align:right; padding:8px 4px; color:#64748b;">Xcel Rebate</th>
          <th style="text-align:right; padding:8px 4px; color:#64748b;">Annual Savings</th>
          <th style="text-align:right; padding:8px 4px; color:#64748b;">Payback</th>
        </tr></thead>
        <tbody>
        ${recs.map(r => `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 4px;">
            <strong>${r.measure}</strong>${r.requiresMiniAudit ? ' <span style="font-size:11px; color:#f59e0b;">*confirm with walkthrough</span>' : ''}
            <div style="font-size:12px; color:#94a3b8;">${r.description}</div>
          </td>
          <td style="text-align:right; padding:8px 4px; white-space:nowrap;">$${r.costRange.low.toLocaleString()}-$${r.costRange.high.toLocaleString()}</td>
          <td style="text-align:right; padding:8px 4px; color:#15803d; white-space:nowrap;">${r.xcelRebate > 0 ? `-$${r.xcelRebate}` : '—'}</td>
          <td style="text-align:right; padding:8px 4px; white-space:nowrap;">~$${r.avgSavingsDollars}/yr<div style="font-size:11px; color:#94a3b8;">${r.avgSavingsKwh} kWh</div></td>
          <td style="text-align:right; padding:8px 4px; white-space:nowrap;">${r.simplePaybackYears ? `${r.simplePaybackYears} yrs` : '—'}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    // Solar sizing comparison (if post-upgrade data exists)
    if (postUpgrade && postUpgrade.solarSizingImpact.reductionKw > 0) {
      const impact = postUpgrade.solarSizingImpact;
      recsHtml += `<div class="card" style="margin-top:16px; background:linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%); border:1px solid #bfdbfe;">
        <div class="card-title">Efficiency + Solar: Side-by-Side Comparison</div>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead><tr style="border-bottom:2px solid #e2e8f0;">
            <th style="text-align:left; padding:8px;">Approach</th>
            <th style="text-align:right; padding:8px;">System Size</th>
            <th style="text-align:right; padding:8px;">Solar Cost</th>
            <th style="text-align:right; padding:8px;">Efficiency Cost</th>
            <th style="text-align:right; padding:8px;">Total</th>
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px;">Solar Only</td>
              <td style="text-align:right; padding:8px;">${impact.currentSystemKw} kW</td>
              <td style="text-align:right; padding:8px;">$${(impact.currentSystemKw * 1000 * 2.25).toLocaleString()}</td>
              <td style="text-align:right; padding:8px;">$0</td>
              <td style="text-align:right; padding:8px; font-weight:600;">$${(impact.currentSystemKw * 1000 * 2.25).toLocaleString()}</td>
            </tr>
            <tr style="background:rgba(255,255,255,0.5);">
              <td style="padding:8px; font-weight:600; color:#15803d;">Efficiency + Right-Sized Solar</td>
              <td style="text-align:right; padding:8px; color:#15803d;">${impact.postUpgradeSystemKw} kW</td>
              <td style="text-align:right; padding:8px;">$${(impact.postUpgradeSystemKw * 1000 * 2.25).toLocaleString()}</td>
              <td style="text-align:right; padding:8px;">$${impact.totalEfficiencyCost.toLocaleString()}</td>
              <td style="text-align:right; padding:8px; font-weight:600; color:#15803d;">$${((impact.postUpgradeSystemKw * 1000 * 2.25) + impact.totalEfficiencyCost).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <p style="font-size:13px; color:#334155; margin-top:12px; padding:0 8px;">${impact.narrative}</p>
      </div>`;
    }
  }

  // Usage breakdown
  const breakdownHtml = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0;">
    <div style="padding:14px; background:#f8fafc; border-radius:8px; text-align:center;">
      <div style="font-size:24px; font-weight:700; color:#3b82f6;">${profile.baseloadSharePct}%</div>
      <div style="font-size:13px; color:#64748b;">Always-On (Baseload)</div>
      <div style="font-size:12px; color:#94a3b8;">${profile.baseloadMonthlyKwh} kWh/mo</div>
    </div>
    <div style="padding:14px; background:#f8fafc; border-radius:8px; text-align:center;">
      <div style="font-size:24px; font-weight:700; color:#f59e0b;">${100 - profile.baseloadSharePct}%</div>
      <div style="font-size:13px; color:#64748b;">Weather-Sensitive</div>
      <div style="font-size:12px; color:#94a3b8;">${Math.round(profile.weatherSensitiveKwh / 12)} kWh/mo avg</div>
    </div>
  </div>`;

  return `
  <!-- Home Energy Profile -->
  <div class="card">
    <div class="card-title">
      Your Home Energy Profile
      <span style="float:right; font-size:14px; font-weight:600; color:${scoreColor}; background:${scoreColor}15; padding:4px 12px; border-radius:16px;">
        ${scoreLabel} (${score.score}/100)
      </span>
    </div>

    <div style="font-size:13px; color:#64748b; margin-bottom:4px; font-style:italic;">
      Confidence: ${score.confidence} — ${score.confidenceFactors[0] || ''}
    </div>

    <!-- Peer Comparison -->
    <h4 style="font-size:15px; color:#0f172a; margin:16px 0 4px;">How Your Home Compares</h4>
    ${peerGauge}

    <!-- Usage Breakdown -->
    <h4 style="font-size:15px; color:#0f172a; margin:16px 0 4px;">Where Your Energy Goes</h4>
    ${breakdownHtml}

    <!-- Monthly Usage Pattern -->
    <h4 style="font-size:15px; color:#0f172a; margin:16px 0 4px;">Monthly Usage Pattern</h4>
    <p style="font-size:12px; color:#94a3b8; margin-bottom:8px;">Blue = near baseload, Amber = weather-driven usage above baseline</p>
    ${usageChart}

    <!-- Anomalies -->
    ${anomalies.length > 0 ? `
    <h4 style="font-size:15px; color:#0f172a; margin:16px 0 8px;">What We Found</h4>
    ${anomaliesHtml}
    ` : ''}
  </div>

  ${recsHtml}
  `;
}

module.exports = { generateReport };
