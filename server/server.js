const express = require("express");
const fs = require("fs");
const path = require("path");
const smsFlow = require("./smsFlow");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Pilot-scale: SMS conversation state per phone number, in memory only.
// Resets on server restart — acceptable for a pilot; a production rollout
// would persist this the same way submissions.json is persisted below.
const smsSessions = new Map();

// Set this to a long random string and configure the same value in Telerivet's
// Webhook API service — see webapp/README.md and sms_pilot_checklist.pdf.
const TELERIVET_WEBHOOK_SECRET = process.env.TELERIVET_WEBHOOK_SECRET || "change-me-before-going-live";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

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

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

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

app.post("/api/submissions", (req, res) => {
  const { localId, created_at, data, source, verified } = req.body || {};
  const result = insertSubmission({ localId, created_at, data, source, verified });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.duplicate) return res.status(200).json({ id: result.record.localId, duplicate: true });
  res.status(201).json({ id: result.record.localId });
});

app.get("/api/submissions", (req, res) => {
  const sorted = [...submissions].sort((a, b) => b.received_at.localeCompare(a.received_at));
  res.json(sorted);
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
  });

  res.status(200).json({ messages: [{ content: replyText, to_number: from_number, message_type: "sms" }] });
});

app.listen(PORT, () => {
  console.log(`Chegutu livestock server listening on :${PORT}`);
  console.log(`  Form:       http://localhost:${PORT}/`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard.html`);
  console.log(`  SMS webhook:http://localhost:${PORT}/webhook/telerivet-sms  (point Telerivet's Webhook API service here once hosted publicly)`);
});
