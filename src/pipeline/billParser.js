const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS } = require('../constants');

const client = new Anthropic();

const EXTRACTION_PROMPT = `You are analyzing a residential electric utility bill. This could be from ANY U.S. utility company (Xcel Energy, ComEd, Duke Energy, FPL, APS, PG&E, etc.). Extract ALL data precisely and return it as JSON.

Read every number exactly as printed — meter readings, rates per kWh, dollar amounts. Do not round or estimate.

Return this exact JSON structure:
{
  "customer": {
    "name": "",
    "address": "",
    "city": "",
    "state": "",
    "zip": ""
  },
  "account": {
    "number": "",
    "meterNumber": ""
  },
  "servicePeriod": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD",
    "days": 0
  },
  "meterReadings": {
    "previous": 0,
    "present": 0,
    "totalUsageKwh": 0,
    "multiplier": 1
  },
  "charges": {
    "supply": {
      "total": 0,
      "lineItems": [
        { "name": "", "rate": 0, "kwh": 0, "amount": 0 }
      ]
    },
    "delivery": {
      "total": 0,
      "fixedCharges": [
        { "name": "", "amount": 0 }
      ],
      "variableCharges": [
        { "name": "", "rate": 0, "kwh": 0, "amount": 0 }
      ]
    },
    "taxesAndFees": {
      "total": 0,
      "lineItems": [
        { "name": "", "amount": 0 }
      ]
    }
  },
  "totalAmountDue": 0,
  "averageDailyUseKwh": 0,
  "usageHistory": [
    { "month": "Aug", "year": 2024, "kWh": 0 }
  ],
  "utilityName": "",
  "rateClass": ""
}

Important:
- Identify the utility company name and put it in "utilityName"
- "rate" fields should be in dollars per kWh (e.g., 0.08261 not 8.261)
- "amount" fields should be in dollars (e.g., 324.77)
- totalUsageKwh is the actual monthly consumption in kWh
- Different utilities structure charges differently. Map them as best you can:
  * "supply" = generation / energy charges (the commodity cost of electricity)
  * "delivery" = distribution / transmission charges (getting it to your home)
  * "fixedCharges" = customer charges, service fees, minimum charges — anything that doesn't vary with kWh
  * "variableCharges" = per-kWh delivery/distribution charges
  * "taxesAndFees" = taxes, surcharges, regulatory fees
  * If the bill doesn't clearly separate supply and delivery, put all per-kWh charges under supply and fixed charges under delivery.fixedCharges
- Include ALL line items visible on the bill, even small ones
- IMPORTANT: Many bills contain a bar chart or graph showing monthly usage history (12-13 months). If present, read each bar carefully:
  * Each bar represents usage for the month whose label appears directly BELOW or BESIDE that specific bar
  * Read the Y-axis scale carefully to determine the kWh value for each bar
  * The most recent bar should roughly match the totalUsageKwh — use this as a calibration check
  * Include ALL months in "usageHistory", ordered chronologically from oldest to newest
  * Use 3-letter month abbreviations (Jan, Feb, Mar, etc) and include the correct year
  * If no usage history chart is present, just include the current month's data
- Return ONLY valid JSON, no markdown fences or other text`;

async function parseBill(pdfPath, signal) {
  const pdfBuffer = await fs.readFile(pdfPath);
  const base64Pdf = pdfBuffer.toString('base64');

  console.log('[billParser] Sending PDF to Claude for extraction...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  // Link external abort signal (client disconnect) to our internal controller
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new Error('Bill parsing aborted: client disconnected');
    }
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const response = await client.messages.create(
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
                text: EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );

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
    if (!result.meterReadings?.totalUsageKwh || result.meterReadings.totalUsageKwh <= 0) {
      throw new Error('Could not extract valid usage data from bill');
    }
    if (!result.customer?.address) {
      throw new Error('Could not extract customer address from bill');
    }

    const historyCount = result.usageHistory?.length || 0;
    console.log(`[billParser] Extracted: ${result.meterReadings.totalUsageKwh} kWh, $${result.totalAmountDue} total, ${historyCount} months of usage history`);
    return result;
  } catch (err) {
    if (signal?.aborted) {
      throw new Error('Bill parsing aborted: client disconnected');
    }
    throw new Error(`Bill parsing failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

module.exports = { parseBill };
