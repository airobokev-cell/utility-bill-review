const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PORT, MAX_FILE_SIZE } = require('./constants');
const { analyzeBill, analyzeProposal, analyzeBoth } = require('./pipeline/orchestrator');
const { saveLead, getAllLeads, getTotalLeadCount, saveAnalysis } = require('./db');
const { sendReportEmail } = require('./email/sendgrid');

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.stack : reason);
});

const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
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

// ── Lead storage (SQLite) ───────────────────────────────────────────
app.post('/api/capture-lead', express.json(), async (req, res) => {
  const { email, phone, mode, analysisData } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const leadId = saveLead(email, phone, mode);
  if (analysisData) saveAnalysis(leadId, mode, analysisData);
  // Send report email (non-blocking)
  sendReportEmail(email, mode, analysisData).catch(() => {});
  res.json({ success: true });
});

app.get('/api/leads', (req, res) => {
  const leads = getAllLeads();
  res.json({ success: true, count: leads.length, leads });
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
    table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left}
    th{background:#f8fafc;font-size:13px;text-transform:uppercase;color:#64748b}
    .stat{display:inline-block;background:#f0fdf4;padding:8px 16px;border-radius:8px;margin-right:12px;font-weight:600}</style></head>
    <body><h1>Leads Dashboard</h1>
    <p><span class="stat">${total} total leads</span></p>
    <table><thead><tr><th>ID</th><th>Email</th><th>Phone</th><th>Mode</th><th>Status</th><th>Date</th></tr></thead>
    <tbody>${leads.map(l => `<tr><td>${l.id}</td><td>${l.email}</td><td>${l.phone || '-'}</td><td>${l.mode || '-'}</td><td>${l.status}</td><td>${l.created_at}</td></tr>`).join('')}</tbody></table></body></html>`;
  res.send(html);
});

// ── Public stats (for social proof counter) ───────────────────────────
app.get('/api/stats', (req, res) => {
  const count = getTotalLeadCount();
  // Add a base number so it doesn't look empty at launch
  res.json({ analysesCompleted: count + 127 });
});

// ── Teaser generators (shown before email gate) ─────────────────────
const { generateTeaser } = require('./report/teaser');
const { generateExcelReport } = require('./report/excelGenerator');

// ── Route 1: Analyze utility bill ───────────────────────────────────
app.post('/api/analyze-bill', upload.single('bill'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
  console.log(`[server] Received bill: ${req.file.originalname} (${req.file.size} bytes)`);

  const abortController = createLinkedAbort(req, res);
  try {
    const result = await analyzeBill(req.file.path, abortController.signal);
    const teaser = generateTeaser('bill', result);
    if (!res.headersSent) {
      res.json({
        success: true, report: result.html, teaser, mode: 'bill',
        analysisData: { savingsResult: result.savingsResult, billData: result.billData },
        location: { lat: result.lat, lon: result.lon },
        roofData: result.roofData || null,
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

  // Try Google Maps Static API first, fallback to Solar API data layers
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
    // Return 404 so frontend shows a nice placeholder
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
    const { findLeadByEmail } = require('./db');
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

    // Build filename from address if available
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

app.listen(PORT, () => {
  console.log(`[server] Solar analyzer running at http://localhost:${PORT}`);
});
