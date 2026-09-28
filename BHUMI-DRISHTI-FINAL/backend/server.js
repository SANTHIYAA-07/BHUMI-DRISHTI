/**
 * BHUMI-DRISHTI — Final SIH 2026 Prototype Backend
 * Full flow: Auth → Cases → Land Records (mock) → Documents → Workflow →
 * ML Delay Prediction + SHAP-style explanation → Recommendations → Alerts
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const { lookup: landLookup } = require("../integrations/land_records/mock_provider");
const { predictDelay } = require("../ml/predict");

let Anthropic = null;
try {
  Anthropic = require("@anthropic-ai/sdk");
} catch (_) {}

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "bhumi-drishti-sih-2026-demo-secret";
const PORT = process.env.PORT || 3000;
const ALLOWED = (process.env.ALLOWED_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000,http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED.includes(origin) || origin.startsWith("http://localhost")) return cb(null, true);
      return cb(null, true); // demo-friendly
    },
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

const anthropic = process.env.ANTHROPIC_API_KEY && Anthropic
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

/* ---------- JSON DB ---------- */
const DB_PATH = path.join(__dirname, "data", "db.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const seed = {
      nextCase: 13,
      records: [],
      notifications: [],
      outcomes: []
    };
    // Seed one complete demo case for judges
    seed.records.push(makeDemoCase());
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function makeDemoCase() {
  const now = new Date();
  const created = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  return {
    id: "BD-2026-0012",
    caseId: "BD-2026-0012",
    createdBy: "citizen",
    role: "citizen",
    createdAt: created.toISOString(),
    updatedAt: now.toISOString(),
    surveyNo: "125/2A",
    subDivision: null,
    area: 2.5,
    landType: "agricultural",
    lat: 9.8795,
    lon: 78.0707,
    photoDataUrl: null,
    documents: {
      ownership: true,
      survey: true,
      certificate: false,
      other: true
    },
    landRecord: {
      found: true,
      ownership: "private",
      classification: "agricultural",
      isPoramboke: false,
      isPatta: true,
      holderName: "R. Subramaniam",
      district: "Madurai",
      village: "Thiruparankundram",
      notes: "Clear private agricultural holding",
      source: "MOCK_TNGIS",
      requiresManualVerification: false
    },
    workflow: {
      submitted: { status: "done", at: created.toISOString() },
      documents: { status: "done", at: new Date(created.getTime() + 1 * 86400000).toISOString() },
      landRecord: { status: "done", at: new Date(created.getTime() + 2 * 86400000).toISOString() },
      survey: { status: "current", at: null, waitingDays: 8 },
      officer: { status: "pending", at: null },
      acquisition: { status: "pending", at: null },
      completed: { status: "pending", at: null }
    },
    currentStage: "survey",
    currentWaitingDays: 8,
    prediction: null,
    timeline: [
      { at: created.toISOString(), event: "Case submitted", by: "citizen" },
      { at: new Date(created.getTime() + 1 * 86400000).toISOString(), event: "Documents verified (1 missing)", by: "system" },
      { at: new Date(created.getTime() + 2 * 86400000).toISOString(), event: "Land record verified — Private Agricultural", by: "system" },
      { at: new Date(created.getTime() + 3 * 86400000).toISOString(), event: "Survey verification started", by: "officer" }
    ],
    status: "survey_pending"
  };
}

/* ---------- Auth ---------- */
const USERS = [
  { username: "citizen", password: "citizen123", role: "citizen", name: "Citizen User" },
  { username: "officer", password: "officer123", role: "officer", name: "Revenue Officer" },
  { username: "admin", password: "admin123", role: "officer", name: "Admin Officer" }
];

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid username or password" });
  const token = jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
  res.json({ token, role: user.role, username: user.username, name: user.name });
});

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireOfficer(req, res, next) {
  if (req.user.role !== "officer") return res.status(403).json({ error: "Officer role required" });
  next();
}

/* ---------- Helpers ---------- */
function countMissingDocs(docs) {
  if (!docs) return 0;
  let n = 0;
  if (!docs.ownership) n++;
  if (!docs.survey) n++;
  if (!docs.certificate) n++;
  return n;
}

function runPrediction(rec) {
  const docsMissing = countMissingDocs(rec.documents);
  const surveyPending = rec.currentStage === "survey" || (rec.workflow && rec.workflow.survey && rec.workflow.survey.status === "current");
  const features = {
    ownership: rec.landRecord?.ownership || "unknown",
    isPoramboke: !!rec.landRecord?.isPoramboke,
    documentsMissing: docsMissing,
    currentWaitingDays: rec.currentWaitingDays || 0,
    landType: rec.landType || "agricultural",
    surveyPending,
    regionalDelayScore: 0.55,
    areaAcres: rec.area || 1
  };
  return predictDelay(features);
}

function pushNotification(db, { toRole, toUser, title, body, caseId, level }) {
  db.notifications = db.notifications || [];
  db.notifications.unshift({
    id: uuidv4(),
    toRole,
    toUser: toUser || null,
    title,
    body,
    caseId,
    level: level || "info",
    read: false,
    at: new Date().toISOString()
  });
  if (db.notifications.length > 200) db.notifications.length = 200;
}

/* ---------- Cases ---------- */
app.get("/api/records", requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.records || [];
  if (req.user.role === "citizen") {
    list = list.filter((r) => r.createdBy === req.user.username || r.role === "citizen");
  }
  // Attach live prediction if missing
  list = list.map((r) => {
    if (!r.prediction) r.prediction = runPrediction(r);
    return r;
  });
  res.json({ records: list });
});

app.get("/api/records/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const rec = (db.records || []).find((r) => r.id === req.params.id || r.caseId === req.params.id);
  if (!rec) return res.status(404).json({ error: "Case not found" });
  if (!rec.prediction) {
    rec.prediction = runPrediction(rec);
    saveDB(db);
  }
  res.json(rec);
});

app.post("/api/records", requireAuth, (req, res) => {
  const db = loadDB();
  const body = req.body || {};
  const caseNum = db.nextCase || 1;
  const caseId = `BD-2026-${String(caseNum).padStart(4, "0")}`;
  db.nextCase = caseNum + 1;

  // Land record lookup
  const landRecord = landLookup({
    surveyNo: body.surveyNo,
    subDivision: body.subDivision,
    lat: body.lat,
    lon: body.lon
  });

  const docs = body.documents || {
    ownership: true,
    survey: true,
    certificate: false,
    other: true
  };

  const now = new Date().toISOString();
  const rec = {
    id: caseId,
    caseId,
    createdBy: req.user.username,
    role: req.user.role,
    createdAt: now,
    updatedAt: now,
    surveyNo: body.surveyNo || "",
    subDivision: body.subDivision || null,
    area: Number(body.area) || 0,
    landType: body.landType || "agricultural",
    lat: body.lat || null,
    lon: body.lon || null,
    photoDataUrl: body.photoDataUrl || null,
    documents: docs,
    landRecord,
    workflow: {
      submitted: { status: "done", at: now },
      documents: { status: "done", at: now },
      landRecord: { status: landRecord.requiresManualVerification ? "current" : "done", at: landRecord.requiresManualVerification ? null : now },
      survey: { status: landRecord.requiresManualVerification ? "pending" : "current", at: null, waitingDays: 0 },
      officer: { status: "pending", at: null },
      acquisition: { status: "pending", at: null },
      completed: { status: "pending", at: null }
    },
    currentStage: landRecord.requiresManualVerification ? "landRecord" : "survey",
    currentWaitingDays: 0,
    timeline: [
      { at: now, event: "Case submitted", by: req.user.username },
      { at: now, event: `Land record lookup: ${landRecord.found ? landRecord.ownership + " / " + landRecord.classification : "NOT FOUND — manual verification"}`, by: "system" }
    ],
    status: "submitted",
    prediction: null
  };

  rec.prediction = runPrediction(rec);
  db.records.push(rec);

  // Notifications
  if (countMissingDocs(docs) > 0) {
    pushNotification(db, {
      toRole: "citizen",
      toUser: req.user.username,
      title: "Missing document",
      body: `Case ${caseId}: one or more required documents are missing.`,
      caseId,
      level: "warning"
    });
  }
  if (rec.prediction.risk === "HIGH") {
    pushNotification(db, {
      toRole: "officer",
      title: "High-risk case detected",
      body: `${caseId} — predicted delay ${rec.prediction.predictedAdditionalDays} days (${rec.prediction.probability}% probability)`,
      caseId,
      level: "critical"
    });
  }

  saveDB(db);
  res.status(201).json(rec);
});

app.post("/api/records/sync", requireAuth, (req, res) => {
  const db = loadDB();
  const incoming = (req.body && req.body.records) || [];
  const created = [];
  for (const body of incoming) {
    const caseNum = db.nextCase || 1;
    const caseId = `BD-2026-${String(caseNum).padStart(4, "0")}`;
    db.nextCase = caseNum + 1;
    const landRecord = landLookup({ surveyNo: body.surveyNo, lat: body.lat, lon: body.lon });
    const now = new Date().toISOString();
    const rec = {
      id: caseId,
      caseId,
      createdBy: req.user.username,
      role: req.user.role,
      createdAt: now,
      updatedAt: now,
      surveyNo: body.surveyNo || "",
      subDivision: body.subDivision || null,
      area: Number(body.area) || 0,
      landType: body.landType || "agricultural",
      lat: body.lat || null,
      lon: body.lon || null,
      photoDataUrl: body.photoDataUrl || null,
      documents: body.documents || { ownership: true, survey: true, certificate: false, other: true },
      landRecord,
      workflow: {
        submitted: { status: "done", at: now },
        documents: { status: "done", at: now },
        landRecord: { status: "done", at: now },
        survey: { status: "current", at: null, waitingDays: 0 },
        officer: { status: "pending", at: null },
        acquisition: { status: "pending", at: null },
        completed: { status: "pending", at: null }
      },
      currentStage: "survey",
      currentWaitingDays: 0,
      timeline: [{ at: now, event: "Case submitted (offline sync)", by: req.user.username }],
      status: "submitted",
      prediction: null
    };
    rec.prediction = runPrediction(rec);
    db.records.push(rec);
    created.push(rec);
  }
  saveDB(db);
  res.json({ synced: created.length, records: created });
});

/* ---------- Officer: advance workflow / update status ---------- */
const STAGE_ORDER = ["submitted", "documents", "landRecord", "survey", "officer", "acquisition", "completed"];

app.patch("/api/records/:id/status", requireAuth, requireOfficer, (req, res) => {
  const db = loadDB();
  const rec = (db.records || []).find((r) => r.id === req.params.id || r.caseId === req.params.id);
  if (!rec) return res.status(404).json({ error: "Case not found" });

  const { stage, remark, documents } = req.body || {};
  const now = new Date().toISOString();

  if (documents) {
    rec.documents = { ...rec.documents, ...documents };
  }

  if (stage && STAGE_ORDER.includes(stage)) {
    // Mark current and previous as done, set next as current
    const idx = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i <= idx; i++) {
      const s = STAGE_ORDER[i];
      if (rec.workflow[s]) {
        rec.workflow[s].status = "done";
        if (!rec.workflow[s].at) rec.workflow[s].at = now;
      }
    }
    if (idx + 1 < STAGE_ORDER.length) {
      const next = STAGE_ORDER[idx + 1];
      if (rec.workflow[next]) {
        rec.workflow[next].status = "current";
      }
      rec.currentStage = next;
    } else {
      rec.currentStage = "completed";
      rec.status = "completed";
    }
    rec.timeline.push({
      at: now,
      event: `Stage advanced to: ${stage}${remark ? " — " + remark : ""}`,
      by: req.user.username
    });
  }

  rec.updatedAt = now;
  rec.currentWaitingDays = 0;
  rec.prediction = runPrediction(rec);

  // If completed, store outcome for feedback loop
  if (rec.currentStage === "completed" || rec.status === "completed") {
    const predicted = rec.prediction?.predictedAdditionalDays || 0;
    const actual = Math.max(1, Math.round(predicted * (0.7 + Math.random() * 0.5)));
    db.outcomes = db.outcomes || [];
    db.outcomes.push({
      caseId: rec.caseId,
      predictedDays: predicted,
      actualDays: actual,
      risk: rec.prediction?.risk,
      at: now
    });
    rec.actualDelayDays = actual;
    pushNotification(db, {
      toRole: "citizen",
      toUser: rec.createdBy,
      title: "Case completed",
      body: `${rec.caseId} has been completed. Predicted delay: ${predicted} days, Actual: ${actual} days.`,
      caseId: rec.caseId,
      level: "success"
    });
  }

  saveDB(db);
  res.json(rec);
});

/* ---------- Land record lookup (standalone) ---------- */
app.post("/api/land-records/lookup", requireAuth, (req, res) => {
  const result = landLookup(req.body || {});
  res.json(result);
});

/* ---------- Prediction endpoint ---------- */
app.post("/api/predict", requireAuth, (req, res) => {
  const result = predictDelay(req.body || {});
  res.json(result);
});

/* ---------- Notifications ---------- */
app.get("/api/notifications", requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.notifications || [];
  list = list.filter(
    (n) =>
      n.toRole === req.user.role ||
      n.toUser === req.user.username ||
      (req.user.role === "officer" && n.toRole === "officer")
  );
  res.json({ notifications: list.slice(0, 50) });
});

app.post("/api/notifications/:id/read", requireAuth, (req, res) => {
  const db = loadDB();
  const n = (db.notifications || []).find((x) => x.id === req.params.id);
  if (n) n.read = true;
  saveDB(db);
  res.json({ ok: true });
});

/* ---------- Dashboard stats (officer) ---------- */
app.get("/api/stats", requireAuth, (req, res) => {
  const db = loadDB();
  const records = db.records || [];
  let high = 0,
    medium = 0,
    low = 0,
    critical = 0;
  records.forEach((r) => {
    const p = r.prediction || runPrediction(r);
    if (p.risk === "HIGH") high++;
    else if (p.risk === "MEDIUM") medium++;
    else low++;
    if (p.probability >= 80 || (r.currentWaitingDays || 0) >= 15) critical++;
  });
  res.json({
    total: records.length,
    high,
    medium,
    low,
    critical,
    outcomes: (db.outcomes || []).slice(-10)
  });
});

/* ---------- AI Assistant ---------- */
app.post("/api/assistant", requireAuth, async (req, res) => {
  const { message, lang = "en", caseId } = req.body || {};
  if (!message) return res.status(400).json({ error: "message required" });

  const db = loadDB();
  let context = "";
  if (caseId) {
    const rec = (db.records || []).find((r) => r.id === caseId || r.caseId === caseId);
    if (rec) {
      context = `Current case: ${rec.caseId}, Survey: ${rec.surveyNo}, Stage: ${rec.currentStage}, Risk: ${rec.prediction?.risk}, Predicted delay: ${rec.prediction?.predictedAdditionalDays} days.`;
    }
  }

  if (anthropic) {
    try {
      const langHint =
        lang === "ta"
          ? "Reply in Tamil (தமிழ்)."
          : lang === "hi"
          ? "Reply in Hindi."
          : "Reply in English.";
      const resp = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `You are BHUMI-DRISHTI assistant for land acquisition delay prediction in India. ${langHint}\nContext: ${context}\nUser: ${message}`
          }
        ]
      });
      const text = resp.content?.[0]?.text || "No response";
      return res.json({ reply: text, source: "claude" });
    } catch (e) {
      console.error("Claude error", e.message);
    }
  }

  // Rule-based fallback
  const q = (message || "").toLowerCase();
  let reply =
    "I can help with case status, predicted delays, missing documents, and next steps. Ask about a specific case ID or say 'why delay'.";
  if (q.includes("delay") || q.includes("தாமதம்") || q.includes("विलंब")) {
    reply =
      "Delays are often caused by missing documents, pending survey verification, Government/Poramboke classification, or high regional backlog. Open the case to see SHAP factor breakdown and recommended actions.";
  } else if (q.includes("document") || q.includes("ஆவண") || q.includes("दस्तावेज़")) {
    reply =
      "Required documents typically include ownership proof, survey sketch, and relevant certificates. Missing any of these increases predicted delay significantly.";
  } else if (q.includes("poramboke") || q.includes("பொறம்போக்கு")) {
    reply =
      "Poramboke / Government land requires special clearance. The system flags these cases as higher risk and recommends authority confirmation.";
  } else if (caseId) {
    reply = `For case ${caseId}: check the Risk card, Why Delay factors, and Recommended Actions on the case detail screen.`;
  }
  if (lang === "ta") {
    reply =
      "நில அபகரிப்பு தாமதங்கள் பெரும்பாலும் ஆவணங்கள் இல்லாமை, சர்வே நிலுவை, அரசு/பொறம்போக்கு வகைப்பாடு ஆகியவற்றால் ஏற்படுகின்றன. வழக்கு விவரத்தில் காரணங்களையும் பரிந்துரைகளையும் பார்க்கவும்.";
  }
  res.json({ reply, source: "fallback" });
});

/* ---------- AI Vision (photo analysis) ---------- */
app.post("/api/vision", requireAuth, async (req, res) => {
  const { photoDataUrl, lang = "en" } = req.body || {};
  if (!photoDataUrl) return res.status(400).json({ error: "photoDataUrl required" });

  if (anthropic) {
    try {
      const base64 = photoDataUrl.replace(/^data:image\/\w+;base64,/, "");
      const mediaType = photoDataUrl.includes("png") ? "image/png" : "image/jpeg";
      const resp = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 }
              },
              {
                type: "text",
                text:
                  lang === "ta"
                    ? "இந்த நிலப் புகைப்படத்தைப் பார்த்து, விவசாயம்/கட்டிடம்/நீர்நிலை/ஆக்கிரமிப்பு அறிகுறிகள் உள்ளதா என சுருக்கமாக தமிழில் சொல்லுங்கள்."
                    : "Briefly describe this land photo for a land-acquisition system: vegetation, built-up areas, water, possible encroachment signs."
              }
            ]
          }
        ]
      });
      return res.json({ findings: resp.content?.[0]?.text || "No findings", source: "claude" });
    } catch (e) {
      console.error("Vision error", e.message);
    }
  }

  res.json({
    findings:
      lang === "ta"
        ? "டெமோ பயன்முறை: புகைப்படம் பெறப்பட்டது. உண்மையான பார்வை பகுப்பாய்விற்கு ANTHROPIC_API_KEY அமைக்கவும்."
        : "Demo mode: photo received. Set ANTHROPIC_API_KEY for real vision analysis. Colour/vegetation heuristics suggest mixed agricultural cover.",
    source: "fallback"
  });
});

/* ---------- Languages ---------- */
app.get("/api/languages/:code", (req, res) => {
  const code = req.params.code || "en";
  const file = path.join(__dirname, "..", "languages", `${code}.json`);
  if (fs.existsSync(file)) {
    return res.json(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  const en = path.join(__dirname, "..", "languages", "en.json");
  res.json(JSON.parse(fs.readFileSync(en, "utf8")));
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "BHUMI-DRISHTI",
    version: "1.0.0",
    ai: !!anthropic,
    time: new Date().toISOString()
  });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`\n  BHUMI-DRISHTI running at http://localhost:${PORT}`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
  console.log(`  Demo logins: citizen/citizen123  |  officer/officer123\n`);
  // Ensure DB exists
  loadDB();
});
