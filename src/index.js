const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PORT, MAX_FILE_SIZE } = require('./constants');
const { analyzeBill, analyzeProposal, analyzeBoth, analyzeHaveSolar } = require('./pipeline/orchestrator');
const {
  saveLead, getAllLeads, getTotalLeadCount, saveAnalysis,
  findLeadByToken, getLeadsDueForEmail, advanceLeadEmail,
  unsubscribeLead, getAnalysis, findLeadByEmail,
} = require('./db');
const {
  sendReportEmail, sendDay2Educational, sendDay5Negotiation, sendDay21Referral,
} = require('./email/sendgrid');

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.stack : reason);
});

const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const cookieParser = require('cookie-parser');

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// ── A/B test middleware ──────────────────────────────────────────────
// Assigns visitors to variant A (control) or B (cost-answer section)
// Sticky via cookie so returning visitors see the same version
app.get('/', (req, res) => {
  let variant = req.cookies.ab_variant;
  if (!variant || !['A', 'B'].includes(variant)) {
    variant = Math.random() < 0.5 ? 'A' : 'B';
    res.cookie('ab_variant', variant, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: false });
  }
  if (variant === 'B') {
    // Variant B: content-first experience
    const htmlPath = path.join(__dirname, '..', 'public', 'index-b.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    res.send(html);
  } else {
    // Variant A: current page with cost-answer section
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const variantScript = `<script>window.__AB_VARIANT = "${variant}";</script>`;
    html = html.replace('</head>', variantScript + '\n</head>');
    res.send(html);
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ── Clean URL routes for SEO content pages ─────────────────────────────
app.get('/solar-cost-colorado', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-cost-colorado.html'));
});
app.get('/solar-proposal-checklist', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-proposal-checklist.html'));
});
app.get('/solar-red-flags', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-red-flags.html'));
});

// ── Programmatic city pages ───────────────────────────────────────────
app.get('/solar-boulder-co', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-boulder-co.html'));
});
app.get('/solar-denver-co', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-denver-co.html'));
});
app.get('/solar-fort-collins-co', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'solar-fort-collins-co.html'));
});

// ── Persistent report URL ─────────────────────────────────────────────
app.get('/report/:token', (req, res) => {
  const lead = findLeadByToken(req.params.token);
  if (!lead) {
    return res.status(404).send(`<!DOCTYPE html><html><head><title>Report Not Found</title>
      <style>body{font-family:Inter,system-ui,sans-serif;max-width:600px;margin:80px auto;text-align:center;color:#1C1C1A;}
      a{color:#D97706;}</style></head>
      <body><h1>Report not found</h1><p>This report link may have expired or is invalid.</p>
      <p><a href="/">Upload a new document for analysis</a></p></body></html>`);
  }
  const analysis = getAnalysis(lead.id);
  if (!analysis || !analysis.report_html) {
    return res.redirect('/');
  }
  // Serve standalone report page
  res.send(`<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Solar Analysis — Utility Bill Review</title>
    <meta name="robots" content="noindex">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>body{margin:0;padding:24px;background:#FAFAF7;font-family:'Inter',system-ui,sans-serif;}
    .back-link{display:block;max-width:800px;margin:0 auto 16px;font-size:14px;}
    .back-link a{color:#D97706;text-decoration:none;}</style>
    <script defer data-domain="utilitybillreview.com" src="https://plausible.io/js/script.tagged-events.js"></script>
    </head><body>
    <div class="back-link"><a href="/">&larr; Back to Utility Bill Review</a></div>
    ${analysis.report_html}
    </body></html>`);
});

// ── Unsubscribe endpoint ──────────────────────────────────────────────
app.get('/unsubscribe/:token', (req, res) => {
  unsubscribeLead(req.params.token);
  res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title>
    <style>body{font-family:Inter,system-ui,sans-serif;max-width:600px;margin:80px auto;text-align:center;color:#1C1C1A;}
    a{color:#D97706;}</style></head>
    <body><h1>You've been unsubscribed</h1>
    <p>You won't receive any more emails from us.</p>
    <p><a href="/">Back to Utility Bill Review</a></p></body></html>`);
});

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// Have-solar upload: bill PDF + production (PDF or image screenshot) + optional proposal PDF.
// We accept images on the `production` field only — bill and proposal stay PDF-only.
const haveSolarUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'production') {
      const ok = file.mimetype === 'application/pdf'
        || /^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.mimetype);
      if (ok) return cb(null, true);
      return cb(new Error('Production must be a PDF or image (PNG/JPG/WebP)'));
    }
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Only PDF files are accepted for this field'));
  },
}).fields([
  { name: 'bill', maxCount: 1 },
  { name: 'production', maxCount: 1 },
  { name: 'proposal', maxCount: 1 },
]);

// Helper: create abort controller linked to client disconnect
function createLinkedAbort(req, res) {
  const abortController = new AbortController();
  req.setTimeout(300000);
  req.on('close', () => {
    if (!res.writableEnded && req.socket.destroyed) {
      console.log('[server] Client disconnected, aborting pipeline');
      abortController.abort();
    }
  });
  return abortController;
}

// Helper: clean up uploaded files
async function cleanupFiles(...filePaths) {
  for (const fp of filePaths) {
    if (fp) {
      await fs.promises.unlink(fp).catch((err) => {
        console.error('[server] Failed to clean up file:', err.message);
      });
    }
  }
}

// Helper: extract grade/city/size from analysis data
function extractLeadMeta(mode, analysisData) {
  const meta = {};
  if (mode === 'proposal' || mode === 'combined') {
    meta.proposalGrade = analysisData?.score?.overallVerdict || null;
    meta.city = analysisData?.proposalData?.customer?.city || analysisData?.billData?.customer?.city || null;
    meta.systemSizeKw = analysisData?.proposalData?.systemSizeKw ||
      analysisData?.score?.counterProposal?.systemSizeKw || null;
  } else {
    meta.city = analysisData?.billData?.customer?.city || null;
    meta.systemSizeKw = analysisData?.savingsResult?.system?.sizeKw || null;
  }
  return meta;
}

// ── Lead storage (SQLite) ───────────────────────────────────────────
app.post('/api/capture-lead', express.json(), async (req, res) => {
  const { email, phone, mode, analysisData, reportHtml, utmSource, utmMedium, utmCampaign, abVariant } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const meta = extractLeadMeta(mode, analysisData);
  meta.utmSource = utmSource || null;
  meta.utmMedium = utmMedium || null;
  meta.utmCampaign = utmCampaign || null;
  meta.abVariant = abVariant || null;

  const { id: leadId, token } = saveLead(email, phone, mode, meta);
  if (analysisData) saveAnalysis(leadId, mode, analysisData, reportHtml || null);

  // Send report email with persistent link (non-blocking)
  sendReportEmail(email, mode, analysisData, token).catch(() => {});

  res.json({ success: true, token });
});

app.get('/api/leads', (req, res) => {
  const leads = getAllLeads();
  res.json({ success: true, count: leads.length, leads });
});

// ── A/B test results ─────────────────────────────────────────────────
app.get('/api/ab-results', (req, res) => {
  const auth = req.headers.authorization;
  const expected = 'Basic ' + Buffer.from((process.env.ADMIN_USER || 'admin') + ':' + (process.env.ADMIN_PASS || 'changeme')).toString('base64');
  if (auth !== expected) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Unauthorized');
  }
  const leads = getAllLeads();
  const variantA = leads.filter(l => l.ab_variant === 'A');
  const variantB = leads.filter(l => l.ab_variant === 'B');
  const googleA = variantA.filter(l => l.utm_source === 'google');
  const googleB = variantB.filter(l => l.utm_source === 'google');
  res.json({
    total: { A: variantA.length, B: variantB.length },
    fromGoogleAds: { A: googleA.length, B: googleB.length },
    variants: {
      A: { description: 'Upload-first page with cost table', leads: variantA.length },
      B: { description: 'Content-first guide — "5 Things to Check" + embedded CTAs', leads: variantB.length },
    },
    note: 'To determine winner, compare conversion rates once each variant has 50+ visitors from Google Ads. Track visitors in Plausible or Google Analytics.',
  });
});

// ── Admin endpoint (basic auth) ────────────────────────────────────
app.get('/admin/leads', (req, res) => {
  const auth = req.headers.authorization;
  const expected = 'Basic ' + Buffer.from((process.env.ADMIN_USER || 'admin') + ':' + (process.env.ADMIN_PASS || 'changeme')).toString('base64');
  if (auth !== expected) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Unauthorized');
  }
  const leads = getAllLeads();
  const total = getTotalLeadCount();
  const html = `<!DOCTYPE html><html><head><title>Leads Admin — Utility Bill Review</title>
    <style>body{font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px}
    table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid #E8E6E1;text-align:left}
    th{background:#F3F2EF;font-size:13px;text-transform:uppercase;color:#7A7A72}
    .stat{display:inline-block;background:#E8F5EC;padding:8px 16px;border-radius:8px;margin-right:12px;font-weight:600}</style></head>
    <body><h1>Leads Dashboard</h1>
    <p><span class="stat">${total} total leads</span></p>
    <table><thead><tr><th>ID</th><th>Email</th><th>Phone</th><th>Mode</th><th>Grade</th><th>City</th><th>Source</th><th>Variant</th><th>Step</th><th>Date</th></tr></thead>
    <tbody>${leads.map(l => `<tr><td>${l.id}</td><td>${l.email}</td><td>${l.phone || '-'}</td><td>${l.mode || '-'}</td><td>${l.proposal_grade || '-'}</td><td>${l.city || '-'}</td><td>${l.utm_source || 'organic'}</td><td>${l.ab_variant || '-'}</td><td>${l.email_sequence_step || 1}</td><td>${l.created_at}</td></tr>`).join('')}</tbody></table></body></html>`;
  res.send(html);
});

// ── Public stats (for social proof counter) ───────────────────────────
app.get('/api/stats', (req, res) => {
  const count = getTotalLeadCount();
  res.json({ analysesCompleted: count });
});

// ── Teaser generators (shown before email gate) ─────────────────────
const { generateTeaser } = require('./report/teaser');
const { generateExcelReport } = require('./report/excelGenerator');

// ── Route 1: Analyze utility bill ───────────────────────────────────
app.post('/api/analyze-bill', upload.single('bill'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
  console.log(`[server] Received bill: ${req.file.originalname} (${req.file.size} bytes)`);

  const abortController = createLinkedAbort(req, res);

  // Optional property data for energy efficiency analysis (Phase 2)
  const propertyData = req.body.yearBuilt ? {
    yearBuilt: parseInt(req.body.yearBuilt) || null,
    squareFeet: parseInt(req.body.squareFeet) || null,
    bedrooms: parseInt(req.body.bedrooms) || null,
    heatingFuel: req.body.heatingFuel || null, // 'gas' | 'electric' | 'heat_pump'
  } : null;

  try {
    const result = await analyzeBill(req.file.path, abortController.signal, { propertyData });
    const teaser = generateTeaser('bill', result);
    if (!res.headersSent) {
      res.json({
        success: true, report: result.html, teaser, mode: 'bill',
        analysisData: { savingsResult: result.savingsResult, billData: result.billData },
        location: { lat: result.lat, lon: result.lon },
        roofData: result.roofData || null,
        efficiencyAnalysis: result.efficiencyAnalysis || null,
      });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[server] Pipeline aborted (client disconnected)');
    } else if (!res.headersSent) {
      console.error('[server] Bill analysis failed:', err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  } finally {
    await cleanupFiles(req.file?.path);
  }
});

// ── Route 2: Analyze competitor proposal ────────────────────────────
app.post('/api/analyze-proposal', upload.single('proposal'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
  console.log(`[server] Received proposal: ${req.file.originalname} (${req.file.size} bytes)`);

  const abortController = createLinkedAbort(req, res);
  try {
    const result = await analyzeProposal(req.file.path, abortController.signal);
    const teaser = generateTeaser('proposal', result);
    if (!res.headersSent) {
      res.json({
        success: true, report: result.html, teaser, mode: 'proposal',
        analysisData: { proposalData: result.proposalData, score: result.score },
        location: { lat: result.lat, lon: result.lon },
        roofData: result.roofData || null,
      });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[server] Pipeline aborted (client disconnected)');
    } else if (!res.headersSent) {
      console.error('[server] Proposal analysis failed:', err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  } finally {
    await cleanupFiles(req.file?.path);
  }
});

// ── Route 3: Analyze both bill + proposal ───────────────────────────
const bothUpload = upload.fields([
  { name: 'bill', maxCount: 1 },
  { name: 'proposal', maxCount: 1 },
]);

app.post('/api/analyze-both', bothUpload, async (req, res) => {
  const billFile = req.files?.bill?.[0];
  const proposalFile = req.files?.proposal?.[0];

  if (!billFile || !proposalFile) {
    await cleanupFiles(billFile?.path, proposalFile?.path);
    return res.status(400).json({ error: 'Both a utility bill and a solar proposal PDF are required' });
  }

  console.log(`[server] Received bill + proposal: ${billFile.originalname}, ${proposalFile.originalname}`);

  const abortController = createLinkedAbort(req, res);
  try {
    const result = await analyzeBoth(billFile.path, proposalFile.path, abortController.signal);
    const teaser = generateTeaser('combined', result);
    if (!res.headersSent) {
      res.json({
        success: true, report: result.html, teaser, mode: 'combined',
        analysisData: {
          savingsResult: result.savingsResult, billData: result.billData,
          proposalData: result.proposalData, score: result.score,
        },
        location: { lat: result.lat, lon: result.lon },
        roofData: result.roofData || null,
      });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[server] Pipeline aborted (client disconnected)');
    } else if (!res.headersSent) {
      console.error('[server] Combined analysis failed:', err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  } finally {
    await cleanupFiles(billFile?.path, proposalFile?.path);
  }
});

// ── Route: Analyze have-solar (owners tracking actual savings) ───────
app.post('/api/analyze-have-solar', haveSolarUpload, async (req, res) => {
  const billFile = req.files?.bill?.[0];
  const productionFile = req.files?.production?.[0];
  const proposalFile = req.files?.proposal?.[0]; // optional

  if (!billFile || !productionFile) {
    await cleanupFiles(billFile?.path, productionFile?.path, proposalFile?.path);
    return res.status(400).json({ error: 'Both a utility bill (PDF) and solar production data (PDF or screenshot) are required' });
  }

  console.log(`[server] Have-solar: bill=${billFile.originalname}, production=${productionFile.originalname}${proposalFile ? `, proposal=${proposalFile.originalname}` : ''}`);

  const formInput = {
    installYear: parseInt(req.body.installYear) || null,
    systemSizeKw: parseFloat(req.body.systemSizeKw) || null,
    ownershipType: (req.body.ownershipType === 'tpo') ? 'tpo' : 'owned',
    inverterBrand: req.body.inverterBrand || null,
    ppaRatePerKwh: parseFloat(req.body.ppaRatePerKwh) || 0,
    ppaEscalatorPct: parseFloat(req.body.ppaEscalatorPct) || 0,
  };

  const abortController = createLinkedAbort(req, res);
  try {
    const result = await analyzeHaveSolar({
      billPdfPath: billFile.path,
      productionFilePath: productionFile.path,
      proposalPdfPath: proposalFile?.path,
      formInput,
      signal: abortController.signal,
    });
    const teaser = generateTeaser('have-solar', result);
    if (!res.headersSent) {
      res.json({
        success: true,
        report: result.html,
        teaser,
        mode: 'have-solar',
        analysisData: {
          billData: result.billData,
          productionData: result.productionData,
          proposalData: result.proposalData,
          actualSavings: result.actualSavings,
          promisedVsReality: result.promisedVsReality,
          guaranteeEvaluation: result.guaranteeEvaluation,
          claimLetter: result.claimLetter,
          formInput,
        },
        location: { lat: result.lat, lon: result.lon },
      });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[server] Have-solar pipeline aborted');
    } else if (!res.headersSent) {
      console.error('[server] Have-solar analysis failed:', err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  } finally {
    await cleanupFiles(billFile?.path, productionFile?.path, proposalFile?.path);
  }
});

// ── Route: Satellite image proxy (for panel designer) ───────────────
const satelliteCacheDir = path.join(uploadsDir, 'satellite-cache');
fs.mkdirSync(satelliteCacheDir, { recursive: true });

app.get('/api/satellite-image', async (req, res) => {
  const { lat, lon, zoom = 20, size = '640x640' } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google API key not configured' });

  // Check cache first (24hr TTL)
  const cacheKey = `${parseFloat(lat).toFixed(6)}_${parseFloat(lon).toFixed(6)}_${zoom}`;
  const cachePath = path.join(satelliteCacheDir, `${cacheKey}.png`);

  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 24 * 60 * 60 * 1000) {
        console.log(`[satellite] Cache hit: ${cacheKey}`);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(cachePath).pipe(res);
      }
    }
  } catch {}

  const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${zoom}&size=${size}&maptype=satellite&key=${apiKey}`;
  console.log(`[satellite] Fetching satellite image for ${lat}, ${lon} (zoom ${zoom})`);

  try {
    const response = await fetch(staticUrl);
    if (!response.ok) {
      const body = await response.text();
      console.warn(`[satellite] Static Maps API failed (${response.status}): ${body.substring(0, 120)}`);
      throw new Error(`Static Maps API: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      throw new Error('Response was not an image');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(cachePath, buffer);
    console.log(`[satellite] Cached: ${cacheKey} (${buffer.length} bytes)`);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('[satellite] Static Maps API unavailable — enable it at https://console.cloud.google.com/apis/library/static-maps-backend.googleapis.com');
    res.status(404).json({ error: 'Satellite image not available. Enable Maps Static API in Google Cloud Console.' });
  }
});

// ── Route: Save panel design ────────────────────────────────────────
app.post('/api/save-panel-design', express.json(), (req, res) => {
  const { email, panels, panelCount, systemSizeKw } = req.body;
  if (!panels) return res.status(400).json({ error: 'Panel layout required' });
  const designData = { panels, panelCount, systemSizeKw, designSavedAt: new Date().toISOString() };
  if (email) {
    const lead = findLeadByEmail(email);
    if (lead) saveAnalysis(lead.id, 'panel-design', designData);
  }
  console.log(`[leads] Saved panel design (${panelCount} panels)`);
  res.json({ success: true });
});

// ── Route 4: Generate Excel report ──────────────────────────────────
app.post('/api/generate-excel', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { mode, savingsResult, proposalData, score, billData } = req.body;
    console.log(`[server] Generating Excel report (mode: ${mode})`);

    const buffer = await generateExcelReport({ mode, savingsResult, proposalData, score, billData });

    let filename = 'Solar-Analysis';
    const addr = billData?.customer?.address || proposalData?.customer?.address;
    if (addr) {
      filename = `Solar-Analysis-${addr.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 40)}`;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[server] Excel generation failed:', err.stack || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Legacy route (backward compatible) ──────────────────────────────
app.post('/api/analyze', upload.single('bill'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
  const abortController = createLinkedAbort(req, res);
  try {
    const result = await analyzeBill(req.file.path, abortController.signal);
    if (!res.headersSent) {
      res.json({ success: true, report: result.html, customer: result.billData.customer });
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      console.log('[server] Pipeline aborted');
    } else if (!res.headersSent) {
      console.error('[server] Analysis failed:', err.stack || err.message);
      res.status(500).json({ error: err.message });
    }
  } finally {
    await cleanupFiles(req.file?.path);
  }
});

app.get('/api/latest-report', (req, res) => {
  const reportPath = path.join(uploadsDir, 'latest-report.html');
  if (fs.existsSync(reportPath)) {
    const html = fs.readFileSync(reportPath, 'utf-8');
    res.json({ success: true, report: html });
  } else {
    res.status(404).json({ error: 'No report available' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err.message === 'Only PDF files are accepted') {
    return res.status(400).json({ error: err.message });
  }
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Email Scheduler (runs every 15 minutes) ─────────────────────────
function runEmailScheduler() {
  try {
    const leads = getLeadsDueForEmail();
    if (leads.length === 0) return;

    console.log(`[scheduler] Processing ${leads.length} leads due for email`);

    for (const lead of leads) {
      const step = lead.email_sequence_step || 1;
      const grade = lead.proposal_grade || 'average';
      const token = lead.report_token || '';

      // Step 1 = report already sent on capture. Scheduler handles steps 2-4.
      if (step === 2) {
        sendDay2Educational(lead.email, token, grade).catch(() => {});
        advanceLeadEmail(lead.id, 3, '+3 days'); // next email in 3 more days (day 5)
      } else if (step === 3) {
        sendDay5Negotiation(lead.email, token, grade, lead.city, lead.system_size_kw).catch(() => {});
        advanceLeadEmail(lead.id, 4, '+16 days'); // next email in 16 more days (day 21)
      } else if (step === 4) {
        sendDay21Referral(lead.email, token).catch(() => {});
        advanceLeadEmail(lead.id, 5, '+999 days'); // done — no more emails
      }
    }
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`[server] Solar analyzer running at http://localhost:${PORT}`);

  // Start email scheduler — every 15 minutes
  setInterval(runEmailScheduler, 15 * 60 * 1000);
  // Run once on startup (after 30 second delay to let everything initialize)
  setTimeout(runEmailScheduler, 30000);
  console.log('[scheduler] Email scheduler active (15-minute interval)');
});
