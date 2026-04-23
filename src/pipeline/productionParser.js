const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
const { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS } = require('../constants');

const client = new Anthropic();

const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const EXTRACTION_PROMPT = `You are analyzing a solar production report or monitoring screenshot from a residential solar system. This could be a PDF export from Enphase Enlighten, SolarEdge mySolarEdge, Tesla app, SunPower, SMA, Generac/PWRcell, or a screenshot from any of those apps.

Extract every production metric visible and return it as JSON. If a field isn't visible or can't be determined, use null (not 0).

Return this exact JSON structure:
{
  "monitoringPlatform": "",             // e.g. "Enphase Enlighten", "SolarEdge", "Tesla", "SunPower", "Unknown"
  "systemSizeKw": null,                 // System DC size if shown
  "installDate": null,                  // YYYY-MM-DD if shown
  "periodLabel": "",                    // e.g. "October 2026", "Last 12 Months", "Lifetime", "Last 30 Days"
  "periodStart": null,                  // YYYY-MM-DD
  "periodEnd": null,                    // YYYY-MM-DD
  "lifetimeKwh": null,                  // Total kWh produced since install
  "last12MonthsKwh": null,              // Total kWh in the trailing 12 months
  "currentMonthKwh": null,              // kWh produced in the most recent full month
  "currentMonthLabel": "",              // e.g. "Oct 2026"
  "monthlyHistory": [                   // Up to last 24 months if bar chart present
    { "month": "Oct", "year": 2026, "kWh": 0 }
  ],
  "dailyAverageKwh": null,              // Daily average for the displayed period
  "peakPowerKw": null,                  // Peak instantaneous production if shown
  "exportedToGridKwh": null,            // If the monitoring shows grid export separately
  "selfConsumedKwh": null,              // If the monitoring shows self-consumption separately
  "notes": ""                           // Anything relevant that didn't fit above
}

Important:
- This is a POST-INSTALL monitoring document showing what a solar system has ACTUALLY produced — not a forecast or proposal.
- Read every number exactly as printed. Do not estimate or round.
- "lifetimeKwh" is typically labeled "Lifetime", "Total Produced", "Since Install", or similar.
- "last12MonthsKwh" appears in SolarEdge and Enphase year summaries. If the chart clearly covers 12 months and a total is shown, use it.
- For "monthlyHistory", read each bar in the production chart. Label each by the month+year the bar represents. Order oldest → newest.
- If the document only shows a single large number (lifetime), that's fine — leave the monthly fields null.
- If the platform name isn't visible, guess from layout/branding: Enphase uses orange+graphs; SolarEdge uses blue; Tesla uses minimal red/dark. Set "Unknown" if you can't tell.
- Return ONLY valid JSON, no markdown fences or other text.`;

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return { kind: 'document', type: 'application/pdf' };
  if (IMAGE_MEDIA_TYPES[ext]) return { kind: 'image', type: IMAGE_MEDIA_TYPES[ext] };
  throw new Error(`Unsupported production file type: ${ext}`);
}

async function parseProduction(filePath, signal) {
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString('base64');
  const { kind, type } = getMediaType(filePath);

  console.log(`[productionParser] Sending ${kind} (${type}) to Claude for extraction...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new Error('Production parsing aborted: client disconnected');
    }
    signal.addEventListener('abort', onExternalAbort);
  }

  try {
    const documentBlock = kind === 'document'
      ? { type: 'document', source: { type: 'base64', media_type: type, data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: type, data: base64 } };

    let response;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await client.messages.create(
          {
            model: CLAUDE_MODEL,
            max_tokens: 3072,
            messages: [
              {
                role: 'user',
                content: [
                  documentBlock,
                  { type: 'text', text: EXTRACTION_PROMPT },
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
        console.warn(`[productionParser] Transient error (attempt ${attempt}/3, status=${status}); retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (!response) throw lastErr || new Error('Production parsing failed after retries');

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

    // Validation: we need SOMETHING usable
    const usable =
      Number(result.lifetimeKwh) > 0 ||
      Number(result.last12MonthsKwh) > 0 ||
      Number(result.currentMonthKwh) > 0 ||
      (Array.isArray(result.monthlyHistory) && result.monthlyHistory.some((m) => Number(m.kWh) > 0));

    if (!usable) {
      throw new Error('Could not extract any production numbers from this document');
    }

    console.log(`[productionParser] Extracted from ${result.monitoringPlatform || 'unknown'}: lifetime=${result.lifetimeKwh ?? '?'}, last12=${result.last12MonthsKwh ?? '?'}, history=${result.monthlyHistory?.length || 0} months`);
    return result;
  } catch (err) {
    if (signal?.aborted) {
      throw new Error('Production parsing aborted: client disconnected');
    }
    throw new Error(`Production parsing failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

module.exports = { parseProduction };
