const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'your@utilitybillreview.com';
const FROM_NAME = 'Utility Bill Review';
const BASE_URL = process.env.BASE_URL || 'https://www.utilitybillreview.com';

function unsubLink(token) {
  return `${BASE_URL}/unsubscribe/${token}`;
}

function reportLink(token) {
  return `${BASE_URL}/report/${token}`;
}

function footer(token) {
  return `
    <div style="margin-top: 32px; padding-top: 20px; border-top: 2px solid #1C1C1A; text-align: center;">
      <p style="font-size: 12px; color: #9A9A92;">
        Utility Bill Review — Honest energy analysis, no sales pitch.<br>
        <a href="${BASE_URL}" style="color: #7A7A72;">utilitybillreview.com</a>
      </p>
      <p style="font-size: 11px; color: #B0B0A8; margin-top: 8px;">
        <a href="${unsubLink(token)}" style="color: #B0B0A8;">Unsubscribe</a>
      </p>
    </div>
  `;
}

function emailWrapper(content, token) {
  return `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #FAFAF7;">
      ${content}
      ${footer(token)}
    </div>
  `;
}

// ── Email 1: Immediate report delivery ──────────────────────────────

async function sendReportEmail(email, mode, analysisData, token) {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('[email] SendGrid not configured, skipping email to', email);
    return;
  }

  const subject = mode === 'proposal'
    ? 'Your Solar Quote Analysis is Ready'
    : mode === 'combined'
    ? 'Your Bill + Quote Analysis is Ready'
    : 'Your Energy Savings Report is Ready';

  const savings = analysisData?.savingsResult;
  const score = analysisData?.score;

  let highlight = '';
  if (savings) {
    const monthly = Math.round(savings.year1?.avgMonthlySavings || 0);
    const total25 = Math.round(savings.twentyFiveYear?.totalSavings || 0);
    highlight = `Based on our analysis, you could save approximately <strong>$${monthly}/month</strong> — that's <strong>$${total25.toLocaleString()}</strong> over 25 years.`;
  } else if (score) {
    const verdict = score.overallVerdict?.replace(/-/g, ' ') || 'under review';
    highlight = `Our verdict on your solar quote: <strong>${verdict}</strong>. We found ${score.issues?.length || 0} issue(s) worth reviewing.`;
  }

  const content = `
    <div style="text-align: center; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #1C1C1A;">
      <h1 style="font-family: Georgia, 'DM Serif Display', serif; font-size: 24px; color: #1C1C1A; margin: 0; font-weight: 400;">Your Energy Analysis is Ready</h1>
      <p style="color: #7A7A72; margin-top: 8px; font-size: 14px;">from Utility Bill Review</p>
    </div>

    <div style="background: #FFFFFF; border: 1px solid #E8E6E1; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
      <p style="font-size: 16px; color: #3D3D3A; line-height: 1.6; margin: 0;">
        ${highlight || 'Your personalized energy analysis has been completed.'}
      </p>
    </div>

    <div style="text-align: center; margin-bottom: 32px;">
      <a href="${reportLink(token)}" style="display: inline-block; background: #D97706; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View Full Report
      </a>
    </div>

    <div style="border-top: 1px solid #E8E6E1; padding-top: 20px;">
      <h3 style="font-family: Georgia, 'DM Serif Display', serif; font-size: 16px; color: #1C1C1A; margin: 0 0 12px; font-weight: 400;">What's Next?</h3>
      <ul style="color: #3D3D3A; line-height: 1.8; padding-left: 20px; margin: 0; font-size: 15px;">
        <li>Review your full analysis with detailed breakdowns</li>
        <li>Download the Excel report to run your own numbers</li>
        <li>Reply to this email if you have questions — a real person will respond</li>
      </ul>
    </div>
  `;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html: emailWrapper(content, token),
    });
    console.log(`[email] Report email sent to ${email}`);
  } catch (err) {
    console.error(`[email] Failed to send to ${email}:`, err.message);
  }
}

// ── Email 2 (Day 2): Educational — 3 things your solar rep won't tell you ──

async function sendDay2Educational(email, token, grade) {
  if (!process.env.SENDGRID_API_KEY) return;

  const gradeIntro = grade === 'fair' || grade === 'good'
    ? `Your analysis came back looking reasonable — that's great. But before you sign, here are three things worth knowing:`
    : grade === 'bad-deal' || grade === 'below-average'
    ? `Your analysis flagged some concerns with your quote. Here's some context that might help as you evaluate your options:`
    : `Whether your quote came back strong or weak, these three points are worth knowing before you make a decision:`;

  const content = `
    <div style="padding-bottom: 16px; border-bottom: 2px solid #1C1C1A; margin-bottom: 24px;">
      <h2 style="font-family: Georgia, 'DM Serif Display', serif; color: #1C1C1A; font-weight: 400; margin: 0;">3 Things Most Solar Reps Won't Tell You</h2>
    </div>

    <p style="font-size: 15px; color: #3D3D3A; line-height: 1.6; margin-bottom: 16px;">${gradeIntro}</p>

    <div style="color: #3D3D3A; line-height: 1.8; font-size: 15px;">
      <p><strong>1. The federal tax credit (ITC) expired for residential.</strong><br>
      Section 25D ended December 31, 2025. If someone's quoting you a 30% tax credit, ask them to show you the IRS guidance.</p>

      <p><strong>2. Your $/watt price is the only number that matters.</strong><br>
      A $2.50/watt system costs $25,000 for 10kW. A $4.50/watt system costs $45,000. Same panels, same roof, $20,000 difference. Always ask for the cash price per watt.</p>

      <p><strong>3. Most "savings projections" assume 5-6% annual rate increases.</strong><br>
      The national average is closer to 2-3%. Overstating rate escalation makes solar look better than it is.</p>
    </div>

    <div style="background: #FFFFFF; border: 1px solid #E8E6E1; border-left: 4px solid #D97706; border-radius: 8px; padding: 20px; margin-top: 24px;">
      <p style="margin: 0; color: #3D3D3A; font-size: 15px;">
        <strong>Your report is still available.</strong><br>
        <a href="${reportLink(token)}" style="color: #D97706;">View your full analysis</a>
      </p>
    </div>
  `;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: '3 Things Your Solar Rep Won\'t Tell You',
      html: emailWrapper(content, token),
    });
    console.log(`[email] Day 2 follow-up sent to ${email}`);
  } catch (err) {
    console.error(`[email] Day 2 follow-up failed for ${email}:`, err.message);
  }
}

// ── Email 3 (Day 5): Negotiation help / next steps based on grade ──

async function sendDay5Negotiation(email, token, grade, city, systemSizeKw) {
  if (!process.env.SENDGRID_API_KEY) return;

  const sizeKw = systemSizeKw || 8;
  const fairLow = (sizeKw * 1000 * 2.70).toLocaleString();
  const fairHigh = (sizeKw * 1000 * 3.30).toLocaleString();

  let subject, bodyContent;

  if (grade === 'bad-deal' || grade === 'below-average') {
    subject = 'Your negotiation script (based on your analysis)';
    bodyContent = `
      <p>Your analysis showed some room for improvement on pricing. Here's exactly what to say to your installer:</p>

      <div style="background: #FFFFFF; border: 1px solid #E8E6E1; border-radius: 8px; padding: 20px; margin: 16px 0;">
        <p style="font-style: italic; color: #3D3D3A; margin: 0; line-height: 1.8;">
          "I've been doing some research and based on current Colorado pricing for a ${sizeKw}kW system,
          a fair installed price is between <strong>$${fairLow} and $${fairHigh}</strong>.
          Can you help me understand why your quote is higher than that range?"
        </p>
      </div>

      <p>This isn't confrontational — it's informed. Most reps will either explain the difference or come back with a better number.</p>

      <p>If you'd like to compare with local Colorado installers, reply to this email and we can connect you with a couple vetted options.</p>
    `;
  } else {
    subject = 'Your solar checklist — before you sign';
    bodyContent = `
      <p>Your analysis looked solid. Before you finalize, here's a quick checklist:</p>

      <div style="color: #3D3D3A; font-size: 15px; line-height: 2;">
        <p>&#9744; <strong>Confirm the $/watt price</strong> matches what was quoted (not just monthly payment)<br>
        &#9744; <strong>Ask about the production guarantee</strong> — what happens if panels underperform?<br>
        &#9744; <strong>Verify the escalator rate</strong> — if it's a PPA or lease, what's the annual increase?<br>
        &#9744; <strong>Check the warranty</strong> — panels (25yr), inverter (12-25yr), workmanship (10yr minimum)<br>
        &#9744; <strong>Get the net metering details</strong> — confirm they're using SB 23-258 credit rates, not old retail rates</p>
      </div>

      <p>Everything check out? Then you're good to go. Congrats on making a data-driven decision.</p>
    `;
  }

  const content = `
    <div style="padding-bottom: 16px; border-bottom: 2px solid #1C1C1A; margin-bottom: 24px;">
      <h2 style="font-family: Georgia, 'DM Serif Display', serif; color: #1C1C1A; font-weight: 400; margin: 0;">${grade === 'bad-deal' || grade === 'below-average' ? 'Your Negotiation Script' : 'Before You Sign'}</h2>
    </div>

    <div style="color: #3D3D3A; line-height: 1.8; font-size: 15px;">
      ${bodyContent}
    </div>
  `;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html: emailWrapper(content, token),
    });
    console.log(`[email] Day 5 email sent to ${email} (grade: ${grade})`);
  } catch (err) {
    console.error(`[email] Day 5 email failed for ${email}:`, err.message);
  }
}

// ── Email 4 (Day 21): Check-in + referral ask ──────────────────────

async function sendDay21Referral(email, token) {
  if (!process.env.SENDGRID_API_KEY) return;

  const content = `
    <div style="padding-bottom: 16px; border-bottom: 2px solid #1C1C1A; margin-bottom: 24px;">
      <h2 style="font-family: Georgia, 'DM Serif Display', serif; color: #1C1C1A; font-weight: 400; margin: 0;">Quick Check-In</h2>
    </div>

    <div style="color: #3D3D3A; line-height: 1.8; font-size: 15px;">
      <p>It's been a few weeks since your solar analysis. Just curious — how'd it go?</p>

      <p>If you went solar: congrats! We'd love to hear about your experience.<br>
      If you're still deciding: your <a href="${reportLink(token)}" style="color: #D97706;">full report</a> is still available.<br>
      If you decided to wait: that's smart too. The math should work on its own without pressure.</p>

      <div style="background: #FFFFFF; border: 1px solid #E8E6E1; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #1C1C1A;">Know someone considering solar?</p>
        <p style="margin: 0; color: #5A5A52; font-size: 14px;">
          Forward this email or send them to
          <a href="${BASE_URL}" style="color: #D97706;">utilitybillreview.com</a>.
          Same free analysis, no strings attached.
        </p>
      </div>

      <p>Either way — reply anytime. A real person reads these.</p>
      <p style="color: #7A7A72;">— Kevin, Utility Bill Review</p>
    </div>
  `;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: 'How did your solar decision go?',
      html: emailWrapper(content, token),
    });
    console.log(`[email] Day 21 referral email sent to ${email}`);
  } catch (err) {
    console.error(`[email] Day 21 email failed for ${email}:`, err.message);
  }
}

module.exports = {
  sendReportEmail,
  sendDay2Educational,
  sendDay5Negotiation,
  sendDay21Referral,
};
