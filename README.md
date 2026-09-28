# BHUMI-DRISHTI — SIH 2026 Final Prototype

**Early Prediction of Land Acquisition Delays**

One-sentence summary:  
Collect land information → verify with authoritative (mock) records → monitor acquisition workflow → predict delays → explain reasons (SHAP-style) → recommend actions → alert officers → learn from outcomes.

---

## Quick start (2 terminals or one)

### Requirements
- Node.js 18+
- Modern browser (Chrome/Edge recommended for camera, GPS, voice)

### 1. Install
```bash
cd BHUMI-DRISHTI-FINAL
cp .env.example .env
npm install
```

### 2. Run (serves both API + frontend)
```bash
npm start
```
Open **http://localhost:3000**

### Demo logins
| Username | Password   | Role    |
|----------|------------|---------|
| citizen  | citizen123 | Citizen |
| officer  | officer123 | Officer |
| admin    | admin123   | Officer |

---

## What this prototype demonstrates

| Feature | Status |
|---------|--------|
| Citizen / Officer separate logins (JWT) | ✅ |
| Photo capture + compression + GPS | ✅ |
| Survey number + area + land type | ✅ |
| Land-record lookup (mock TNGIS) | ✅ |
| Document checklist | ✅ |
| Full acquisition workflow stepper | ✅ |
| ML-style delay prediction + risk | ✅ |
| Explainable factors (SHAP-style bars) | ✅ |
| Recommended officer actions | ✅ |
| Officer console + stage advancement | ✅ |
| Smart notifications | ✅ |
| Multilingual UI (EN / தமிழ் / हिन्दी) | ✅ |
| Voice input + TTS assistant | ✅ |
| Leaflet map + case location | ✅ |
| Predicted vs actual outcome storage | ✅ |
| Offline-friendly structure (sync API) | ✅ |
| Claude AI assistant + vision (optional key) | ✅ |

---

## Try these survey numbers (mock land records)

| Survey No | Result |
|-----------|--------|
| **125/2A** | Private agricultural (Madurai) — demo seed case BD-2026-0012 |
| **88/1**   | Government waterbody **Poramboke** (high risk path) |
| **42/3B**  | Government Poramboke |
| **201/5**  | Private residential (Chennai) |
| **67/4**   | Large private farm |
| Any other  | Not found → manual verification |

---

## Suggested demo script for SIH judges (8–10 min)

1. **Login as citizen** → show new case form.
2. Enter Survey **88/1**, area 1.2, uncheck “Required certificate”, get GPS (or leave blank), submit.
3. Open the new case → show **Poramboke** land-record result, **HIGH risk**, SHAP bars (missing doc + poramboke + survey), recommendations.
4. **Login as officer** → stats bar, priority case, open same case, advance stages (Survey Done → … → Complete Case).
5. Show notification + outcome (predicted vs actual days) after completion.
6. Switch language to **தமிழ்** / **हिन्दी**.
7. Use **Ask Assistant** + mic (optional).
8. Mention production path: real TNGIS/DILRMP adapter, PostgreSQL+PostGIS, trained XGBoost+SHAP, Bhashini voice.

---

## Project structure

```
BHUMI-DRISHTI-FINAL/
├── frontend/
│   └── index.html          # Full citizen + officer UI
├── backend/
│   ├── server.js           # Express API (auth, cases, workflow, AI)
│   └── data/               # db.json created on first run
├── ml/
│   └── predict.js          # Delay model + SHAP-style factors
├── integrations/
│   └── land_records/
│       └── mock_provider.js
├── languages/
│   ├── en.json
│   ├── ta.json
│   └── hi.json
├── package.json
├── .env.example
└── README.md
```

---

## Optional: real Claude AI

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Restarts enable real assistant replies and photo vision analysis. Without the key, rule-based fallbacks keep the demo working.

---

## Land records — important note for evaluators

Live government GIS/land-record APIs (TNGIS, DILRMP, Bhu-Naksha) require official credentials and agreements.  

This prototype uses a **clean provider interface + realistic mock data** so the full pipeline (lookup → features → prediction → explanation → action) can be demonstrated.  

Production next step: swap `mock_provider.js` for a real adapter that calls authorised state APIs; the rest of the system stays the same.

---

## Team next steps (beyond this zip)

1. Migrate `db.json` → PostgreSQL + PostGIS  
2. Train real model on historical acquisition cases + retrain loop  
3. Integrate Bhashini for production-grade multilingual voice  
4. Add more languages (te, kn, ml, mr, bn) using the same JSON pattern  
5. Deploy backend (Render/Railway) + frontend (Vercel/Netlify) with HTTPS  

---

**BHUMI-DRISHTI** · Smart India Hackathon 2026  
*Understand the land. Predict the delay. Act before it grows.*
