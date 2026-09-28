/**
 * Mock Land Record Provider
 * Simulates official GIS / land-record responses for SIH demo.
 * In production: replace with real TNGIS / DILRMP / Bhu-Naksha adapters.
 */

const MOCK_RECORDS = {
  "125/2A": {
    ownership: "private",
    classification: "agricultural",
    patta: true,
    poramboke: false,
    holder: "R. Subramaniam",
    district: "Madurai",
    village: "Thiruparankundram",
    area_acres: 2.5,
    notes: "Clear private agricultural holding"
  },
  "88/1": {
    ownership: "government",
    classification: "waterbody",
    patta: false,
    poramboke: true,
    holder: "Government of Tamil Nadu",
    district: "Tiruchirappalli",
    village: "Srirangam",
    area_acres: 1.2,
    notes: "Waterbody Poramboke — acquisition restricted"
  },
  "42/3B": {
    ownership: "government",
    classification: "poramboke",
    patta: false,
    poramboke: true,
    holder: "Government",
    district: "Coimbatore",
    village: "Sulur",
    area_acres: 0.8,
    notes: "Poramboke land — requires special clearance"
  },
  "201/5": {
    ownership: "private",
    classification: "residential",
    patta: true,
    poramboke: false,
    holder: "K. Lakshmi",
    district: "Chennai",
    village: "Tambaram",
    area_acres: 0.3,
    notes: "Private residential plot"
  },
  "67/4": {
    ownership: "private",
    classification: "agricultural",
    patta: true,
    poramboke: false,
    holder: "M. Ravi",
    district: "Salem",
    village: "Attur",
    area_acres: 4.0,
    notes: "Large private farm"
  }
};

/**
 * Lookup by survey number (and optional lat/lon for future GIS matching)
 */
function lookup({ surveyNo, subDivision, lat, lon, state = "TN" }) {
  const key = (surveyNo || "").trim().toUpperCase();
  const found = MOCK_RECORDS[key] || MOCK_RECORDS[surveyNo];

  if (found) {
    return {
      found: true,
      surveyNo: key,
      subDivision: subDivision || null,
      ownership: found.ownership,
      classification: found.classification,
      isPoramboke: !!found.poramboke,
      isPatta: !!found.patta,
      holderName: found.holder,
      district: found.district,
      village: found.village,
      recordedArea: found.area_acres,
      notes: found.notes,
      source: "MOCK_TNGIS",
      confidence: 0.92,
      requiresManualVerification: false
    };
  }

  // Simulate "not found" → manual verification path
  return {
    found: false,
    surveyNo: key,
    subDivision: subDivision || null,
    ownership: "unknown",
    classification: "unknown",
    isPoramboke: false,
    isPatta: false,
    holderName: null,
    district: null,
    village: null,
    recordedArea: null,
    notes: "Record not found in demo database. Manual verification required.",
    source: "MOCK_TNGIS",
    confidence: 0,
    requiresManualVerification: true
  };
}

module.exports = { lookup, MOCK_RECORDS };
