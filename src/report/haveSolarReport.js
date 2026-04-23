/**
 * HTML report for have-solar mode — owners who already went solar and want to
 * see what they're actually saving.
 */

function fmt(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${fmt(Math.abs(n), digits)}`;
}

function pct(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  return `${fmt(n, digits)}%`;
}

function verdictCard(actualSavings) {
  const perf = actualSavings.production.performanceRatio;
  const annual = actualSavings.economics.annualSavings;

  let title, color, subtitle;

  if (perf != null && perf < 0.80) {
    title = 'Your system is underperforming';
    color = '#dc2626';
    subtitle = `Producing ${pct(perf * 100, 0)} of what it should. That's a problem worth chasing down.`;
  } else if (perf != null && perf < 0.92) {
    title = 'Slightly below expected';
    color = '#f59e0b';
    subtitle = `Producing ${pct(perf * 100, 0)} of expected — on the edge. Watch another month before acting.`;
  } else if (annual > 0) {
    title = 'Your solar is delivering';
    color = '#16a34a';
    subtitle = `You're saving roughly ${money(annual)} per year on electricity${perf != null ? ` and producing ${pct(perf * 100, 0)} of expected` : ''}.`;
  } else {
    title = 'Analysis complete';
    color = '#0f172a';
    subtitle = 'Full details below.';
  }

  return `
    <div style="background:${color};color:#fff;border-radius:16px;padding:32px 28px;margin-bottom:24px;">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.8;margin-bottom:6px;">Your Solar Reality Check</div>
      <div style="font-size:28px;font-weight:700;margin-bottom:6px;">${title}</div>
      <div style="font-size:15px;opacity:0.95;">${subtitle}</div>
    </div>
  `;
}

function statsGrid(actualSavings) {
  const e = actualSavings.economics;
  const p = actualSavings.production;
  const years = actualSavings.inputs.yearsSinceInstall;

  const statCard = (label, value, sub) => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${label}</div>
      <div style="font-size:26px;font-weight:700;color:#0f172a;">${value}</div>
      ${sub ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px;">${sub}</div>` : ''}
    </div>
  `;

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px;">
      ${statCard('Annual savings', money(e.annualSavings), `${money(e.monthlySavings)}/mo`)}
      ${statCard('Since install', e.lifetimeSavings != null ? money(e.lifetimeSavings) : '—', years ? `~${years.toFixed(1)} yrs` : '')}
      ${statCard('Actual production', `${fmt(p.annualProducedKwh)} kWh`, 'last 12 months')}
      ${statCard('Expected production', `${fmt(p.expectedAnnualKwh)} kWh`, p.degradationApplied ? `after ${pct(p.degradationApplied * 100, 1)} age derate` : '')}
    </div>
  `;
}

function breakdownTable(actualSavings, billData, currentRates) {
  const e = actualSavings.economics;
  const p = actualSavings.production;
  const i = actualSavings.inputs;
  const utility = billData?.utilityName || 'your utility';

  const rows = [
    ['Current utility rate', `${(e.rate * 100).toFixed(1)}¢/kWh`, `from your ${utility} bill`],
    ['Estimated grid imports (12 mo)', `${fmt(p.expectedAnnualKwh ? (p.expectedAnnualKwh - p.selfConsumedKwh) : 0)} kWh`, 'net kWh you pulled from the grid'],
    ['Solar self-consumed', `${fmt(p.selfConsumedKwh)} kWh`, p.exportedKwh > 0 ? 'derived from export data' : 'estimated at 40% of production'],
    ['Solar exported to grid', `${fmt(p.exportedKwh)} kWh`, p.exportedKwh > 0 ? '' : 'no export figure in the monitoring data'],
    ['Counterfactual bill (no solar)', money(e.counterfactualAnnualCost), 'what you would have paid without solar'],
    ['Actual bill paid', money(e.actualAnnualCost), 'annualized from uploaded bill'],
    ...(i.ownershipType === 'tpo' ? [['PPA / lease payment', money(e.ppaAnnualPayment), `at ${(i.ppaRatePerKwh || 0).toFixed(4)} $/kWh on produced`]] : []),
    ['Annual savings', money(e.annualSavings), '= counterfactual − actual bill' + (i.ownershipType === 'tpo' ? ' − PPA' : '')],
  ];

  return `
    <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:24px 0 12px;">How the math works</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${rows.map(([l, v, s]) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:10px 12px;color:#64748b;">${l}</td>
          <td style="padding:10px 12px;font-weight:600;color:#0f172a;text-align:right;white-space:nowrap;">${v}</td>
          <td style="padding:10px 12px;color:#94a3b8;font-size:12px;">${s}</td>
        </tr>
      `).join('')}
    </table>
    <p style="font-size:12px;color:#94a3b8;margin-top:8px;">Note: self-consumption is estimated when your monitoring doesn't break out exports. The error band is roughly ±15% on annual savings — directionally reliable, not a legal document.</p>
  `;
}

function flagsSection(flags) {
  if (!flags || flags.length === 0) return '';
  return `
    <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:24px 0 12px;">What we noticed</h2>
    ${flags.map((f) => `
      <div style="background:${f.severity === 'high' ? '#fef2f2' : '#fffbeb'};border-left:4px solid ${f.severity === 'high' ? '#dc2626' : '#f59e0b'};border-radius:8px;padding:16px 20px;margin-bottom:12px;">
        <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">${f.label}</div>
        <div style="font-size:14px;color:#475569;">${f.detail}</div>
      </div>
    `).join('')}
  `;
}

function promisedVsRealitySection(pvr) {
  if (!pvr || (!pvr.kwh && !pvr.annualSavings)) return '';

  const row = (label, entry, formatter) => {
    if (!entry) return '';
    const verdictColor = entry.verdict === 'meeting-or-exceeding' ? '#16a34a' : '#dc2626';
    const verdictText = entry.verdict === 'meeting-or-exceeding' ? 'Meeting promise' : 'Below promise';
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:14px 0;border-bottom:1px solid #f1f5f9;">
        <div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">${label}</div>
          <div style="font-size:12px;color:#94a3b8;">promised → actual</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:16px;font-weight:600;color:#94a3b8;">${formatter(entry.promised)}</div>
          <div style="font-size:20px;font-weight:700;color:#0f172a;">${formatter(entry.actual)}</div>
        </div>
        <div style="text-align:right;">
          <span style="display:inline-block;background:${verdictColor};color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;">${verdictText}</span>
          ${entry.deltaPct != null ? `<div style="font-size:12px;color:${verdictColor};margin-top:4px;">${entry.deltaPct > 0 ? '+' : ''}${entry.deltaPct}%</div>` : ''}
        </div>
      </div>
    `;
  };

  return `
    <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:24px 0 12px;">
      Promised vs reality
      ${pvr.installer ? `<span style="font-size:13px;font-weight:400;color:#94a3b8;"> — ${pvr.installer}</span>` : ''}
    </h2>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:0 20px;">
      ${row('Annual production', pvr.kwh, (n) => `${fmt(n)} kWh`)}
      ${row('Year-1 savings', pvr.annualSavings, money)}
    </div>
  `;
}

function guaranteeSection(evaluation, claim) {
  if (!evaluation) return '';

  if (!evaluation.eligible) {
    const reasonCopy = {
      'no-proposal': null,
      'no-guarantee-in-proposal': `Your original proposal didn't appear to include a production guarantee. If you believe that's wrong, check the contract carefully — the guarantee language is often buried in an appendix.`,
      'no-estimated-annual-kwh': `We couldn't find a clear estimated annual production figure in the proposal, so we can't run a guarantee check.`,
      'no-actual-production-data': `We need clearer production data to run the guarantee check. Try uploading a 12-month production PDF from your monitoring app.`,
      'meeting-guarantee': `Good news: your system is producing above the ${evaluation.thresholdPct}% guarantee threshold (${fmt(evaluation.thresholdKwh)} kWh). No claim is warranted.`,
    };
    const copy = reasonCopy[evaluation.reason];
    if (!copy) return '';
    return `
      <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:24px 0 12px;">Performance guarantee check</h2>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;font-size:14px;color:#475569;">${copy}</div>
    `;
  }

  return `
    <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:24px 0 12px;">You may have a guarantee claim</h2>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-weight:700;color:#991b1b;margin-bottom:8px;font-size:16px;">
        Shortfall: ${fmt(evaluation.shortfallKwh)} kWh — approximately ${money(evaluation.estimatedReimbursementDollars)} owed
      </div>
      <div style="font-size:14px;color:#7f1d1d;line-height:1.6;">
        Your proposal guarantees at least ${evaluation.thresholdPct}% of the estimated annual production
        (${fmt(evaluation.thresholdKwh)} kWh). Your system is producing ${fmt(evaluation.actualAnnualKwh)} kWh —
        a shortfall of ${fmt(evaluation.shortfallKwh)} kWh at a retail rate of approximately
        $${evaluation.assumedRate.toFixed(4)}/kWh.
      </div>
    </div>

    ${claim ? `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
        <div style="font-weight:700;color:#0f172a;margin-bottom:12px;">Draft claim letter</div>
        <pre id="claim-letter" style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;color:#334155;max-height:400px;overflow-y:auto;">${escapeHtml(claim.body)}</pre>
        <button type="button" onclick="(function(){const el=document.getElementById('claim-letter');navigator.clipboard.writeText(el.textContent).then(()=>{event.target.textContent='Copied ✓';setTimeout(()=>event.target.textContent='Copy claim letter',2000)})})()" style="margin-top:12px;background:#0f172a;color:#fff;border:0;padding:10px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Copy claim letter</button>

        <div style="margin-top:20px;font-size:13px;color:#475569;">
          <div style="font-weight:600;color:#0f172a;margin-bottom:8px;">Claim checklist</div>
          <ul style="padding-left:20px;line-height:1.8;">
            ${claim.checklist.map((c) => `<li>${c}</li>`).join('')}
          </ul>
        </div>
      </div>
    ` : ''}
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateHaveSolarReport({
  billData,
  productionData,
  proposalData,
  currentRates,
  actualSavings,
  promisedVsReality,
  guaranteeEvaluation,
  claimLetter,
}) {
  return `
    <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#0f172a;">
      ${verdictCard(actualSavings)}
      ${statsGrid(actualSavings)}
      ${flagsSection(actualSavings.flags)}
      ${promisedVsRealitySection(promisedVsReality)}
      ${guaranteeSection(guaranteeEvaluation, claimLetter)}
      ${breakdownTable(actualSavings, billData, currentRates)}
      <div style="margin-top:32px;padding:16px 20px;background:#f8fafc;border-radius:10px;font-size:13px;color:#64748b;line-height:1.6;">
        <strong style="color:#0f172a;">How we calculated this.</strong>
        We compared the kWh on your utility bill(s) to the kWh your system actually produced
        (from your monitoring app), valued the difference at your current utility rate,
        and subtracted any PPA/lease payments. We used NREL's PVWatts model for expected
        production and applied 0.5%/yr panel degradation from your install year.
        The more bills you upload, the tighter the analysis.
      </div>
    </div>
  `;
}

function generateHaveSolarTeaser(result) {
  const e = result.actualSavings.economics;
  const p = result.actualSavings.production;
  const annual = e.annualSavings;
  const perf = p.performanceRatio;
  const lifetime = e.lifetimeSavings;

  const headline = annual > 0
    ? `${money(annual)}/yr`
    : perf != null
      ? `${pct(perf * 100, 0)} of expected`
      : 'Analysis ready';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:500px;margin:0 auto;text-align:center;">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:16px;padding:32px 24px;margin-bottom:20px;">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.7;margin-bottom:8px;">Your Solar Savings, So Far</div>
        <div style="font-size:42px;font-weight:700;color:#4ade80;">${headline}</div>
        ${lifetime != null ? `<div style="font-size:15px;opacity:0.85;margin-top:4px;">${money(lifetime)} saved since install</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Actual production</div>
          <div style="font-size:22px;font-weight:700;">${fmt(p.annualProducedKwh)} kWh</div>
          <div style="font-size:12px;color:#94a3b8;">last 12 months</div>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">vs expected</div>
          <div style="font-size:22px;font-weight:700;color:${perf >= 0.92 ? '#16a34a' : perf >= 0.80 ? '#f59e0b' : '#dc2626'};">${perf != null ? pct(perf * 100, 0) : '—'}</div>
          <div style="font-size:12px;color:#94a3b8;">of what it should produce</div>
        </div>
      </div>
      <p style="font-size:14px;color:#94a3b8;">Full breakdown, promised-vs-reality, and any guarantee claim details are in the report.</p>
    </div>
  `;
}

module.exports = { generateHaveSolarReport, generateHaveSolarTeaser };
