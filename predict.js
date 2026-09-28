/**
 * Mock ML Delay Prediction + SHAP-style explanations
 * Rule-based + weighted features for realistic SIH demo.
 * In production: replace with trained XGBoost / LightGBM + real SHAP.
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Predict delay risk and days from case features
 */
function predictDelay(features) {
  const {
    ownership = "private",
    isPoramboke = false,
    documentsMissing = 0,
    currentWaitingDays = 0,
    landType = "agricultural",
    surveyPending = false,
    regionalDelayScore = 0.4, // 0–1 historical
    areaAcres = 1
  } = features;

  // Feature contributions (weights) — used for "SHAP-like" explanation
  const contributions = {
    missingDocuments: documentsMissing * 12,
    surveyPending: surveyPending ? 18 : 0,
    porambokeOrGovt: (isPoramboke || ownership === "government") ? 14 : 0,
    currentWaiting: Math.min(currentWaitingDays * 1.2, 20),
    regionalHistory: regionalDelayScore * 15,
    largeArea: areaAcres > 3 ? 6 : 0,
    landTypeComplex: ["forest", "waterbody"].includes(landType) ? 8 : 0
  };

  const rawScore = Object.values(contributions).reduce((a, b) => a + b, 0);
  const delayDays = Math.round(clamp(rawScore * 0.9 + 3, 2, 45));
  const probability = clamp(rawScore / 70, 0.08, 0.95);

  let risk = "LOW";
  if (probability >= 0.65 || delayDays >= 20) risk = "HIGH";
  else if (probability >= 0.35 || delayDays >= 10) risk = "MEDIUM";

  // Normalize contributions to percentages for UI bars
  const total = Object.values(contributions).reduce((a, b) => a + b, 0) || 1;
  const shap = Object.entries(contributions)
    .map(([factor, value]) => ({
      factor,
      value: Math.round(value * 10) / 10,
      percent: Math.round((value / total) * 100)
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.percent - a.percent);

  // Human-readable recommendations
  const recommendations = [];
  if (documentsMissing > 0) {
    recommendations.push({
      priority: "HIGH",
      action: "Complete missing document verification immediately",
      code: "DOC_MISSING"
    });
  }
  if (surveyPending) {
    recommendations.push({
      priority: "HIGH",
      action: "Prioritize pending survey verification",
      code: "SURVEY_PENDING"
    });
  }
  if (isPoramboke || ownership === "government") {
    recommendations.push({
      priority: "MEDIUM",
      action: "Confirm Government / Poramboke classification with concerned authority",
      code: "GOVT_CHECK"
    });
  }
  if (risk === "HIGH") {
    recommendations.push({
      priority: "HIGH",
      action: "Escalate case to senior officer for review",
      code: "ESCALATE"
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      priority: "LOW",
      action: "Continue standard processing. Monitor timeline.",
      code: "CONTINUE"
    });
  }

  return {
    risk,
    probability: Math.round(probability * 100),
    predictedAdditionalDays: delayDays,
    shapFactors: shap,
    recommendations,
    modelVersion: "demo-v1.0-rule",
    generatedAt: new Date().toISOString()
  };
}

module.exports = { predictDelay };
