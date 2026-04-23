const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS } = require('../constants');

const client = new Anthropic();

const PROPOSAL_EXTRACTION_PROMPT = `You are analyzing a residential solar proposal or quote from a solar installer. This could be a glossy marketing proposal, a contract, an informal quote, or a screenshot of a pricing page.

Extract ALL relevant data and return it as JSON. If a field isn't visible or can't be determined, use null.

Return this exact JSON structure:
{
  "installer": {
    "name": "",
    "address": "",
    "phone": "",
    "website": ""
  },
  "customer": {
    "name": "",
    "address": "",
    "city": "",
    "state": "",
    "zip": ""
  },
  "system": {
    "sizeKw": 0,
    "panelCount": 0,
    "panelType": "",
    "panelWattage": 0,
    "inverterType": "",
    "inverterBrand": "",
    "batteryIncluded": false,
    "batteryType": "",
    "batteryCapacityKwh": 0,
    "batteryCount": 0
  },
  "pricing": {
    "totalPrice": 0,
    "pricePerWatt": 0,
    "priceBeforeIncentives": 0,
    "priceAfterIncentives": 0,
    "federalITCAmount": 0,
    "federalITCPercent": 0,
    "stateIncentives": 0,
    "otherIncentives": [],
    "dealerFee": 0,
    "dealerFeePercent": 0
  },
  "financing": {
    "type": "",
    "loanRate": 0,
    "loanTerm": 0,
    "monthlyPayment": 0,
    "leaseMonthly": 0,
    "ppaRatePerKwh": 0,
    "escalatorPercent": 0,
    "downPayment": 0
  },
  "production": {
    "estimatedAnnualKwh": 0,
    "estimatedOffsetPercent": 0,
    "estimatedYear1Savings": 0,
    "estimatedMonthlyBillAfter": 0,
    "estimated25YearSavings": 0
  },
  "warranty": {
    "panelYears": 0,
    "inverterYears": 0,
    "workmanshipYears": 0,
    "productionGuarantee": false,
    "productionGuaranteePercent": 0
  },
  "redFlags": [],
  "notes": ""
}

Important extraction rules:
- "type" in financing should be one of: "cash", "loan", "lease", "ppa", or "multiple" if several options are shown. If multiple options, extract the PRIMARY or highlighted option.
- "pricePerWatt": Calculate this yourself if not shown. totalPrice / (sizeKw * 1000). If price is shown both before and after incentives, use the BEFORE incentives number for this calculation.
- "federalITCPercent": Usually 30%. If the proposal shows an ITC credit, extract the percentage and dollar amount.
- "dealerFee": Some loan proposals include a hidden dealer fee (also called "origination fee" or "finance charge"). If the financed amount is higher than the cash price, the difference is likely a dealer fee.
- "escalatorPercent": For leases and PPAs, this is the annual price increase (e.g., 2.9% means the payment goes up 2.9% every year).
- "redFlags": List any concerning items you notice, such as:
  * Price per watt above $4.00 (significantly overpriced)
  * Escalator above 2.5% on lease/PPA
  * ITC shown at 30% (expired for homeowner-owned systems after 2025)
  * Production estimates that seem unrealistically high
  * Missing workmanship warranty
  * Very long contract term (>25 years)
  * Unusual fees or charges
  * System appears undersized or oversized vs stated offset
- "notes": Any other relevant information from the proposal that doesn't fit the structured fields.
- Return ONLY valid JSON, no markdown fences or other text`;

async function parseProposal(pdfPath, signal) {
  const pdfBuffer = await fs.readFile(pdfPath);
  const base64Pdf = pdfBuffer.toString('base64');

  console.log('[proposalParser] Sending proposal PDF to Claude for extraction...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new Error('Proposal parsing aborted: client disconnected');
    }
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    let response;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 4096,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: base64Pdf,
                    },
                  },
                  {
                    type: 'text',
                    text: PROPOSAL_EXTRACTION_PROMPT,
                  },
                ],
              },
            ],
          },
          { signal: controller.signal }
        );
        break;
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.response?.status;
        const transient = status === 429 || (status >= 500 && status < 600) || /overloaded|internal server|timeout/i.test(err?.message || '');
        if (!transient || attempt === 3 || controller.signal.aborted) throw err;
        const delayMs = 500 * Math.pow(2, attempt - 1);
        console.warn(`[proposalParser] Transient error (attempt ${attempt}/3, status=${status}); retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (!response) throw lastErr || new Error('Proposal parsing failed after retries');

    const textBlock = response.content.filter((b) => b.type === 'text').pop();
    if (!textBlock) throw new Error('No text block in Claude response');

    const raw = textBlock.text.trim();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
      result = JSON.parse(stripped);
    }

    // Basic validation
    if (!result.system?.sizeKw && !result.pricing?.totalPrice) {
      throw new Error('Could not extract system size or pricing from proposal');
    }

    // Calculate price per watt if not extracted
    if (!result.pricing.pricePerWatt && result.pricing.totalPrice && result.system.sizeKw) {
      result.pricing.pricePerWatt = result.pricing.totalPrice / (result.system.sizeKw * 1000);
    }
    // Use priceBeforeIncentives for $/W if available
    if (result.pricing.priceBeforeIncentives && result.system.sizeKw) {
      result.pricing.pricePerWatt = result.pricing.priceBeforeIncentives / (result.system.sizeKw * 1000);
    }

    console.log(`[proposalParser] Extracted: ${result.system.sizeKw} kW system, $${result.pricing.totalPrice} total, ${result.installer?.name || 'Unknown installer'}`);
    return result;
  } catch (err) {
    if (signal?.aborted) {
      throw new Error('Proposal parsing aborted: client disconnected');
    }
    throw new Error(`Proposal parsing failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

module.exports = { parseProposal };
