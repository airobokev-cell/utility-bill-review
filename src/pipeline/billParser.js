const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS } = require('../constants');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const client = new Anthropic();

const EXTRACTION_PROMPT = `You are analyzing a utility bill to extract ELECTRICITY usage data. This could be from ANY U.S. utility company (Xcel Energy, ComEd, Duke Energy, FPL, APS, PG&E, etc.) and may be residential OR commercial. Extract ALL data precisely and return it as JSON.

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
    "multiplier": 1,
    "isNewMeter": false,
    "onPeakKwh": 0,
    "offPeakKwh": 0,
    "demandKw": 0
  },
  "charges": {
    "electricityTotal": 0,
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
  "rateClass": "",
  "isCommercial": false,
  "hasGasService": false,
  "gasChargesTotal": 0
}

Important:
- Identify the utility company name and put it in "utilityName"
- Extract the rate class/schedule exactly as shown (e.g., "Residential R", "CTOU Com Energy TOU", "CSG Commercial")
- Set "isCommercial" to true if the rate class is commercial, industrial, or non-residential
- "rate" fields should be in dollars per kWh (e.g., 0.08261 not 8.261)
- "amount" fields should be in dollars (e.g., 324.77)
- totalUsageKwh is the actual monthly ELECTRICITY consumption in kWh
- "electricityTotal" is the total electricity charges only (NOT gas, NOT the full bill total)
- If the bill includes BOTH electric and gas service, set "hasGasService" to true and put the gas total in "gasChargesTotal". But all other fields should be ELECTRICITY ONLY.

CRITICAL — Electricity vs Gas separation:
- Many bills (especially Xcel Energy) include BOTH electricity and natural gas on the same bill
- ONLY extract ELECTRICITY data for the main fields (kWh, charges, meter readings)
- Do NOT confuse natural gas therms/ccf with electricity kWh
- Do NOT confuse a "Monthly Natural Gas Usage" bar chart with electricity usage history
- If the bill has separate "Electricity Service Details" and "Natural Gas Service Details" sections, only use the electricity section for meter readings and charges
- The "totalAmountDue" should be the FULL bill amount (electric + gas), but "electricityTotal" should be electricity only

Meter reading details:
- If the previous meter reading is 0 and the bill mentions a "new meter", set "isNewMeter" to true
- If the meter shows On-Peak and Off-Peak readings separately (TOU meter), include those in "onPeakKwh" and "offPeakKwh"
- If the bill shows demand (kW), include it in "demandKw"
- totalUsageKwh should be the total of all energy tiers (on-peak + off-peak, or just total if not TOU)

Rate structure:
- Different utilities structure charges differently. Map them as best you can:
  * "supply" = generation / energy charges (the commodity cost of electricity)
  * "delivery" = distribution / transmission charges (getting it to your home)
  * "fixedCharges" = customer charges, service fees, minimum charges — anything that doesn't vary with kWh
  * "variableCharges" = per-kWh delivery/distribution charges
  * "taxesAndFees" = taxes, surcharges, regulatory fees, franchise fees, climate tax, etc.
  * If the bill doesn't clearly separate supply and delivery, put all per-kWh charges under supply and fixed charges under delivery.fixedCharges
- Include ALL electricity line items visible on the bill, even small ones
- For TOU rates: include on-peak and off-peak as separate supply line items with their respective rates

CRITICAL — Usage History extraction:
- Many bills contain a bar chart or graph showing monthly ELECTRICITY usage history (12-13 months). If present, read each bar carefully:
  * Make sure the chart is for ELECTRICITY (kWh), NOT natural gas (therms/ccf)
  * Each bar represents usage for the month whose label appears directly BELOW or BESIDE that specific bar
  * Read the Y-axis scale carefully to determine the kWh value for each bar
  * The most recent bar should roughly match the totalUsageKwh — use this as a calibration check
  * Include ALL months in "usageHistory", ordered chronologically from oldest to newest
  * Use 3-letter month abbreviations (Jan, Feb, Mar, etc) and include the correct year
  * If no ELECTRICITY usage history chart is present, just include the current month's data
- If this is a new meter (previous reading = 0, or bill says "new meter"), the current month may be the ONLY data point. That's fine — just include it.
- Do NOT include gas usage history in the usageHistory array
- If the bill shows "Daily Average" kWh and cost for "Last Year" vs "This Year", include that info in the usageHistory if it helps establish prior consumption, but flag it clearly
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
    // Retry on transient Anthropic 5xx / overloaded errors (up to 3 attempts with backoff)
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
                    text: EXTRACTION_PROMPT,
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
        console.warn(`[billParser] Transient error (attempt ${attempt}/3, status=${status}); retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (!response) throw lastErr || new Error('Bill parsing failed after retries');

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

    // Normalize: ensure electricityTotal is set
    if (!result.charges?.electricityTotal && result.charges) {
      // Sum up supply + delivery + taxes for electricity total
      const supplyTotal = result.charges.supply?.total || 0;
      const deliveryTotal = result.charges.delivery?.total || 0;
      const taxTotal = result.charges.taxesAndFees?.total || 0;
      result.charges.electricityTotal = supplyTotal + deliveryTotal + taxTotal;
    }

    // Normalize: default new fields
    result.meterReadings.isNewMeter = result.meterReadings.isNewMeter || false;
    result.isCommercial = result.isCommercial || false;
    result.hasGasService = result.hasGasService || false;

    // Sanity check: if usageHistory has entries with suspiciously low kWh
    // (possible gas therms mistakenly in kWh field), validate against bill kWh
    if (result.usageHistory && result.usageHistory.length > 1) {
      const billKwh = result.meterReadings.totalUsageKwh;
      const avgHistory = result.usageHistory.reduce((s, e) => s + (e.kWh || 0), 0) / result.usageHistory.length;
      // If average history is < 10% of bill kWh, it's probably gas data mislabeled
      if (avgHistory > 0 && avgHistory < billKwh * 0.10) {
        console.warn(`[billParser] Usage history avg (${Math.round(avgHistory)}) is <10% of bill kWh (${billKwh}). Likely gas data — discarding history.`);
        result.usageHistory = [{ month: MONTH_NAMES[new Date(result.servicePeriod.endDate).getMonth()], year: new Date(result.servicePeriod.endDate).getFullYear(), kWh: billKwh }];
      }
    }

    const historyCount = result.usageHistory?.length || 0;
    const meterType = result.meterReadings.isNewMeter ? ' (NEW METER)' : '';
    const rateInfo = result.isCommercial ? ` [Commercial: ${result.rateClass}]` : ` [${result.rateClass || 'Residential'}]`;
    console.log(`[billParser] Extracted: ${result.meterReadings.totalUsageKwh} kWh, $${result.charges?.electricityTotal || result.totalAmountDue} electric, ${historyCount} months of history${meterType}${rateInfo}`);
    if (result.hasGasService) {
      console.log(`[billParser] Bill also includes gas service: $${result.gasChargesTotal}`);
    }
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
