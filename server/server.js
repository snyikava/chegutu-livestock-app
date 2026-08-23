const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const smsFlow = require("./smsFlow");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sms_sessions.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Set these to real values wherever this runs — see webapp/README.md ("Access
// control"). Left as an obvious placeholder so it's impossible to miss that a
// deployment is still running on the default, the same pattern as the
// Telerivet webhook secret below.
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "change-me-before-going-live";
const FIELD_ACCESS_TOKEN = process.env.FIELD_ACCESS_TOKEN || "change-me-before-going-live";
const TELERIVET_WEBHOOK_SECRET = process.env.TELERIVET_WEBHOOK_SECRET || "change-me-before-going-live";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, "[]");

// Mirrors public/schema.js — which "has_x" toggles map to a human label.
const GROUP_LABELS = {
  has_beef_cattle: "Beef cattle",
  has_dairy_cattle: "Dairy cattle",
  has_donkeys: "Donkeys",
  has_goats: "Goats",
  has_sheep: "Sheep",
  has_pigs: "Pigs",
  has_poultry: "Poultry",
  has_bees: "Bees",
  has_aquaculture: "Aquaculture",
  has_aquatic_plants: "Aquatic plants",
  has_rabbits: "Rabbits",
};
const REQUIRED_FIELDS = ["ward", "village", "household_id", "household_head_name", "enumerator_name", "collection_date"];

let submissions = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
let writeQueue = Promise.resolve();
function persist() {
  writeQueue = writeQueue.then(
    () => fs.promises.writeFile(DATA_FILE, JSON.stringify(submissions, null, 2))
  );
  return writeQueue;
}

// SMS conversation state per phone number. Previously in-memory only, which
// meant a server restart silently dropped anyone mid-conversation — now
// persisted the same way submissions are, so a restart at worst costs the
// farmer nothing more than re-reading the current prompt.
let smsSessions = new Map(JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")));
let sessionWriteQueue = Promise.resolve();
function persistSessions() {
  sessionWriteQueue = sessionWriteQueue.then(
    () => fs.promises.writeFile(SESSIONS_FILE, JSON.stringify(Array.from(smsSessions.entries()), null, 2))
  );
  return sessionWriteQueue;
}

// ---------- Auth ----------
// Constant-time comparison so response timing can't be used to guess the
// password/token character by character.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Gates the dashboard and read access to the data behind it. Standard HTTP
// Basic Auth: browsers prompt for it natively and remember it for the tab's
// session, so nothing in dashboard.html needs to change to use this.
function requireDashboardAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try { decoded = Buffer.from(encoded, "base64").toString("utf8"); } catch (e) { /* fall through to 401 */ }
    const sep = decoded.indexOf(":");
    const pass = sep >= 0 ? decoded.slice(sep + 1) : decoded;
    if (safeEqual(pass, DASHBOARD_PASSWORD)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Chegutu Livestock Dashboard"');
  return res.status(401).send("Authentication required.");
}

// Gates writes coming from the field app. A shared token rather than Basic
// Auth because this is called from fetch(), not a browser navigation — see
// public/app.js for where the enumerator enters it once and it's remembered
// on that device.
function requireFieldToken(req, res, next) {
  const token = req.headers["x-field-token"] || "";
  if (token && safeEqual(token, FIELD_ACCESS_TOKEN)) return next();
  return res.status(401).json({ error: "missing or invalid field access token" });
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), count: submissions.length });
});

// Shared by the field app's POST /api/submissions and the SMS webhook below, so
// both channels write through exactly the same validation, idempotency, and
// storage path — one submissions store, whichever door it came through.
function insertSubmission({ localId, created_at, data, source, verified }) {
  if (!localId || !data) return { error: "localId and data are required", status: 400 };

  const missing = REQUIRED_FIELDS.filter((f) => !data[f] || String(data[f]).trim() === "");
  if (missing.length) return { error: "missing required fields: " + missing.join(", "), status: 400 };

  const existing = submissions.find((s) => s.localId === localId);
  if (existing) return { record: existing, duplicate: true };

  const species = Object.keys(GROUP_LABELS).filter((k) => data[k] === "yes").map((k) => GROUP_LABELS[k]);
  const received_at = new Date().toISOString();
  const record = {
    localId,
    created_at: created_at || received_at,
    received_at,
    sync_latency_ms: created_at ? (new Date(received_at) - new Date(created_at)) : null,
    source: source || "field",
    verified: typeof verified === "boolean" ? verified : true,
    ward: data.ward,
    village: data.village,
    household_id: data.household_id,
    household_head_name: data.household_head_name,
    enumerator_name: data.enumerator_name,
    collection_date: data.collection_date,
    gps_location: data.gps_location || null,
    species,
    data,
  };
  submissions.push(record);
  persist();
  return { record };
}

app.post("/api/submissions", requireFieldToken, (req, res) => {
  const { localId, created_at, data, source, verified } = req.body || {};
  const result = insertSubmission({ localId, created_at, data, source, verified });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.duplicate) return res.status(200).json({ id: result.record.localId, duplicate: true });
  res.status(201).json({ id: result.record.localId });
});

app.get("/api/submissions", requireDashboardAuth, (req, res) => {
  const sorted = [...submissions].sort((a, b) => b.received_at.localeCompare(a.received_at));
  res.json(sorted);
});

// Lets a councillor confirm an SMS self-report after cross-checking it in
// person — previously the dashboard could only display "pending review"
// forever, with nothing anywhere that flipped it to verified.
app.patch("/api/submissions/:localId/verify", requireDashboardAuth, (req, res) => {
  const record = submissions.find((s) => s.localId === req.params.localId);
  if (!record) return res.status(404).json({ error: "submission not found" });
  record.verified = true;
  record.verified_at = new Date().toISOString();
  persist();
  res.json({ ok: true, record });
});

app.get("/dashboard.html", requireDashboardAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

// Telerivet's Webhook API service posts here for every inbound SMS to the gateway
// number. See sms_pilot_checklist.pdf for how to point Telerivet at this endpoint,
// and https://telerivet.com/api/webhook for the request/response shapes this
// implements. Runs the same conversation as the demo artifact's Self-Report tab,
// but for real, against real replies.
app.post("/webhook/telerivet-sms", express.urlencoded({ extended: true }), (req, res) => {
  const { event, secret, from_number, from_number_e164, content } = req.body || {};

  if (secret !== TELERIVET_WEBHOOK_SECRET) return res.status(403).json({ error: "invalid webhook secret" });
  if (event !== "incoming_message") return res.status(200).json({}); // ack anything else silently

  const phone = from_number_e164 || from_number;
  if (!phone) return res.status(200).json({});

  const replyText = smsFlow.handleIncoming(smsSessions, phone, content || "", {
    onSubmit: (data) => {
      const localId = "sms-" + phone.replace(/[^0-9]/g, "") + "-" + Date.now();
      insertSubmission({ localId, created_at: new Date().toISOString(), data, source: "sms", verified: false });
    },
    // Backs the "Check my last report" menu option — previously this always
    // replied "not found" regardless of what the farmer had actually sent.
    getLastReport: (forPhone) => {
      const matches = submissions
        .filter((s) => s.source === "sms" && s.data && s.data.respondent_contact === forPhone)
        .sort((a, b) => b.received_at.localeCompare(a.received_at));
      return matches[0] || null;
    },
  });
  persistSessions();

  res.status(200).json({ messages: [{ content: replyText, to_number: from_number, message_type: "sms" }] });
});

// Everything else (the field form itself: index.html, app.js, schema.js,
// styles.css, manifest.json, icons, service worker) is intentionally public —
// it has no household data in it, and the enumerator needs to be able to load
// it once to install it before any credentials come into play.
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`Chegutu livestock server listening on :${PORT}`);
  console.log(`  Form:       http://localhost:${PORT}/`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html  (Basic Auth — any username, password = DASHBOARD_PASSWORD)`);
  console.log(`  SMS webhook:http://localhost:${PORT}/webhook/telerivet-sms  (point Telerivet's Webhook API service here once hosted publicly)`);
  if (DASHBOARD_PASSWORD === "change-me-before-going-live" || FIELD_ACCESS_TOKEN === "change-me-before-going-live") {
    console.warn("  WARNING: DASHBOARD_PASSWORD and/or FIELD_ACCESS_TOKEN are still on their placeholder default — set both before this is reachable from the internet.");
  }
});
