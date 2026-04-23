const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'leads.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    phone TEXT,
    mode TEXT,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now')),
    follow_up_sent_at TEXT,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER REFERENCES leads(id),
    mode TEXT,
    summary_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
`);

// ── Schema migrations (safe to run repeatedly) ───────────────────────
function addColumnIfMissing(table, column, type) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch {
    // Column already exists — ignore
  }
}

// Lead enrichment columns
addColumnIfMissing('leads', 'proposal_grade', 'TEXT');
addColumnIfMissing('leads', 'city', 'TEXT');
addColumnIfMissing('leads', 'system_size_kw', 'REAL');
addColumnIfMissing('leads', 'report_token', 'TEXT');
addColumnIfMissing('leads', 'unsubscribed', 'INTEGER DEFAULT 0');

// Email sequence columns
addColumnIfMissing('leads', 'email_sequence_step', 'INTEGER DEFAULT 1');
addColumnIfMissing('leads', 'next_email_at', 'TEXT');

// UTM tracking columns
addColumnIfMissing('leads', 'utm_source', 'TEXT');
addColumnIfMissing('leads', 'utm_medium', 'TEXT');
addColumnIfMissing('leads', 'utm_campaign', 'TEXT');

// A/B test variant tracking
addColumnIfMissing('leads', 'ab_variant', 'TEXT');

// Have-solar mode enrichment (post-install owners)
addColumnIfMissing('leads', 'has_solar_installed', 'INTEGER DEFAULT 0');
addColumnIfMissing('leads', 'ownership_type', 'TEXT');       // 'owned' | 'tpo'
addColumnIfMissing('leads', 'install_year', 'INTEGER');
addColumnIfMissing('leads', 'inverter_brand', 'TEXT');
addColumnIfMissing('leads', 'ppa_rate_per_kwh', 'REAL');
addColumnIfMissing('leads', 'ppa_escalator_pct', 'REAL');

// Report HTML storage in analyses
addColumnIfMissing('analyses', 'report_html', 'TEXT');

// Index for report token lookups
try { db.exec('CREATE INDEX IF NOT EXISTS idx_leads_token ON leads(report_token)'); } catch {}

// ── Prepared statements ──────────────────────────────────────────────
const insertLead = db.prepare(`
  INSERT INTO leads (email, phone, mode, report_token, proposal_grade, city, system_size_kw, utm_source, utm_medium, utm_campaign, ab_variant, next_email_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+2 days'))
`);

const insertAnalysis = db.prepare(`
  INSERT INTO analyses (lead_id, mode, summary_json, report_html) VALUES (?, ?, ?, ?)
`);

const getLeads = db.prepare(`
  SELECT * FROM leads ORDER BY created_at DESC
`);

const getLeadByEmail = db.prepare(`
  SELECT * FROM leads WHERE email = ? ORDER BY created_at DESC LIMIT 1
`);

const getLeadByToken = db.prepare(`
  SELECT * FROM leads WHERE report_token = ? LIMIT 1
`);

const updateLeadStatus = db.prepare(`
  UPDATE leads SET status = ? WHERE id = ?
`);

const updateFollowUpSent = db.prepare(`
  UPDATE leads SET follow_up_sent_at = datetime('now') WHERE id = ?
`);

const getLeadsForFollowUp = db.prepare(`
  SELECT * FROM leads
  WHERE follow_up_sent_at IS NULL
  AND created_at < datetime('now', '-2 days')
  AND status = 'new'
`);

const getLeadCount = db.prepare(`SELECT COUNT(*) as count FROM leads`);

// Email scheduler queries
const getLeadsNeedingEmail = db.prepare(`
  SELECT l.*, a.summary_json, a.report_html
  FROM leads l
  LEFT JOIN analyses a ON a.lead_id = l.id AND a.mode = l.mode
  WHERE l.next_email_at IS NOT NULL
  AND l.next_email_at <= datetime('now')
  AND (l.unsubscribed IS NULL OR l.unsubscribed = 0)
  AND l.email_sequence_step <= 4
`);

const advanceEmailStep = db.prepare(`
  UPDATE leads
  SET email_sequence_step = ?,
      next_email_at = datetime('now', ?),
      follow_up_sent_at = CASE WHEN ? = 2 THEN datetime('now') ELSE follow_up_sent_at END
  WHERE id = ?
`);

const markUnsubscribed = db.prepare(`
  UPDATE leads SET unsubscribed = 1, next_email_at = NULL WHERE report_token = ?
`);

const getAnalysisForLead = db.prepare(`
  SELECT * FROM analyses WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1
`);

// ── Public functions ────────────────────────────────────────────────
function saveLead(email, phone, mode, extra = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const result = insertLead.run(
    email,
    phone || null,
    mode || null,
    token,
    extra.proposalGrade || null,
    extra.city || null,
    extra.systemSizeKw || null,
    extra.utmSource || null,
    extra.utmMedium || null,
    extra.utmCampaign || null,
    extra.abVariant || null
  );
  console.log(`[db] Saved lead: ${email} (id: ${result.lastInsertRowid}, token: ${token.substring(0, 8)}...)`);
  return { id: result.lastInsertRowid, token };
}

function saveAnalysis(leadId, mode, summaryData, reportHtml) {
  const json = JSON.stringify(summaryData);
  insertAnalysis.run(leadId, mode, json, reportHtml || null);
}

function getAllLeads() {
  return getLeads.all();
}

function findLeadByEmail(email) {
  return getLeadByEmail.get(email);
}

function findLeadByToken(token) {
  return getLeadByToken.get(token);
}

function setLeadStatus(id, status) {
  updateLeadStatus.run(status, id);
}

function markFollowUpSent(id) {
  updateFollowUpSent.run(id);
}

function getLeadsNeedingFollowUp() {
  return getLeadsForFollowUp.all();
}

function getTotalLeadCount() {
  return getLeadCount.get().count;
}

function getLeadsDueForEmail() {
  return getLeadsNeedingEmail.all();
}

function advanceLeadEmail(leadId, nextStep, interval) {
  // interval like '+3 days', '+7 days', '+21 days'
  advanceEmailStep.run(nextStep, interval, nextStep, leadId);
}

function unsubscribeLead(token) {
  markUnsubscribed.run(token);
}

function getAnalysis(leadId) {
  return getAnalysisForLead.get(leadId);
}

// Migrate existing leads.json if it exists
function migrateFromJson() {
  const jsonPath = path.join(__dirname, '..', 'leads.json');
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (Array.isArray(data) && data.length > 0) {
      const insert = db.prepare(`INSERT OR IGNORE INTO leads (email, phone, mode, created_at) VALUES (?, ?, ?, ?)`);
      const migrate = db.transaction((leads) => {
        for (const lead of leads) {
          insert.run(lead.email, lead.phone || null, lead.mode || null, lead.timestamp || new Date().toISOString());
        }
      });
      migrate(data);
      console.log(`[db] Migrated ${data.length} leads from leads.json`);
    }
  } catch {
    // No leads.json or already migrated
  }
}

migrateFromJson();

module.exports = {
  db,
  saveLead,
  saveAnalysis,
  getAllLeads,
  findLeadByEmail,
  findLeadByToken,
  setLeadStatus,
  markFollowUpSent,
  getLeadsNeedingFollowUp,
  getTotalLeadCount,
  getLeadsDueForEmail,
  advanceLeadEmail,
  unsubscribeLead,
  getAnalysis,
};
