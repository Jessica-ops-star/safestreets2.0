/**
 * ============================================================
 * SAFETY SCORE ENGINE
 * ============================================================
 *
 * Uses:
 *   1. Trained ML model (Flask API) for historical risk
 *   2. Rule-based community report risk
 *   3. Danger-zone penalties
 *   4. 40% Historical Risk + 60% Community Risk
 *
 * Displayed Safety Score:
 *   100 - (40% Historical Risk + 60% Community Risk)
 *
 * Internal Route Risk:
 *   Displayed Risk + Danger Zone Penalty
 *
 * IMPORTANT:
 * The ML model is responsible for LEARNING historical risk
 * from the training data.
 *
 * Community reports and danger zones remain explicit rules
 * because they are live/dynamic route information.
 * ============================================================
 */


// ============================================================
// CONFIGURATION
// ============================================================

const ML_API_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ML_API_URL) ||
  "http://127.0.0.1:5000/predict";

const HISTORICAL_WEIGHT = 0.4;
const COMMUNITY_WEIGHT = 0.6;


// ============================================================
// COMMUNITY REPORT BASE RISKS
// ============================================================

const NEGATIVE_REPORT_RISK_WEIGHTS = {
  "Assault / Violence": 40,
  "Assault": 40,
  "Violence": 40,
  "Harassment": 35,
  "Theft / Pickpocketing": 30,
  "Theft": 30,
  "Pickpocketing": 30,
  "Robbery": 35,
  "Suspicious Activity": 25,
  "Isolated Area": 25,
  "Drunk People": 20,
  "Poor Lighting": 20,
  "Reckless Driving": 15,
  "Road Hazard": 12,
  "Stray Animal Threat": 10,
  "Other": 5
};


const POSITIVE_REPORT_RISK_WEIGHTS = {
  "Police Presence": -25,
  "Police Patrol": -25,
  "Guarded Premises": -20,
  "Brightly Lit Street": -18,
  "Busy Area": -15,
  "High Foot Traffic": -12,
  "Felt Safe": -10
};


// ============================================================
// RATING MULTIPLIERS
// ============================================================

const POSITIVE_RATING_MULTIPLIERS = {
  1: 0.6,
  2: 0.8,
  3: 1.0,
  4: 1.2,
  5: 1.5
};

const NEGATIVE_RATING_MULTIPLIERS = {
  1: 1.5,
  2: 1.2,
  3: 1.0,
  4: 0.8,
  5: 0.6
};


// ============================================================
// DISTANCE MULTIPLIER
// ============================================================

export function getDistanceMultiplier(distMeters) {
  const dist = Number(distMeters) || 0;

  if (dist <= 50) return 1.00;
  if (dist <= 100) return 0.90;
  if (dist <= 250) return 0.75;
  if (dist <= 500) return 0.50;
  if (dist <= 750) return 0.30;
  if (dist <= 1000) return 0.10;

  return 0.00;
}


// ============================================================
// TIME CYCLES
// ============================================================

const TIME_CYCLES = [
  "Morning",
  "Afternoon",
  "Evening",
  "Night",
  "Critical Hours"
];


// ============================================================
// CURRENT TIME CYCLE
// ============================================================

export function getCurrentTimeCycle(date = new Date()) {
  const hour = date.getHours();

  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 21) return "Evening";
  if (hour >= 21 || hour < 2) return "Night";

  return "Critical Hours";
}


// ============================================================
// NORMALIZE REPORT CATEGORY
// ============================================================

export function normalizeReportCategory(categoryInput, reportTypeInput) {
  const input = String(categoryInput || reportTypeInput || "").trim();
  if (!input) return "Other";

  const lower = input.toLowerCase();

  // Positive categories
  if (lower.includes("police patrol") || lower.includes("patrol")) return "Police Patrol";
  if (lower.includes("police") || lower.includes("cop") || lower.includes("station")) return "Police Presence";
  if (lower.includes("guarded") || lower.includes("security guard")) return "Guarded Premises";
  if (lower.includes("bright") || lower.includes("well lit") || lower.includes("good lighting")) return "Brightly Lit Street";
  if (lower.includes("busy") || lower.includes("foot traffic") || lower.includes("crowded")) return "Busy Area";
  if (lower.includes("felt safe") || lower.includes("safe_zone") || lower.includes("safe zone")) return "Felt Safe";

  // Negative categories
  if (lower.includes("assault") || lower.includes("attack") || lower.includes("battery")) return "Assault";
  if (lower.includes("violence") || lower.includes("fight")) return "Violence";
  if (lower.includes("harass") || lower.includes("stalk") || lower.includes("eve teasing") || lower.includes("catcall")) return "Harassment";
  if (lower.includes("pickpocket")) return "Pickpocketing";
  if (lower.includes("theft") || lower.includes("steal") || lower.includes("snatch")) return "Theft";
  if (lower.includes("robbery") || lower.includes("mugging") || lower.includes("burglary")) return "Robbery";
  if (lower.includes("suspicious") || lower.includes("loitering")) return "Suspicious Activity";
  if (lower.includes("isolated") || lower.includes("dark alley") || lower.includes("lonely")) return "Isolated Area";
  if (lower.includes("drunk") || lower.includes("brawl") || lower.includes("substance")) return "Drunk People";
  if (lower.includes("poor lighting") || lower.includes("dark") || lower.includes("no light")) return "Poor Lighting";
  if (lower.includes("reckless") || lower.includes("overspeeding")) return "Reckless Driving";
  if (lower.includes("hazard") || lower.includes("accident") || lower.includes("obstacle")) return "Road Hazard";
  if (lower.includes("animal") || lower.includes("dog")) return "Stray Animal Threat";

  return "Other";
}

// ============================================================
// NORMALIZE TIME CYCLE
// ============================================================

export function normalizeTimeCycle(value) {
  if (!value) return "Morning";

  const str = String(value).toLowerCase();

  if (str.includes("morning")) return "Morning";
  if (str.includes("afternoon")) return "Afternoon";
  if (str.includes("evening")) return "Evening";
  if (str.includes("late") || str.includes("critical")) return "Critical Hours";
  if (str.includes("night")) return "Night";
  if (str === "day" || str.includes("daytime")) return "Afternoon";

  return "Morning";
}


// ============================================================
// CROWD DENSITY PARSER
// ============================================================

export function parseCrowdDensity(value) {
  if (typeof value === "number" && !isNaN(value)) {
    return Math.max(0, Math.min(100, value));
  }
  if (!value) return 50;

  const num = Number(value);
  if (!isNaN(num)) {
    return Math.max(0, Math.min(100, num));
  }

  const str = String(value).toLowerCase();
  if (str.includes("very high")) return 90;
  if (str.includes("high")) return 75;
  if (str.includes("medium") || str.includes("moderate")) return 50;
  if (str.includes("very low")) return 15;
  if (str.includes("low")) return 25;

  return 50;
}


// ============================================================
// TIME MULTIPLIER
// ============================================================

export function getTimeMultiplier(
  reportTimeCycle,
  currentTimeCycle = getCurrentTimeCycle()
) {
  if (
    !reportTimeCycle ||
    reportTimeCycle === "Anytime" ||
    reportTimeCycle === "Historical Record"
  ) {
    return 1.0;
  }

  const curr = normalizeTimeCycle(currentTimeCycle);
  const rep = normalizeTimeCycle(reportTimeCycle);

  if (curr === rep) return 1.2;

  // Daytime broad compatibility (Day/Afternoon during Morning/Afternoon/Evening)
  const isCurrDaytime = curr === "Morning" || curr === "Afternoon" || curr === "Evening";
  const isRepDaytime = String(reportTimeCycle).toLowerCase() === "day" || rep === "Afternoon" || rep === "Morning";
  if (isCurrDaytime && isRepDaytime) return 1.0;

  const idxCurr = TIME_CYCLES.indexOf(curr);
  const idxRep = TIME_CYCLES.indexOf(rep);

  if (idxCurr !== -1 && idxRep !== -1) {
    const diff = Math.abs(idxCurr - idxRep);

    if (
      diff === 1 ||
      diff === TIME_CYCLES.length - 1
    ) {
      return 1.0;
    }
  }

  return 0.8;
}


// ============================================================
// REPORT AGE MULTIPLIER
// ============================================================

export function getReportAgeMultiplier(createdAt) {
  const dateVal = typeof createdAt === "object" ? (createdAt?.created_at || createdAt?.created_date) : createdAt;
  if (!dateVal) return 1.0;

  try {
    const reportDate = new Date(dateVal);

    if (isNaN(reportDate.getTime())) {
      return 1.0;
    }

    const diffMs = Date.now() - reportDate.getTime();

    const diffDays = Math.max(
      0,
      Math.floor(diffMs / (1000 * 60 * 60 * 24))
    );

    if (diffDays <= 7) return 1.0;
    if (diffDays <= 30) return 0.8;
    if (diffDays <= 180) return 0.6;
    if (diffDays <= 365) return 0.4;

    return 0.2;

  } catch {
    return 1.0;
  }
}


// ============================================================
// SAFETY LEVELS
// ============================================================

export function getSafetyLevel(score) {
  const rounded = Math.round(Number(score) || 0);

  if (rounded >= 90) {
    return {
      level: "Very Safe",
      badge: "🟢 Very Safe",
      color: "emerald",
      bgClass: "bg-emerald-500",
      textClass: "text-emerald-700"
    };
  }

  if (rounded >= 75) {
    return {
      level: "Safe",
      badge: "🟢 Safe",
      color: "emerald",
      bgClass: "bg-emerald-600",
      textClass: "text-emerald-600"
    };
  }

  if (rounded >= 60) {
    return {
      level: "Moderately Safe",
      badge: "🟡 Moderately Safe",
      color: "amber",
      bgClass: "bg-amber-500",
      textClass: "text-amber-700"
    };
  }

  if (rounded >= 40) {
    return {
      level: "Caution",
      badge: "🟠 Caution",
      color: "orange",
      bgClass: "bg-orange-500",
      textClass: "text-orange-700"
    };
  }

  if (rounded >= 20) {
    return {
      level: "Unsafe",
      badge: "🔴 Unsafe",
      color: "rose",
      bgClass: "bg-rose-600",
      textClass: "text-rose-700"
    };
  }

  return {
    level: "High Risk",
    badge: "🚨 High Risk",
    color: "red",
    bgClass: "bg-red-700",
    textClass: "text-red-700"
  };
}


// ============================================================
// DEFAULT RESULT
// ============================================================

function createDefaultResult() {
  const currentTimeCycle = getCurrentTimeCycle();
  const levelInfo = getSafetyLevel(100);

  return {
    finalScore: 100,
    displayedSafetyScore: 100,

    internalRouteRisk: 0,
    finalRouteRankingScore: 100,

    safetyLevel: levelInfo.level,
    safetyBadge: levelInfo.badge,

    color: levelInfo.color,

    baseScore: 100,

    historicalRisk: 0,
    historicalRiskDisplay: 0,

    communityRisk: 0,
    communityRiskDisplay: 0,

    weightedHistoricalRisk: 0,
    weightedCommunityRisk: 0,

    totalRisk: 0,

    totalDangerPenalty: 0,
    penetratedDangerZones: [],

    densityMultiplier: 1,

    historicalRecordsCount: 0,
    communityReportsCount: 0,

    communityReportContributions: [],

    topPositiveFactors: [],
    topNegativeFactors: [],

    mlPredictionUsed: false,

    summary: {
      baseScore: 100,
      displayedSafetyScoreFormatted: "100 / 100",
      internalRouteRiskFormatted: "0.0",
      dangerPenaltyFormatted: "0.0",
      historicalRiskDisplayFormatted: "0 / 100",
      communityRiskDisplayFormatted: "0 / 100",
      totalRiskFormatted: "0.0",
      densityMultiplierFormatted: "×1.0",
      currentTimeCycle,
      finalScoreFormatted: "100 / 100"
    }
  };
}


// ============================================================
// ML MODEL REQUEST
// ============================================================

let mlWarningLogged = false;

async function getMLHistoricalRisk(features) {
  try {
    const response = await fetch(ML_API_URL, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        crime_count: Number(features.crime_count ?? 0),
        crime_type: features.crime_type ?? "Other",
        time_of_day: features.time_of_day ?? "Morning",
        current_time: features.current_time ?? getCurrentTimeCycle(),
        lighting_score: Number(features.lighting_score ?? 5),
        police_station_distance_km: Number(features.police_station_distance_km ?? 2),
        crowd_density: Number(features.crowd_density ?? 50),
        weather_condition: features.weather_condition ?? "Clear",
        distance_from_route: Number(features.distance_from_route ?? 0)
      })
    });

    if (!response.ok) {
      throw new Error(`ML API returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (
      !result ||
      result.success !== true ||
      result.historical_risk == null ||
      isNaN(Number(result.historical_risk))
    ) {
      throw new Error(result?.error || "Invalid ML prediction response");
    }

    return Math.max(0, Number(result.historical_risk));

  } catch (error) {
    if (!mlWarningLogged) {
      console.warn("ML historical-risk prediction API unavailable (using rule-based fallback):", error.message);
      mlWarningLogged = true;
    }
    return null;
  }
}


// ============================================================
// EXTRACT HISTORICAL FEATURES
// ============================================================

export function extractHistoricalFeatures(report) {
  const raw = report?.raw || report || {};

  let rawPoliceDist =
    report?.police_station_distance_km ??
    raw.police_station_distance_km;

  if (rawPoliceDist == null) {
    const distRaw = report?.police_station_distance ?? raw.police_station_distance;
    if (distRaw != null && !isNaN(Number(distRaw))) {
      const numDist = Number(distRaw);
      rawPoliceDist = numDist > 50 ? numDist / 1000 : numDist;
    }
  }

  const police_station_distance_km =
    rawPoliceDist != null && !isNaN(Number(rawPoliceDist))
      ? Number(rawPoliceDist)
      : 2.0;

  const rawCrowdDensity =
    report?.crowd_density ??
    raw.crowd_density ??
    50;

  const crowd_density = parseCrowdDensity(rawCrowdDensity);

  const rawTimeOfDay =
    report?.time_of_day ??
    raw.time_of_day ??
    report?.time_cycle ??
    raw.time_cycle;

  const time_of_day = normalizeTimeCycle(rawTimeOfDay);

  return {
    crime_count: Number(
      report?.crime_count ??
      raw.crime_count ??
      report?.crimeCount ??
      raw.crimeCount ??
      0
    ),

    crime_type:
      report?.crime_type ??
      raw.crime_type ??
      report?.category ??
      raw.category ??
      report?.report_type ??
      "Other",

    time_of_day,

    current_time:
      report?.current_time ??
      raw.current_time ??
      getCurrentTimeCycle(),

    lighting_score: Number(
      report?.lighting_score ??
      raw.lighting_score ??
      report?.lightingScore ??
      raw.lightingScore ??
      5
    ),

    police_station_distance_km,

    crowd_density,

    weather_condition:
      report?.weather_condition ??
      raw.weather_condition ??
      "Clear",

    distance_from_route: Number(
      report?.distance_from_route ??
      raw.distance_from_route ??
      report?.distanceFromRoute ??
      raw.distanceFromRoute ??
      0
    )
  };
}


// ============================================================
// FALLBACK HISTORICAL RISK
// ============================================================

export function calculateRuleBasedHistoricalRisk(historicalReports) {
  if (
    !Array.isArray(historicalReports) ||
    historicalReports.length === 0
  ) {
    return 0;
  }

  let totalRisk = 0;

  historicalReports.forEach((item) => {
    const raw = item?.raw || item || {};

    const crimeCount = Number(
      item?.crime_count ??
      raw.crime_count ??
      item?.crimeCount ??
      raw.crimeCount ??
      0
    );

    const crimeType =
      item?.crime_type ??
      raw.crime_type ??
      item?.category ??
      raw.category ??
      item?.report_type ??
      "Other";

    let crimeRisk = 0;

    if (crimeCount <= 5) crimeRisk = 0;
    else if (crimeCount <= 10) crimeRisk = 5;
    else if (crimeCount <= 20) crimeRisk = 10;
    else if (crimeCount <= 30) crimeRisk = 18;
    else if (crimeCount <= 40) crimeRisk = 25;
    else crimeRisk = 35;

    const type = String(crimeType).toLowerCase();

    if (type.includes("assault")) {
      crimeRisk += 20;
    } else if (
      type.includes("harassment") ||
      type.includes("stalking")
    ) {
      crimeRisk += 18;
    } else if (type.includes("violence")) {
      crimeRisk += 18;
    } else if (
      type.includes("robbery") ||
      type.includes("burglary")
    ) {
      crimeRisk += 15;
    } else if (
      type.includes("theft") ||
      type.includes("pickpocketing") ||
      type.includes("stealing")
    ) {
      crimeRisk += 12;
    } else if (type.includes("suspicious")) {
      crimeRisk += 10;
    } else if (
      type.includes("hazard") ||
      type.includes("accident")
    ) {
      crimeRisk += 6;
    } else {
      crimeRisk += 5;
    }

    const distance = Number(
      item?.distance_from_route ??
      raw.distance_from_route ??
      0
    );

    const distanceMultiplier = getDistanceMultiplier(distance);

    totalRisk += crimeRisk * distanceMultiplier;
  });

  return totalRisk / historicalReports.length;
}


// ============================================================
// COMPONENT RISK TABLES FOR UNIT TEST COMPATIBILITY
// ============================================================

export function getCrimeCountRisk(crime_count) {
  if (crime_count <= 5) return 0;
  if (crime_count <= 10) return 5;
  if (crime_count <= 20) return 10;
  if (crime_count <= 30) return 18;
  if (crime_count <= 40) return 25;
  return 35;
}

export function getCrimeTypeRisk(crime_type) {
  const type = String(crime_type).toLowerCase();
  if (type.includes("assault")) return 20;
  if (type.includes("harassment") || type.includes("stalking")) return 18;
  if (type.includes("violence")) return 18;
  if (type.includes("robbery") || type.includes("burglary")) return 15;
  if (type.includes("theft") || type.includes("pickpocketing") || type.includes("stealing")) return 12;
  if (type.includes("suspicious")) return 10;
  if (type.includes("hazard") || type.includes("accident")) return 6;
  return 5;
}

export function getLightingRisk(lighting_score) {
  if (lighting_score >= 9) return 0;
  if (lighting_score >= 7) return 3;
  if (lighting_score >= 5) return 8;
  if (lighting_score >= 3) return 15;
  return 20;
}

export function getPoliceDistanceRisk(distance) {
  const distKm = distance > 50 ? distance / 1000 : distance;
  if (distKm <= 0.5) return 0;
  if (distKm <= 1) return 2;
  if (distKm <= 2) return 5;
  if (distKm <= 3) return 10;
  return 15;
}

export function getCrowdDensityRisk(density) {
  const parsed = parseCrowdDensity(density);
  if (parsed >= 80) return 0;
  if (parsed >= 60) return 2;
  if (parsed >= 40) return 5;
  if (parsed >= 20) return 10;
  return 15;
}

export function getHistoricalDensityMultiplier(count) {
  if (count <= 5) return 1.0;
  if (count <= 10) return 1.2;
  if (count <= 20) return 1.5;
  if (count <= 30) return 1.8;
  if (count <= 50) return 2.0;
  return 2.5;
}

export async function getMLHistoricalRiskBatch(records) {
  if (!Array.isArray(records) || records.length === 0) return [];

  const batchUrl = ML_API_URL.replace(/\/predict\/?$/, "/predict_batch");

  try {
    const payload = {
      records: records.map((rep) => extractHistoricalFeatures(rep))
    };

    const response = await fetch(batchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`ML Batch API returned HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result || result.success !== true || !Array.isArray(result.predictions)) {
      throw new Error(result?.error || "Invalid ML batch response format");
    }

    return result.predictions;
  } catch (err) {
    if (!mlWarningLogged) {
      console.warn("ML batch API unavailable (falling back to single ML or rule-based fallback):", err.message);
      mlWarningLogged = true;
    }
    return null;
  }
}

// Helper to aggregate historical predictions with frequency/density awareness
export function calculateAggregatedHistoricalRisk(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) return 0;
  const valid = predictions.map(Number).filter((p) => !isNaN(p) && p >= 0);
  if (valid.length === 0) return 0;

  const meanRisk = valid.reduce((a, b) => a + b, 0) / valid.length;
  // Bounded frequency scaling: 1.0 + 0.25 * (N / (N + 15)) -> Range [1.00, 1.25]
  const countFactor = 1.0 + 0.25 * (valid.length / (valid.length + 15));
  const aggregated = meanRisk * countFactor;
  return Math.min(100, Math.round(aggregated * 10) / 10);
}

// ============================================================
// VALIDATION & CONFIDENCE MULTIPLIERS FOR COMMUNITY REPORTS
// ============================================================

export function getValidationStatusMultiplier(report) {
  if (!report) return 0.0;

  const status = String(report.status || "").toUpperCase();
  const corrCount = Number(report.corroboration_count || 0);
  const hasEvidence = Boolean(report.has_evidence || report.evidence_url || report.verified);

  // 1. Stale / Expired check:
  // If report is > 24 hours old with 0 corroborations, or status is EXPIRED -> 0.0x weight
  const dateVal = report.created_at || report.created_date;
  if (status === "EXPIRED") return 0.0;
  if (dateVal && status === "PROVISIONAL") {
    try {
      const repDate = new Date(dateVal);
      if (!isNaN(repDate.getTime())) {
        const ageHours = (Date.now() - repDate.getTime()) / (1000 * 60 * 60);
        if (ageHours > 24 && corrCount === 0) {
          return 0.0; // Stale report risk decays completely
        }
      }
    } catch {}
  }

  // 2. Verified / Evidence-Backed -> Strongest positive safety-score contribution (3.0x multiplier)
  if (hasEvidence || status === "VERIFIED") {
    return 3.0;
  }

  // 3. Corroborated -> Positive safety-score contribution (1.5x to 2.5x based on peer corroboration count)
  if (status === "CORROBORATED" || corrCount > 0) {
    return Math.min(2.5, 1.5 + 0.2 * corrCount);
  }

  // 4. Default PROVISIONAL / UNVERIFIED -> 0.0x (MUST NOT affect safety score until validated/corroborated)
  return 0.0;
}


// ============================================================
// MAIN SAFETY SCORE ENGINE
// ============================================================

export async function calculateSafetyScoreEngine(analysisResult) {
  if (!analysisResult) {
    return createDefaultResult();
  }

  const {
    positiveReports = [],
    negativeReports = [],
    historicalReports = []
  } = analysisResult;

  const currentTimeCycle = getCurrentTimeCycle();


  // ==========================================================
  // 1. HISTORICAL RISK (BATCH ML PREDICTIONS)
  // ==========================================================

  let historicalRisk = 0;
  let mlPredictionUsed = false;
  let densityMultiplier = 1.0;

  const numHistRecords = Array.isArray(historicalReports)
    ? historicalReports.length
    : 0;

  if (numHistRecords > 0) {
    densityMultiplier = Math.round((1.0 + 0.25 * (numHistRecords / (numHistRecords + 15))) * 10) / 10;
    let predictions = await getMLHistoricalRiskBatch(historicalReports);

    if (!predictions && numHistRecords <= 30) {
      const singlePromises = historicalReports.map((report) => getMLHistoricalRisk(extractHistoricalFeatures(report)));
      const singleResults = await Promise.all(singlePromises);
      predictions = singleResults.filter((p) => p !== null && !isNaN(p));
    }

    if (predictions && predictions.length > 0) {
      historicalRisk = calculateAggregatedHistoricalRisk(predictions);
      mlPredictionUsed = true;
    } else {
      const baseRuleRisk = calculateRuleBasedHistoricalRisk(historicalReports);
      const countFactor = 1.0 + 0.25 * (numHistRecords / (numHistRecords + 15));
      historicalRisk = Math.min(100, Math.round(baseRuleRisk * countFactor * 10) / 10);
    }
  }


  // ==========================================================
  // 2. COMMUNITY REPORT RISK (BOUNDED SATURATION NORMALIZATION)
  // ==========================================================

  let communityRiskTotal = 0;
  const communityReportContributions = [];
  const positiveFactorDetails = [];
  const negativeFactorDetails = [];

  // POSITIVE REPORTS
  (positiveReports || []).forEach((rep) => {
    const normalizedCat = normalizeReportCategory(rep.category, rep.report_type);
    const baseWeight =
      POSITIVE_REPORT_RISK_WEIGHTS[normalizedCat] ??
      POSITIVE_REPORT_RISK_WEIGHTS[rep.category] ?? -10;

    const ratingMult =
      POSITIVE_RATING_MULTIPLIERS[Number(rep.safety_rating)] ?? 1.0;

    const distMult = getDistanceMultiplier(
      Number(rep.distance_from_route) || 0
    );

    const timeMult = getTimeMultiplier(
      rep.time_cycle,
      currentTimeCycle
    );

    const ageMult = getReportAgeMultiplier(rep);
    const confidenceMult = getValidationStatusMultiplier(rep);

    const reportRisk =
      baseWeight * ratingMult * distMult * timeMult * ageMult * confidenceMult;

    communityRiskTotal += reportRisk;

    communityReportContributions.push({
      category: normalizedCat,
      type: "positive",
      baseWeight,
      ratingMult,
      distMult,
      timeMult,
      ageMult,
      confidenceMult,
      impact: Math.round(reportRisk * 10) / 10
    });

    positiveFactorDetails.push({
      category: normalizedCat,
      impact: Math.abs(reportRisk)
    });
  });

  // NEGATIVE REPORTS
  (negativeReports || []).forEach((rep) => {
    const normalizedCat = normalizeReportCategory(rep.category, rep.report_type);
    const baseWeight =
      NEGATIVE_REPORT_RISK_WEIGHTS[normalizedCat] ??
      NEGATIVE_REPORT_RISK_WEIGHTS[rep.category] ?? 10;

    const ratingMult =
      NEGATIVE_RATING_MULTIPLIERS[Number(rep.safety_rating)] ?? 1.0;

    const distMult = getDistanceMultiplier(
      Number(rep.distance_from_route) || 0
    );

    const timeMult = getTimeMultiplier(
      rep.time_cycle,
      currentTimeCycle
    );

    const ageMult = getReportAgeMultiplier(rep);
    const confidenceMult = getValidationStatusMultiplier(rep);

    const reportRisk =
      baseWeight * ratingMult * distMult * timeMult * ageMult * confidenceMult;

    communityRiskTotal += reportRisk;

    communityReportContributions.push({
      category: normalizedCat,
      type: "negative",
      baseWeight,
      ratingMult,
      distMult,
      timeMult,
      ageMult,
      confidenceMult,
      impact: Math.round(reportRisk * 10) / 10
    });

    negativeFactorDetails.push({
      category: normalizedCat,
      impact: Math.abs(reportRisk)
    });
  });


  // Bounded soft saturation: C = 100 * (S_net / (S_net + 40)) if S_net > 0, else 0
  const rawNetCommunityRisk = Math.max(0, communityRiskTotal);
  const communityRisk = rawNetCommunityRisk > 0
    ? Math.min(100, Math.round((100 * (rawNetCommunityRisk / (rawNetCommunityRisk + 40))) * 10) / 10)
    : 0;


  // ==========================================================
  // 3. DANGER ZONE PENALTY
  // ==========================================================

  const totalDangerPenalty = Math.min(
    40,
    Number(analysisResult.totalDangerPenalty ?? 0)
  );

  const penetratedDangerZones =
    analysisResult.penetratedDangerZones ?? [];


  // ==========================================================
  // 4. WEIGHTED RISK & UNIFIED SAFETY SCORE
  // ==========================================================

  const weightedHistoricalRisk =
    Math.round(historicalRisk * HISTORICAL_WEIGHT * 10) / 10;

  const weightedCommunityRisk =
    Math.round(communityRisk * COMMUNITY_WEIGHT * 10) / 10;

  const totalRisk = Math.min(
    100,
    Math.round((weightedHistoricalRisk + weightedCommunityRisk + totalDangerPenalty) * 10) / 10
  );

  const displayedTotalRisk = totalRisk;

  // Displayed Safety Score & Internal Route Risk represent the SAME safety concept
  const displayedSafetyScore = Math.max(
    0,
    Math.min(100, Math.round((100 - totalRisk) * 10) / 10)
  );

  const internalRouteRisk = totalRisk;

  const finalRouteRankingScore = displayedSafetyScore;


  // ==========================================================
  // 7. SAFETY LEVEL
  // ==========================================================

  const levelInfo = getSafetyLevel(displayedSafetyScore);


  // ==========================================================
  // 8. NORMALIZED DISPLAY VALUES
  // ==========================================================

  const historicalRiskDisplay = Math.min(
    100,
    Math.round(historicalRisk)
  );

  const communityRiskDisplay = Math.min(
    100,
    Math.round(communityRisk)
  );


  // ==========================================================
  // 9. TOP POSITIVE FACTORS
  // ==========================================================

  const positiveMap = new Map();

  positiveFactorDetails.forEach((factor) => {
    if (
      !positiveMap.has(factor.category) ||
      factor.impact > positiveMap.get(factor.category).impact
    ) {
      positiveMap.set(factor.category, factor);
    }
  });

  const topPositiveFactors = Array.from(positiveMap.values())
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map((factor) => `✓ ${factor.category}`);


  // ==========================================================
  // 10. TOP NEGATIVE FACTORS
  // ==========================================================

  const negativeMap = new Map();

  negativeFactorDetails.forEach((factor) => {
    if (
      !negativeMap.has(factor.category) ||
      factor.impact > negativeMap.get(factor.category).impact
    ) {
      negativeMap.set(factor.category, factor);
    }
  });

  const topNegativeFactors = Array.from(negativeMap.values())
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map((factor) => `⚠ ${factor.category}`);


  // ==========================================================
  // 11. SAFETY ENGINE RESULT
  // ==========================================================

  const result = {
    finalScore: displayedSafetyScore,
    displayedSafetyScore,
    internalRouteRisk,
    finalRouteRankingScore,

    safetyLevel: levelInfo.level,
    safetyBadge: levelInfo.badge,
    color: levelInfo.color,

    baseScore: 100,

    historicalRisk: Math.round(historicalRisk * 10) / 10,
    historicalRiskDisplay,
    weightedHistoricalRisk,
    historicalRecordsCount: numHistRecords,

    communityRisk: Math.round(communityRisk * 10) / 10,
    communityRiskDisplay,
    weightedCommunityRisk,
    communityReportsCount:
      positiveReports.length + negativeReports.length,
    communityReportContributions,

    totalRisk: Math.round(displayedTotalRisk * 10) / 10,
    totalDangerPenalty,
    penetratedDangerZones,

    mlPredictionUsed,

    topPositiveFactors,
    topNegativeFactors,

    summary: {
      baseScore: 100,
      displayedSafetyScoreFormatted: `${displayedSafetyScore} / 100`,
      internalRouteRiskFormatted: internalRouteRisk.toFixed(1),
      dangerPenaltyFormatted: totalDangerPenalty.toFixed(1),
      historicalRiskDisplayFormatted: `${historicalRiskDisplay} / 100`,
      communityRiskDisplayFormatted: `${communityRiskDisplay} / 100`,
      totalRiskFormatted: displayedTotalRisk.toFixed(1),
      densityMultiplierFormatted: "ML",
      currentTimeCycle,
      finalScoreFormatted: `${displayedSafetyScore} / 100`
    }
  };

  return result;
}