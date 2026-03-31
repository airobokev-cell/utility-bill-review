const path = require('path');
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

// Prepared statements
const insertLead = db.prepare(`
  INSERT INTO leads (email, phone, mode) VALUES (?, ?, ?)
`);

const insertAnalysis = db.prepare(`
  INSERT INTO analyses (lead_id, mode, summary_json) VALUES (?, ?, ?)
`);

const getLeads = db.prepare(`
  SELECT * FROM leads ORDER BY created_at DESC
`);

const getLeadByEmail = db.prepare(`
  SELECT * FROM leads WHERE email = ? ORDER BY created_at DESC LIMIT 1
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

function saveLead(email, phone, mode) {
  const result = insertLead.run(email, phone || null, mode || null);
  console.log(`[db] Saved lead: ${email} (id: ${result.lastInsertRowid})`);
  return result.lastInsertRowid;
}

function saveAnalysis(leadId, mode, summaryData) {
  const json = JSON.stringify(summaryData);
  insertAnalysis.run(leadId, mode, json);
}

function getAllLeads() {
  return getLeads.all();
}

function findLeadByEmail(email) {
  return getLeadByEmail.get(email);
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
  setLeadStatus,
  markFollowUpSent,
  getLeadsNeedingFollowUp,
  getTotalLeadCount,
};
