import { supabase } from "../src/lib/supabase.js";
import { getDatasetSafetyData, getDatasetSafetyDataByCity } from "./datasetLoader.js";

// Memory cache of tables confirmed missing in the database to prevent repeated 404 network requests
const missingTables = new Set();

const PRIMARY_SAFETY_TABLE = "safety_analysis";
const PRIMARY_COMMUNITY_REPORTS_TABLE = "community_reports";

function normalizeSafetyRecord(record) {
  if (!record) return null;

  return {
    ...record,
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    crime_count: Number(record.crime_count ?? record.crimeCount ?? 0),
    lighting_score: Number(record.lighting_score ?? record.lightingScore ?? 0),
    police_station_distance_km: Number(record.police_station_distance_km ?? record.policeStationDistanceKm ?? 0),
    crowd_density: Number(record.crowd_density ?? record.crowdDensity ?? 0),
  };
}

export function sanitizeText(text) {
  if (!text) return "";
  let clean = String(text);
  // Anti-abuse: Remove names of individuals, accusations, phone numbers, email addresses
  clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[email redacted]");
  clean = clean.replace(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[phone redacted]");
  clean = clean.replace(/\b(alleged|attacker|suspect|person|name|who|called|identified as|is guilty of|guilty|stealing|stole)\b/gi, "[accusation redacted]");
  clean = clean.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, "[identity redacted]");
  return clean.trim();
}

export function normalizeCommunityReport(record) {
  if (!record) return null;

  const lat = Number(record.latitude);
  const lon = Number(record.longitude);
  const createdAt = record.created_at || record.created_date || new Date().toISOString();

  // Status mapping: PROVISIONAL / UNVERIFIED, CORROBORATED, VERIFIED / EVIDENCE-BACKED, EXPIRED
  let status = record.status || (record.verified ? "VERIFIED" : "PROVISIONAL");
  const corroborationCount = Number(record.corroboration_count ?? record.corroborationsCount ?? 0);
  const negativeCount = Number(record.negative_count ?? 0);
  const hasEvidence = Boolean(record.has_evidence ?? record.evidence_url ?? false);

  if (hasEvidence && status !== "VERIFIED") {
    status = "VERIFIED";
  } else if (!hasEvidence && corroborationCount > 0 && status === "PROVISIONAL") {
    status = "CORROBORATED";
  }

  return {
    ...record,
    id: record.id,
    user_id: record.user_id || record.reported_by || null,
    latitude: lat,
    longitude: lon,
    location: record.location || record.address || (Number.isFinite(lat) && Number.isFinite(lon) ? `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}` : "Unknown Location"),
    description: sanitizeText(record.intelligence_briefing || record.description || ""),
    intelligence_briefing: sanitizeText(record.intelligence_briefing || record.description || ""),
    report_type: record.report_type || record.issue_type || "Incident",
    category: record.category || record.report_type || record.issue_type || "Incident",
    safety_rating: Number(record.safety_rating ?? 3),
    time_cycle: record.time_cycle || "Day",
    status,
    corroboration_count: corroborationCount,
    negative_count: negativeCount,
    has_evidence: hasEvidence,
    evidence_url: record.evidence_url || null,
    additional_info: Array.isArray(record.additional_info) ? record.additional_info : [],
    created_at: createdAt,
    created_date: createdAt
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(from, to) {
  if (!from || !to) return Number.POSITIVE_INFINITY;

  const earthRadiusKm = 6371;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lonDelta = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

// Quiet query executor that avoids spamming network 404s if table is missing
async function safeQuery(tableName, queryFn) {
  if (missingTables.has(tableName)) {
    return { data: [], error: null };
  }

  try {
    const query = supabase.from(tableName);
    const { data, error } = await queryFn(query);

    if (error) {
      const isNotFound = error.status === 404 || error.code === 'PGRST301' || error.code === '42P01' || (error.message && error.message.includes("Could not find the table"));
      if (isNotFound) {
        missingTables.add(tableName);
      }
      return { data: [], error };
    }

    return { data: data ?? [], error: null };
  } catch (err) {
    missingTables.add(tableName);
    return { data: [], error: err };
  }
}

export async function getSafetyData() {
  console.log("\n[SUPABASE]");
  console.log("Querying safety_analysis...");

  let supabaseRecords = [];

  if (!missingTables.has(PRIMARY_SAFETY_TABLE)) {
    try {
      const pageSize = 1000;
      let offset = 0;
      let keepFetching = true;
      const MAX_PAGES = 30; // maximum 30,000 records safety ceiling
      let pageCount = 0;

      while (keepFetching && pageCount < MAX_PAGES) {
        pageCount++;
        const { data, error } = await supabase
          .from(PRIMARY_SAFETY_TABLE)
          .select("*")
          .range(offset, offset + pageSize - 1)
          .order("crime_count", { ascending: false });

        if (error) {
          const isNotFound = error.status === 404 || error.code === 'PGRST301' || error.code === '42P01' || (error.message && error.message.includes("Could not find the table"));
          if (isNotFound) {
            missingTables.add(PRIMARY_SAFETY_TABLE);
          }
          break;
        }

        if (data && Array.isArray(data) && data.length > 0) {
          supabaseRecords.push(...data);
          if (data.length < pageSize) {
            keepFetching = false;
          } else {
            offset += pageSize;
          }
        } else {
          keepFetching = false;
        }
      }

      console.log(`Supabase returned: ${supabaseRecords.length} records across ${pageCount} page(s)`);
    } catch (err) {
      console.error("[SUPABASE] Error querying safety_analysis:", err.message);
    }
  }

  // Load local CSV dataset (20,000 records)
  const localDataset = getDatasetSafetyData();

  if (supabaseRecords.length === 0) {
    console.log("[SUPABASE] Using local CSV dataset parser...");
    return localDataset;
  }

  // Deduplicate combined dataset deterministically
  const normalizedSupabase = supabaseRecords.map(normalizeSafetyRecord).filter(Boolean);
  const seenKeys = new Set();
  const merged = [];

  normalizedSupabase.forEach((rec) => {
    const key = rec.id ? String(rec.id) : `${rec.latitude.toFixed(4)}_${rec.longitude.toFixed(4)}_${rec.crime_type}_${rec.crime_count}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(rec);
    }
  });

  localDataset.forEach((rec) => {
    const key = rec.id ? String(rec.id) : `${rec.latitude.toFixed(4)}_${rec.longitude.toFixed(4)}_${rec.crime_type}_${rec.crime_count}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      merged.push(rec);
    }
  });

  console.log(`\n[SAFETY DATA] Merged dataset contains: ${merged.length} total records`);
  return merged;
}

export async function getSafetyDataByCity(city) {
  if (!city) return getSafetyData();

  try {
    const { data, error } = await supabase
      .from(PRIMARY_SAFETY_TABLE)
      .select("*")
      .eq("city", city)
      .limit(5000)
      .order("crime_count", { ascending: false });

    if (!error && data && data.length > 0) {
      return data.map(normalizeSafetyRecord).filter(Boolean);
    }
  } catch {}

  return getDatasetSafetyDataByCity(city);
}

export const NEARBY_VALIDATION_RADIUS_KM = 2.0;

/**
 * Query existing Supabase `user_locations` table to find users within the configured nearby radius of a report location.
 * EXCLUDES the report creator (report.user_id).
 */
export async function getNearbyUsersForReport(report, radiusKm = NEARBY_VALIDATION_RADIUS_KM, mockUserLocations = null) {
  if (!report || !Number.isFinite(Number(report.latitude)) || !Number.isFinite(Number(report.longitude))) {
    return [];
  }

  const reportLat = Number(report.latitude);
  const reportLon = Number(report.longitude);
  const creatorId = report.user_id ? String(report.user_id) : null;
  const reportCenter = { latitude: reportLat, longitude: reportLon };

  let locationRows = [];

  if (Array.isArray(mockUserLocations)) {
    locationRows = mockUserLocations;
  } else {
    try {
      const { data, error } = await supabase
        .from("user_locations")
        .select("*");

      if (!error && Array.isArray(data)) {
        locationRows = data;
      }
    } catch (err) {
      console.warn("Exception querying user_locations in Supabase:", err);
    }
  }

  return locationRows.filter((row) => {
    // 1. Exclude report creator
    if (creatorId && String(row.user_id) === creatorId) {
      return false;
    }

    const uLat = Number(row.latitude);
    const uLon = Number(row.longitude);
    if (!Number.isFinite(uLat) || !Number.isFinite(uLon)) return false;

    const dist = haversineDistanceKm(reportCenter, { latitude: uLat, longitude: uLon });
    return Number.isFinite(dist) && dist <= radiusKm;
  });
}

/**
 * Check whether a specific user is eligible to validate a community report.
 * Criteria:
 * 1. Current user is NOT the report creator.
 * 2. User's location exists and is within configured nearby radius of report.
 * 3. Report is awaiting validation (status === 'PROVISIONAL').
 * 4. User has not already responded to the report.
 */
export async function isUserEligibleToValidate(report, currentUserId, userCoords, radiusKm = NEARBY_VALIDATION_RADIUS_KM) {
  if (!report || !currentUserId) {
    return { eligible: false, reason: "Missing report or user ID" };
  }

  // 1. Exclude report creator
  if (report.user_id && String(report.user_id) === String(currentUserId)) {
    return { eligible: false, reason: "Report creator cannot self-validate" };
  }

  // 2. Report status check
  const status = String(report.status || "PROVISIONAL").toUpperCase();
  if (status !== "PROVISIONAL") {
    return { eligible: false, reason: "Report is not awaiting provisional validation" };
  }

  // 3. User location check
  let coords = null;
  if (userCoords) {
    if (Array.isArray(userCoords) && userCoords.length >= 2) {
      coords = { latitude: Number(userCoords[0]), longitude: Number(userCoords[1]) };
    } else if (userCoords.latitude != null && userCoords.longitude != null) {
      coords = { latitude: Number(userCoords.latitude), longitude: Number(userCoords.longitude) };
    }
  }

  if (!coords) {
    return { eligible: false, reason: "User location unavailable in Supabase" };
  }

  const distKm = haversineDistanceKm(
    { latitude: Number(report.latitude), longitude: Number(report.longitude) },
    coords
  );

  if (!Number.isFinite(distKm) || distKm > radiusKm) {
    return { eligible: false, reason: "User is outside configured nearby radius", distanceKm: distKm };
  }

  // 4. Duplicate response check
  const hasResponded = await checkUserCorroborated(report.id, currentUserId);
  if (hasResponded) {
    return { eligible: false, reason: "User has already submitted feedback for this report" };
  }

  return { eligible: true, distanceKm: distKm };
}

/**
 * Retrieve active validation requests/notifications eligible for the current user.
 */
export async function getValidationRequestsForUser(currentUserId, userCoords, radiusKm = NEARBY_VALIDATION_RADIUS_KM) {
  if (!currentUserId || !userCoords) return [];

  const allReports = await getCommunityReports();
  const eligibleRequests = [];

  for (const rep of allReports) {
    const check = await isUserEligibleToValidate(rep, currentUserId, userCoords, radiusKm);
    if (check.eligible) {
      eligibleRequests.push({
        report: rep,
        distanceKm: check.distanceKm,
        title: "Possible safety incident reported near you",
        prompt: "Have you observed anything nearby?"
      });
    }
  }

  return eligibleRequests;
}

export async function getNearbyLocations(latitude, longitude, radius = 5) {
  try {
    const records = await getSafetyData();
    const center = { latitude: Number(latitude), longitude: Number(longitude) };
    const radiusKm = Number(radius) || 5;

    return records.filter((record) => {
      const distance = haversineDistanceKm(center, {
        latitude: Number(record.latitude),
        longitude: Number(record.longitude),
      });

      return Number.isFinite(distance) && distance <= radiusKm;
    });
  } catch {
    return [];
  }
}

export async function getCommunityReports() {
  console.log("\n[SUPABASE]");
  console.log("Querying community_reports...");

  try {
    const { data, error } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (!error && Array.isArray(data)) {
      console.log(`Supabase community_reports returned: ${data.length} records`);
      return data.map(normalizeCommunityReport).filter(Boolean);
    }
  } catch (err) {
    console.error("[SUPABASE] Error querying community_reports:", err.message);
  }

  return [];
}

const memoryStorage = new Map();

function safeGetStorageItem(key) {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryStorage.get(key) || null;
}

function safeSetStorageItem(key, value) {
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      localStorage.setItem(key, String(value));
    }
  } catch {}
  memoryStorage.set(key, String(value));
}

// In-memory store for reports created during session or when DB schema is upgrading
const localReportsMemory = new Map();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(str) {
  return typeof str === "string" && UUID_REGEX.test(str.trim());
}

export async function addCommunityReport(report) {
  try {
    let authUser = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      authUser = user;
    } catch {}

    const lat = Number(report.latitude);
    const lon = Number(report.longitude);
    const briefingText = sanitizeText(report.intelligence_briefing || report.description || "");
    const reportTypeStr = report.report_type || report.category || "Incident";
    const categoryStr = report.category || report.report_type || "Incident";
    
    const rawUserId = report.user_id || authUser?.id;
    const validUserId = isValidUuid(rawUserId) ? rawUserId.trim() : null;

    const insertPayload = {
      user_id: validUserId,
      report_type: reportTypeStr,
      category: categoryStr,
      latitude: lat,
      longitude: lon,
      location: report.location || `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`,
      time_cycle: report.time_cycle || "Day",
      safety_rating: Number(report.safety_rating || 3),
      intelligence_briefing: briefingText
    };

    console.log("[CommunityReport] Submitting INSERT to Supabase community_reports:", insertPayload);

    const { data, error } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error("[CommunityReport] INSERT FAILED in Supabase:", { error, payload: insertPayload });
      throw new Error(`Supabase Database Error (${error.code || 'UNKNOWN'}): ${error.message}`);
    }

    console.log("[CommunityReport] INSERT SUCCESS in Supabase:", data);

    const normalized = normalizeCommunityReport(data);
    if (report.user_id && !normalized.user_id) {
      normalized.user_id = report.user_id;
    }
    localReportsMemory.set(normalized.id, normalized);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("community-report-updated", { detail: { report: normalized, type: "NEW_REPORT" } }));
    }

    return normalized;
  } catch (err) {
    console.error("Failed to add community report:", err);
    throw err;
  }
}

/**
 * Corroborate a community report (Anti-abuse protected).
 * Response types: 'SIMILAR' | 'NOT_OBSERVED' | 'ADDITIONAL_INFO'
 */
export async function corroborateReport(reportId, responseType, additionalInfo = "", userIdInput = null) {
  if (!reportId) throw new Error("Report ID is required for corroboration.");

  let userId = userIdInput;
  if (!userId) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || user?.email;
    } catch {}
  }
  if (!userId) {
    let sessionUser = safeGetStorageItem("safestreets_session_user_id");
    if (!sessionUser) {
      sessionUser = `anon_${Math.random().toString(36).slice(2, 10)}`;
      safeSetStorageItem("safestreets_session_user_id", sessionUser);
    }
    userId = sessionUser;
  }

  // 1. Fetch current report from DB or local memory
  let report = localReportsMemory.get(reportId) || null;
  try {
    const { data } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .select("*")
      .eq("id", reportId)
      .single();
    if (data) report = normalizeCommunityReport(data);
  } catch {}

  // ANTI-ABUSE RULE 1: User cannot corroborate their own report
  if (report && report.user_id && report.user_id === userId) {
    throw new Error("Anti-Abuse Rule: You cannot validate your own community report.");
  }

  // ANTI-ABUSE RULE 2: Prevent duplicate responses from the same user for the same report
  const respondedKey = `corroborated_${reportId}_${userId}`;
  if (safeGetStorageItem(respondedKey)) {
    throw new Error("Duplicate Response Prevented: You have already submitted feedback for this report.");
  }

  // Record locally for duplicate prevention
  safeSetStorageItem(respondedKey, "true");

  let currentCorroborationCount = report ? (report.corroboration_count || 0) : 0;
  let currentNegativeCount = report ? (report.negative_count || 0) : 0;
  let currentStatus = report ? (report.status || "PROVISIONAL") : "PROVISIONAL";
  let additionalList = report ? (report.additional_info || []) : [];

  const sanitizedInfo = sanitizeText(additionalInfo);

  const typeUpper = String(responseType || "").toUpperCase();
  if (typeUpper === "SIMILAR" || typeUpper === "CORROBORATE" || typeUpper === "POSITIVE") {
    currentCorroborationCount += 1;
    if (currentStatus === "PROVISIONAL") {
      currentStatus = "CORROBORATED";
    }
  } else if (typeUpper === "NOT_OBSERVED" || typeUpper === "NO_OBSERVATION" || typeUpper === "NEGATIVE") {
    currentNegativeCount += 1;
  } else if (typeUpper === "ADDITIONAL_INFO" || typeUpper === "INFO") {
    if (sanitizedInfo) {
      additionalList.push({
        info: sanitizedInfo,
        text: sanitizedInfo,
        timestamp: new Date().toISOString()
      });
    }
  }

  if (sanitizedInfo && typeUpper !== "ADDITIONAL_INFO" && typeUpper !== "INFO") {
    additionalList.push({
      info: sanitizedInfo,
      text: sanitizedInfo,
      timestamp: new Date().toISOString()
    });
  }

  const updatedReport = {
    ...(report || { id: reportId, latitude: 0, longitude: 0 }),
    status: currentStatus,
    corroboration_count: currentCorroborationCount,
    negative_count: currentNegativeCount,
    additional_info: additionalList
  };

  localReportsMemory.set(reportId, updatedReport);

  // Try DB update
  try {
    const updatePayload = {
      corroboration_count: currentCorroborationCount,
      negative_count: currentNegativeCount,
      status: currentStatus,
      additional_info: additionalList
    };
    const { data: updatedDb } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .update(updatePayload)
      .eq("id", reportId)
      .select()
      .single();

    if (updatedDb) {
      const normalized = normalizeCommunityReport(updatedDb);
      localReportsMemory.set(reportId, normalized);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("community-report-updated", { detail: { report: normalized, type: "CORROBORATED" } }));
      }
      return { report: normalized, success: true };
    }
  } catch {}

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("community-report-updated", { detail: { report: updatedReport, type: "CORROBORATED" } }));
  }

  return { report: updatedReport, success: true };
}

/**
 * Attach hardware / emergency evidence to a community report (Transitions to VERIFIED / EVIDENCE-BACKED).
 */
export async function attachEvidenceToReport(reportId, evidenceData = {}) {
  if (!reportId) throw new Error("Report ID is required.");

  const evidenceUrl = evidenceData.evidence_url || evidenceData.audioUrl || evidenceData.videoUrl || "hardware_sos_evidence";

  const updatePayload = {
    status: "VERIFIED",
    has_evidence: true,
    evidence_url: evidenceUrl
  };

  try {
    const { data } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .update(updatePayload)
      .eq("id", reportId)
      .select()
      .single();

    if (data) {
      const normalized = normalizeCommunityReport(data);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("community-report-updated", { detail: { report: normalized, type: "EVIDENCE_ATTACHED" } }));
      }
      return normalized;
    }
  } catch (err) {
    console.warn("Exception attaching evidence to report:", err);
  }

  const updated = {
    id: reportId,
    status: "VERIFIED",
    has_evidence: true,
    evidence_url: evidenceUrl
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("community-report-updated", { detail: { report: updated, type: "EVIDENCE_ATTACHED" } }));
  }

  return updated;
}

export async function checkUserCorroborated(reportId, userId = null) {
  if (!reportId) return false;

  let uId = userId;
  if (!uId) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      uId = user?.id || user?.email;
    } catch {}
  }
  if (!uId) {
    uId = localStorage.getItem("safestreets_session_user_id");
  }

  if (uId && localStorage.getItem(`corroborated_${reportId}_${uId}`)) {
    return true;
  }

  if (uId) {
    try {
      const { data } = await supabase
        .from("report_corroborations")
        .select("id")
        .eq("report_id", reportId)
        .eq("user_id", uId)
        .limit(1);

      if (data && data.length > 0) {
        return true;
      }
    } catch {}
  }

  return false;
}

export async function updateSafetyScore(updates = {}, filters = {}) {
  try {
    const { data } = await safeQuery(PRIMARY_SAFETY_TABLE, (builder) => {
      let query = builder.update(updates);
      if (filters.city) query = query.eq("city", filters.city);
      if (filters.area) query = query.eq("area", filters.area);
      return query.select();
    });

    return data.map(normalizeSafetyRecord).filter(Boolean);
  } catch {
    return [];
  }
}

export async function deleteCommunityReport(id) {
  if (!id) return false;
  try {
    const { error } = await supabase
      .from(PRIMARY_COMMUNITY_REPORTS_TABLE)
      .delete()
      .eq('id', id);

    if (error) {
      console.warn("Supabase report delete notice:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Exception during report delete:", err);
    return false;
  }
}