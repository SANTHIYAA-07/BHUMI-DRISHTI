# BHUMI-DRISHTI Architecture (Prototype)

## Data flow

```
Citizen / Officer
       │
       ▼
  Photo + GPS + Survey No + Docs
       │
       ▼
  Land Record Provider (mock → real TNGIS later)
       │
       ▼
  Case + Workflow states
       │
       ▼
  Feature vector → Delay model (rule / ML)
       │
       ├─► Risk + Predicted days
       ├─► SHAP-style factor bars
       └─► Recommendations
       │
       ▼
  Officer action → Status update
       │
       ▼
  Notifications (citizen + officer)
       │
       ▼
  Outcome (predicted vs actual) → feedback store
```

## Roles
- **Citizen**: submit cases, view own cases, documents, notifications, assistant
- **Officer**: all cases, stats, advance workflow, complete cases, high-risk queue

## Extending land records
Implement the same shape as `mock_provider.lookup()`:
```js
{
  found, surveyNo, ownership, classification,
  isPoramboke, isPatta, holderName, district, village,
  notes, source, confidence, requiresManualVerification
}
```
