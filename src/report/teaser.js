const { SYSTEM_COST_PER_WATT } = require('../constants');
const { generateHaveSolarTeaser } = require('./haveSolarReport');

/**
 * Generate a teaser HTML snippet shown BEFORE the email gate.
 * This needs to be compelling enough to make them want the full report,
 * but not so complete that they don't need to give their email.
 */
function generateTeaser(mode, result) {
  if (mode === 'have-solar') {
    return generateHaveSolarTeaser(result);
  }
  if (mode === 'proposal' || mode === 'combined') {
    return generateProposalTeaser(result);
  } else {
    return generateBillTeaser(result);
  }
}

function generateProposalTeaser(result) {
  const score = result.score;
  const comp = score.competitor;
  const comparison = score.comparison;
  const priceSavings = comparison.totalPrice.savings;
  const issueCount = score.issues.length;

  const verdictColors = {
    'bad-deal': { bg: '#dc2626', text: 'Bad Deal' },
    'below-average': { bg: '#f59e0b', text: 'Below Average' },
    'average': { bg: '#3b82f6', text: 'Average Deal' },
    'fair': { bg: '#22c55e', text: 'Fair Deal' },
  };
  const v = verdictColors[score.overallVerdict] || verdictColors['average'];

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; text-align: center;">
      <div style="background: ${v.bg}; color: #fff; border-radius: 16px; padding: 32px 24px; margin-bottom: 20px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; margin-bottom: 8px;">Our Verdict on ${comp.name}'s Quote</div>
        <div style="font-size: 36px; font-weight: 700; margin-bottom: 8px;">${v.text}</div>
        <div style="font-size: 16px; opacity: 0.9;">You'd save <strong>$${formatNum(priceSavings, 0)}</strong> with us for the same system</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">${comp.name}</div>
          <div style="font-size: 28px; font-weight: 700; color: #dc2626;">$${formatNum(comparison.totalPrice.theirs, 0)}</div>
          <div style="font-size: 13px; color: #94a3b8;">$${comparison.pricePerWatt.theirs.toFixed(2)}/watt</div>
        </div>
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;">
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Our Price</div>
          <div style="font-size: 28px; font-weight: 700; color: #16a34a;">$${formatNum(comparison.totalPrice.ours, 0)}</div>
          <div style="font-size: 13px; color: #94a3b8;">$${SYSTEM_COST_PER_WATT.toFixed(2)}/watt</div>
        </div>
      </div>

      ${issueCount > 0 ? `<p style="font-size: 14px; color: #64748b; margin-bottom: 4px;">We found <strong style="color: #dc2626;">${issueCount} issue${issueCount > 1 ? 's' : ''}</strong> with this quote.</p>` : ''}
      <p style="font-size: 14px; color: #94a3b8;">Full breakdown, issue details, and our counter-proposal are in the report below.</p>
    </div>
  `;
}

function generateBillTeaser(result) {
  const savings = result.savingsResult;
  const monthlySavings = savings.year1.avgMonthlySavings;
  const annualSavings = savings.year1.annualSavings;
  const monthlyPre = savings.year1.avgMonthlyPreSolar;
  const monthlyPost = savings.year1.avgMonthlyPostSolar;
  const systemKw = savings.system.sizeKw;
  const total25yr = savings.twentyFiveYear.totalSavings;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; text-align: center;">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff; border-radius: 16px; padding: 32px 24px; margin-bottom: 20px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-bottom: 8px;">Your Estimated Savings</div>
        <div style="font-size: 48px; font-weight: 700; color: #4ade80;">$${formatNum(monthlySavings, 0)}/mo</div>
        <div style="font-size: 15px; opacity: 0.85; margin-top: 4px;">$${formatNum(annualSavings, 0)} per year with a ${systemKw} kW system</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Current Bill</div>
          <div style="font-size: 22px; font-weight: 700;">$${formatNum(monthlyPre, 0)}</div>
          <div style="font-size: 12px; color: #94a3b8;">per month</div>
        </div>
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">With Solar</div>
          <div style="font-size: 22px; font-weight: 700; color: #16a34a;">$${formatNum(monthlyPost, 0)}</div>
          <div style="font-size: 12px; color: #94a3b8;">per month</div>
        </div>
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">
          <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">25-Year Total</div>
          <div style="font-size: 22px; font-weight: 700; color: #16a34a;">$${formatNum(total25yr, 0)}</div>
          <div style="font-size: 12px; color: #94a3b8;">savings</div>
        </div>
      </div>

      <p style="font-size: 14px; color: #94a3b8;">Monthly breakdown, system details, and financing options are in the full report.</p>
    </div>
  `;
}

function formatNum(num, decimals = 2) {
  if (num == null || isNaN(num)) return '0';
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

module.exports = { generateTeaser };
