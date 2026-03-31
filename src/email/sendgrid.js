const sgMail = require('@sendgrid/mail');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'reports@utilitybillreview.com';
const FROM_NAME = 'Utility Bill Review';

async function sendReportEmail(email, mode, analysisData) {
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

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="font-size: 24px; color: #0f172a; margin: 0;">Your Energy Analysis is Ready</h1>
        <p style="color: #64748b; margin-top: 8px;">from Utility Bill Review</p>
      </div>

      <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <p style="font-size: 16px; color: #334155; line-height: 1.6; margin: 0;">
          ${highlight || 'Your personalized energy analysis has been completed.'}
        </p>
      </div>

      <div style="text-align: center; margin-bottom: 32px;">
        <a href="https://utilitybillreview.com" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          View Full Report
        </a>
      </div>

      <div style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
        <h3 style="font-size: 16px; color: #0f172a; margin: 0 0 12px;">What's Next?</h3>
        <ul style="color: #475569; line-height: 1.8; padding-left: 20px; margin: 0;">
          <li>Review your full analysis with detailed breakdowns</li>
          <li>Download the Excel report to run your own numbers</li>
          <li>Reply to this email if you have questions — a real person will respond</li>
        </ul>
      </div>

      <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
        <p style="font-size: 12px; color: #94a3b8;">
          Utility Bill Review — Honest energy analysis, no sales pitch.<br>
          <a href="https://utilitybillreview.com" style="color: #64748b;">utilitybillreview.com</a>
        </p>
      </div>
    </div>
  `;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      html,
    });
    console.log(`[email] Report email sent to ${email}`);
  } catch (err) {
    console.error(`[email] Failed to send to ${email}:`, err.message);
  }
}

async function sendFollowUpDay2(email) {
  if (!process.env.SENDGRID_API_KEY) return;

  try {
    await sgMail.send({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject: '3 Things Your Solar Rep Won\'t Tell You',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #0f172a;">3 Things Most Solar Reps Won't Tell You</h2>

          <div style="color: #334155; line-height: 1.8; font-size: 15px;">
            <p><strong>1. The federal tax credit (ITC) expired for residential.</strong><br>
            Section 25D ended December 31, 2025. If someone's quoting you a 30% tax credit, ask them to show you the IRS guidance. The only remaining credit (48E) requires tax equity partnerships — most installers can't access it.</p>

            <p><strong>2. Your $/watt price is the only number that matters.</strong><br>
            Ignore monthly payment comparisons. A $2.50/watt system costs $25,000 for 10kW. A $4.50/watt system costs $45,000. Same panels, same roof, $20,000 difference. Always ask for the cash price per watt.</p>

            <p><strong>3. Most "savings projections" assume 5-6% annual rate increases.</strong><br>
            The national average is closer to 2-3%. Overstating rate escalation makes solar look better than it is. Run the numbers at 3% and see if it still works for you.</p>
          </div>

          <div style="background: #f0fdf4; border-radius: 12px; padding: 20px; margin-top: 24px;">
            <p style="margin: 0; color: #166534; font-size: 15px;">
              <strong>Want an honest second look at your quote?</strong><br>
              Upload it at <a href="https://utilitybillreview.com" style="color: #2563eb;">utilitybillreview.com</a> and we'll grade it for free.
            </p>
          </div>

          <p style="font-size: 12px; color: #94a3b8; margin-top: 32px; text-align: center;">
            Utility Bill Review — Honest energy analysis, no sales pitch.
          </p>
        </div>
      `,
    });
    console.log(`[email] Day 2 follow-up sent to ${email}`);
  } catch (err) {
    console.error(`[email] Day 2 follow-up failed for ${email}:`, err.message);
  }
}

module.exports = { sendReportEmail, sendFollowUpDay2 };
