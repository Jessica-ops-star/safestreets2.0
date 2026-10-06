import {
  analyzeRouteSafetyData,
  buildDangerZones,
  calculateDangerPenalties
} from "./routeSafetyAnalysis.js";

import {
  calculateSafetyScoreEngine
} from "./safetyScoreEngine.js";


// ============================================================
// COORDINATE NORMALIZATION
// ============================================================

function normalizeCoords(value) {
  if (!value) return null;

  if (Array.isArray(value) && value.length >= 2) {
    return {
      lat: Number(value[0]),
      lon: Number(value[1])
    };
  }

  if (value.coords && Array.isArray(value.coords) && value.coords.length >= 2) {
    return {
      lat: Number(value.coords[0]),
      lon: Number(value.coords[1])
    };
  }

  const lat = value.lat ?? value.latitude;
  const lon = value.lon ?? value.lng ?? value.longitude;

  if (lat != null && lon != null && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
    return {
      lat: Number(lat),
      lon: Number(lon)
    };
  }

  return null;
}


// ============================================================
// HAVERSINE DISTANCE
// ============================================================

function haversineDistanceKm(from, to) {
  if (!from || !to) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusKm = 6371;

  const latDelta = ((to.lat - from.lat) * Math.PI) / 180;
  const lonDelta = ((to.lon - from.lon) * Math.PI) / 180;

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}


// ============================================================
// CONVERT GEOJSON TO LEAFLET PATH
// ============================================================

export function toLeafletPath(geometry) {
  if (!geometry) return [];

  const coordinates =
    geometry.coordinates ??
    geometry?.features?.[0]?.geometry?.coordinates ??
    [];

  return coordinates.map(([lon, lat]) => [lat, lon]);
}


// ============================================================
// EVALUATE SINGLE CANDIDATE ROUTE
// ============================================================

export async function evaluateCandidateRoute(
  route,
  index,
  safetyContext = {}
) {
  const geometry =
    route.geometry ??
    route?.features?.[0]?.geometry ??
    null;

  const distanceMeters = Number(route.distance ?? 0);
  const durationSeconds = Number(route.duration ?? 0);

  const path = toLeafletPath(geometry);
  const distanceKm = distanceMeters / 1000;

  const distanceLabel =
    distanceMeters >= 1000
      ? `${distanceKm.toFixed(1)} km`
      : `${Math.round(distanceMeters)} m`;

  const durationLabel = `${Math.max(1, Math.round(durationSeconds / 60))} mins`;

  const communityReports = safetyContext.communityReports ?? [];
  const safetyData = safetyContext.safetyData ?? [];

  const routeObj = {
    path,
    distance: distanceLabel,
    duration: durationLabel,
    distanceMeters,
    durationSeconds
  };


  // ==========================================================
  // ROUTE SAFETY ANALYSIS
  // ==========================================================

  const routeAnalysis = analyzeRouteSafetyData(
    routeObj,
    communityReports,
    safetyData
  );


  // ==========================================================
  // SAFETY SCORE ENGINE
  // ==========================================================

  const scoreResult = await calculateSafetyScoreEngine(routeAnalysis);


  // ==========================================================
  // WARNINGS
  // ==========================================================

  const warnings = [...(scoreResult.topNegativeFactors || [])];

  if (
    routeAnalysis.penetratedDangerZones &&
    routeAnalysis.penetratedDangerZones.length > 0
  ) {
    routeAnalysis.penetratedDangerZones.forEach((dz) => {
      warnings.push(
        `⚠ Caution: Route passes through ${dz.category} (${dz.radius}m radius)`
      );
    });
  }

  if (
    scoreResult.displayedSafetyScore < 70 &&
    !warnings.some(
      (w) => w.includes("Vulnerability") || w.includes("Risk")
    )
  ) {
    warnings.push("⚠ Elevated security risk along route corridor");
  }


  // ==========================================================
  // COMPLETE ROUTE EVALUATION
  // ==========================================================

  // ==========================================================
  // COMPLETE ROUTE EVALUATION
  // ==========================================================

  const evaluation = {
    routeId: `route-${index + 1}`,
    rawRoute: route,
    path,
    distance: distanceLabel,
    duration: durationLabel,
    distanceMeters,
    durationSeconds,

    safetyScore: scoreResult.displayedSafetyScore,
    displayedSafetyScore: scoreResult.displayedSafetyScore,
    internalRouteRisk: scoreResult.internalRouteRisk,
    finalRouteRankingScore: scoreResult.finalRouteRankingScore,

    historicalRisk: scoreResult.historicalRiskDisplay,
    communityRisk: scoreResult.communityRiskDisplay,
    weightedHistoricalRisk: scoreResult.weightedHistoricalRisk,
    weightedCommunityRisk: scoreResult.weightedCommunityRisk,

    dangerPenalty: routeAnalysis.totalDangerPenalty ?? 0,
    penetratedDangerZones: routeAnalysis.penetratedDangerZones ?? [],

    historicalReportCount: routeAnalysis.historicalReports.length,
    communityReportCount:
      routeAnalysis.positiveReports.length +
      routeAnalysis.negativeReports.length,
    positiveReportCount: routeAnalysis.positiveReports.length,
    negativeReportCount: routeAnalysis.negativeReports.length,

    positiveReports: routeAnalysis.positiveReports,
    negativeReports: routeAnalysis.negativeReports,
    historicalReports: routeAnalysis.historicalReports,

    safetyLevel: scoreResult.safetyLevel,
    safetyBadge: scoreResult.safetyBadge,
    riskLevel:
      scoreResult.displayedSafetyScore >= 80
        ? "Low"
        : scoreResult.displayedSafetyScore >= 60
          ? "Medium"
          : "High",

    warnings,
    routeAnalysis,
    scoreResult
  };


  // ==========================================================
  // STRUCTURED DEBUG LOGGING (PHASE 4)
  // ==========================================================

  const totalHistAvailable = (safetyContext.safetyData || []).length;
  const histMatched = routeAnalysis.historicalReports.length;
  const totalCommAvailable = (safetyContext.communityReports || []).length;
  const commMatched = routeAnalysis.positiveReports.length + routeAnalysis.negativeReports.length;

  const histRecordIds = routeAnalysis.historicalReports.map((r) => r.id);
  const commReportIds = [...routeAnalysis.positiveReports, ...routeAnalysis.negativeReports].map((r) => r.id);

  console.log("----------------------------------");
  console.log(`[EVALUATION] Route ID: ${evaluation.routeId}`);
  console.log(`- Distance: ${evaluation.distance} | Duration: ${evaluation.duration}`);
  console.log(`- Historical Records: ${totalHistAvailable} available in context -> ${histMatched} matched to corridor -> ${histMatched} sent to ML`);
  console.log(`- Community Reports: ${totalCommAvailable} available in context -> ${commMatched} matched & used`);
  console.log(`- Danger Zones Penetrated: ${evaluation.penetratedDangerZones.length} zones (Penalty: +${evaluation.dangerPenalty})`);
  console.log(`- Historical Risk: ${evaluation.historicalRisk} (Weighted: ${evaluation.weightedHistoricalRisk})`);
  console.log(`- Community Risk: ${evaluation.communityRisk} (Weighted: ${evaluation.weightedCommunityRisk})`);
  console.log(`- Displayed Total Risk: ${scoreResult.totalRisk}`);
  console.log(`- Final Displayed Safety Score: ${evaluation.displayedSafetyScore} / 100`);
  console.log(`- Internal Ranking Risk: ${evaluation.internalRouteRisk}`);
  console.log(`- ML Prediction Status: ${scoreResult.mlPredictionUsed ? "ML_BATCH" : "RULE_BASED_FALLBACK"}`);
  console.log(`- Historical Record IDs:`, histRecordIds);
  console.log(`- Community Report IDs:`, commReportIds);
  console.log("----------------------------------");

  return evaluation;
}


// ============================================================
// FETCH CANDIDATE ROUTES
// ============================================================

async function fetchCandidateRoutes(
  origin,
  destination,
  safetyContext = {}
) {
  const coordsStr = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;

  const apiKey =
    (typeof import.meta !== "undefined" &&
      import.meta.env?.VITE_OPENROUTESERVICE_API_KEY) ||
    (typeof process !== "undefined" &&
      process.env?.OPENROUTESERVICE_API_KEY) ||
    "";

  let rawRoutes = [];


  // ==========================================================
  // 1. OPENROUTESERVICE
  // ==========================================================

  if (apiKey) {
    try {
      const orsUrl =
        "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

      const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, application/geo+json",
        "Authorization": apiKey
      };

      const orsRes = await fetch(orsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          coordinates: [
            [origin.lon, origin.lat],
            [destination.lon, destination.lat]
          ],
          alternative_routes: {
            target_count: 4,
            weight_factor: 1.4,
            share_factor: 0.6
          }
        })
      });

      if (orsRes.ok) {
        const orsData = await orsRes.json();
        const features = orsData?.features ?? [];

        if (features.length > 0) {
          rawRoutes = features.map((feat) => ({
            distance: feat.properties?.summary?.distance ?? 0,
            duration: feat.properties?.summary?.duration ?? 0,
            geometry: feat.geometry
          }));
        }
      }
    } catch (err) {
      console.warn("OpenRouteService API request failed, falling back to OSRM:", err);
    }
  }


  // ==========================================================
  // 2. OSRM FALLBACK
  // ==========================================================

  if (rawRoutes.length < 2) {
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson&alternatives=true`;

      const res = await fetch(osrmUrl, {
        headers: { Accept: "application/json" }
      });

      if (res.ok) {
        const data = await res.json();
        const osrmRoutes = data?.routes ?? [];

        if (osrmRoutes.length > rawRoutes.length) {
          rawRoutes = osrmRoutes;
        }
      }
    } catch (err) {
      console.warn("OSRM fallback request failed:", err);
    }
  }


  // ==========================================================
  // 3. PARALLEL CORRIDOR ALTERNATIVE GENERATION
  // ==========================================================

  const distKm = haversineDistanceKm(origin, destination);

  if (
    rawRoutes.length < 3 &&
    distKm > 0.2 &&
    rawRoutes[0]?.geometry?.coordinates?.length >= 4
  ) {
    const coords = rawRoutes[0].geometry.coordinates;
    const midIdx = Math.floor(coords.length / 2);
    const midLon = coords[midIdx][0];
    const midLat = coords[midIdx][1];

    const dLon = destination.lon - origin.lon;
    const dLat = destination.lat - origin.lat;
    const len = Math.sqrt(dLon * dLon + dLat * dLat);

    if (len > 0.0001) {
      const perpLon = -dLat / len;
      const perpLat = dLon / len;
      const scale = Math.min(0.035, Math.max(0.015, distKm * 0.12));

      const waypoints = [
        [midLon + perpLon * scale, midLat + perpLat * scale],
        [midLon - perpLon * scale, midLat - perpLat * scale],
        [midLon + perpLon * scale * 1.8, midLat + perpLat * scale * 1.8],
        [midLon - perpLon * scale * 1.8, midLat - perpLat * scale * 1.8]
      ];

      const detourPromises = waypoints.map(async (wp) => {
        try {
          const dUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${wp[0].toFixed(5)},${wp[1].toFixed(5)};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;

          const dRes = await fetch(dUrl, {
            headers: { Accept: "application/json" }
          });

          if (dRes.ok) {
            const dData = await dRes.json();
            return dData?.routes?.[0] || null;
          }
        } catch {
          return null;
        }
        return null;
      });

      const fallbackDetours = (await Promise.all(detourPromises)).filter(Boolean);
      fallbackDetours.forEach((alt) => {
        const isDuplicate = rawRoutes.some(
          (existing) => Math.abs(Number(existing.distance) - Number(alt.distance)) < 20 && Math.abs(Number(existing.duration) - Number(alt.duration)) < 5
        );
        if (!isDuplicate) {
          rawRoutes.push(alt);
        }
      });
    }
  }


  // ==========================================================
  // DEBUG
  // ==========================================================

  console.log("==================================");
  console.log(`Candidate routes returned (${rawRoutes.length}):`);
  rawRoutes.forEach((rt, idx) => {
    const dKm = (Number(rt.distance || 0) / 1000).toFixed(1);
    const dMin = Math.max(1, Math.round(Number(rt.duration || 0) / 60));
    console.log(`Route ${idx + 1}: ${dKm} km, ${dMin} mins`);
  });
  console.log("==================================");

  return rawRoutes;
}


// ============================================================
// COMPARE ROUTES FOR SAFE ROUTE SELECTION
//
// Priority:
// 1. Lowest Internal Route Risk
// 2. Highest Displayed Safety Score
// 3. Fewer Negative Community Reports
// 4. Fewer Historical Reports
// 5. Lower Weighted Historical Risk
// 6. Shorter Distance
// 7. Shorter Duration
// ============================================================

export function compareRoutesForSafe(a, b) {
  if (!a) {
    return { winner: b, reason: "Initial route selection" };
  }

  if (!b) {
    return { winner: a, reason: "Initial route selection" };
  }


  // 1. LOWER INTERNAL ROUTE RISK
  const riskA = a.internalRouteRisk ?? a.scoreResult?.internalRouteRisk ?? Infinity;
  const riskB = b.internalRouteRisk ?? b.scoreResult?.internalRouteRisk ?? Infinity;

  if (riskA !== riskB) {
    const winner = riskA < riskB ? a : b;
    const loser = winner.routeId === a.routeId ? b : a;

    return {
      winner,
      reason: `Lower Internal Route Risk (${winner.internalRouteRisk} vs ${loser.internalRouteRisk})`
    };
  }


  // 2. HIGHER DISPLAYED SAFETY SCORE
  const scoreA = a.displayedSafetyScore ?? a.safetyScore ?? 0;
  const scoreB = b.displayedSafetyScore ?? b.safetyScore ?? 0;

  if (scoreB !== scoreA) {
    const winner = scoreB > scoreA ? b : a;
    const loser = winner.routeId === a.routeId ? b : a;

    return {
      winner,
      reason: `Higher Displayed Safety Score (${winner.displayedSafetyScore} vs ${loser.displayedSafetyScore})`
    };
  }


  // 3. FEWER NEGATIVE COMMUNITY REPORTS
  const negA = a.negativeReportCount ?? (a.negativeReports?.length || 0);
  const negB = b.negativeReportCount ?? (b.negativeReports?.length || 0);

  if (negA !== negB) {
    const winner = negA < negB ? a : b;
    return {
      winner,
      reason: `Internal Risk tied. Negative Community Reports: ${negA} vs ${negB}. Therefore ${winner.routeId} wins.`
    };
  }


  // 4. FEWER HISTORICAL REPORTS
  const histA = a.historicalReportCount ?? (a.historicalReports?.length || 0);
  const histB = b.historicalReportCount ?? (b.historicalReports?.length || 0);

  if (histA !== histB) {
    const winner = histA < histB ? a : b;
    return {
      winner,
      reason: `Internal Risk tied. Historical Reports: ${histA} vs ${histB}. Therefore ${winner.routeId} wins.`
    };
  }


  // 5. LOWER WEIGHTED HISTORICAL RISK
  const histRiskA = a.weightedHistoricalRisk ?? a.historicalRisk ?? 0;
  const histRiskB = b.weightedHistoricalRisk ?? b.historicalRisk ?? 0;

  if (histRiskA !== histRiskB) {
    const winner = histRiskA < histRiskB ? a : b;
    return {
      winner,
      reason: `Internal Risk tied. Weighted Historical Risk: ${histRiskA} vs ${histRiskB}. Therefore ${winner.routeId} wins.`
    };
  }


  // 6. SHORTER DISTANCE
  if (a.distanceMeters !== b.distanceMeters) {
    const winner = a.distanceMeters < b.distanceMeters ? a : b;
    const loser = winner.routeId === a.routeId ? b : a;
    return {
      winner,
      reason: `Internal Risk tied. Distance: ${winner.distance} vs ${loser.distance}. Therefore ${winner.routeId} wins.`
    };
  }


  // 7. SHORTER DURATION
  if (a.durationSeconds !== b.durationSeconds) {
    const winner = a.durationSeconds < b.durationSeconds ? a : b;
    const loser = winner.routeId === a.routeId ? b : a;
    return {
      winner,
      reason: `Internal Risk tied. Duration: ${winner.duration} vs ${loser.duration}. Therefore ${winner.routeId} wins.`
    };
  }

  return {
    winner: a,
    reason: "Internal Risk tied. All metrics identical."
  };
}


// ============================================================
// EVALUATE ALL ROUTES
// ============================================================

export async function evaluateAllRoutes(
  from,
  to,
  safetyContext = {}
) {
  const origin = normalizeCoords(from);
  const destination = normalizeCoords(to);

  if (!origin || !destination) {
    throw new Error(
      "Both origin and destination coordinates are required."
    );
  }

  const MAX_REROUTE_ATTEMPTS = 5;
  let rerouteAttempt = 0;

  const evaluatedMap = new Map();
  let nextRouteIndex = 0;

  const addEvaluatedCandidate = async (candRoute) => {
    const key = JSON.stringify(
      candRoute.geometry?.coordinates || candRoute.path || []
    );

    if (!evaluatedMap.has(key)) {
      const routeIndex = nextRouteIndex++;
      const evaluation = await evaluateCandidateRoute(
        candRoute,
        routeIndex,
        safetyContext
      );

      evaluatedMap.set(key, evaluation);
    }
  };


  // ==========================================================
  // 1. INITIAL CANDIDATE FETCH & EVALUATION
  // ==========================================================

  const initialCandidates = await fetchCandidateRoutes(
    origin,
    destination,
    safetyContext
  );

  await Promise.all(
    initialCandidates.map((route) => addEvaluatedCandidate(route))
  );

  let currentEvaluated = Array.from(evaluatedMap.values());

  if (currentEvaluated.length === 0) {
    throw new Error("No candidate routes were returned.");
  }

  let currentSafest = currentEvaluated.reduce(
    (prev, curr) => compareRoutesForSafe(prev, curr).winner,
    currentEvaluated[0]
  );


  // ==========================================================
  // 2. MULTI-ATTEMPT WAYPOINT REROUTING
  // ==========================================================

  while (
    rerouteAttempt < MAX_REROUTE_ATTEMPTS &&
    currentSafest.penetratedDangerZones &&
    currentSafest.penetratedDangerZones.length > 0
  ) {
    rerouteAttempt++;
    const previousSafestRisk = currentSafest.internalRouteRisk;
    const targetZone = currentSafest.penetratedDangerZones[0];

    const offset = (rerouteAttempt * 0.012) + 0.015;

    const detourWaypoints = [
      [targetZone.longitude + offset, targetZone.latitude + offset],
      [targetZone.longitude - offset, targetZone.latitude - offset],
      [targetZone.longitude - offset, targetZone.latitude + offset],
      [targetZone.longitude + offset, targetZone.latitude - offset]
    ];

    // DEBUG LOGGING FOR REROUTING (PART 13)
    console.log("==================================");
    console.log(`[Rerouting Attempt ${rerouteAttempt}/${MAX_REROUTE_ATTEMPTS}]`);
    console.log(`  Target Danger Zone: ${targetZone.id} (${targetZone.category}, Lat: ${targetZone.latitude.toFixed(4)}, Lon: ${targetZone.longitude.toFixed(4)}, Radius: ${targetZone.radius}m, Severity: ${targetZone.severity})`);
    console.log(`  Generated 1 KM+ Detour Waypoints:`, detourWaypoints);

    const detourPromises = detourWaypoints.map(async (waypoint) => {
      try {
        const dUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${waypoint[0]},${waypoint[1]};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;

        const dRes = await fetch(dUrl, {
          headers: { Accept: "application/json" }
        });

        if (dRes.ok) {
          const dData = await dRes.json();
          return dData?.routes?.[0] || null;
        }
      } catch {
        return null;
      }
      return null;
    });

    const detourRoutes = (await Promise.all(detourPromises)).filter(Boolean);
    console.log(`  Detour Candidates Returned: ${detourRoutes.length}`);

    if (detourRoutes.length > 0) {
      await Promise.all(
        detourRoutes.map((route) => addEvaluatedCandidate(route))
      );

      currentEvaluated = Array.from(evaluatedMap.values());

      currentSafest = currentEvaluated.reduce(
        (prev, curr) => compareRoutesForSafe(prev, curr).winner,
        currentEvaluated[0]
      );

      const internalRiskImproved = currentSafest.internalRouteRisk < previousSafestRisk;
      const zonesRemaining = currentSafest.penetratedDangerZones?.length || 0;

      console.log(`  Previous Safest Internal Risk: ${previousSafestRisk} -> New Safest Internal Risk: ${currentSafest.internalRouteRisk}`);
      console.log(`  Internal Risk Improved: ${internalRiskImproved}`);
      console.log(`  Penetrated Danger Zones Remaining: ${zonesRemaining}`);
      console.log("==================================");

    } else {
      console.log(`  No new detour routes generated on attempt ${rerouteAttempt}. Breaking loop.`);
      console.log("==================================");
      break;
    }
  }


  // ==========================================================
  // ALL EVALUATED ROUTES
  // ==========================================================

  const evaluatedRoutes = Array.from(evaluatedMap.values());


  // ==========================================================
  // 3. FIND FAST ROUTE
  // ==========================================================

  let fastRoute = evaluatedRoutes[0];

  for (let i = 1; i < evaluatedRoutes.length; i++) {
    if (evaluatedRoutes[i].durationSeconds < fastRoute.durationSeconds) {
      fastRoute = evaluatedRoutes[i];
    }
  }


  // ==========================================================
  // 4. FIND SAFE ROUTE
  // ==========================================================

  let safeRoute = evaluatedRoutes[0];
  let selectionReason = "Highest Internal Route Safety & Danger Avoidance";

  for (let i = 1; i < evaluatedRoutes.length; i++) {
    const comparison = compareRoutesForSafe(safeRoute, evaluatedRoutes[i]);
    safeRoute = comparison.winner;
    selectionReason = comparison.reason;
  }


  // ==========================================================
  // 5. AVOIDED DANGER ZONES
  // ==========================================================

  const fastPenetratedMap = new Map(
    (fastRoute.penetratedDangerZones || []).map((z) => [z.id, z])
  );

  const safePenetratedMap = new Map(
    (safeRoute.penetratedDangerZones || []).map((z) => [z.id, z])
  );

  const avoidedDangerZones = [];

  fastPenetratedMap.forEach((zone, id) => {
    if (!safePenetratedMap.has(id)) {
      avoidedDangerZones.push(zone);
    }
  });


  // ==========================================================
  // 6. SAFE ROUTE DANGER STATUS
  // ==========================================================

  const safeRoutePenetratesDanger =
    safeRoute.penetratedDangerZones &&
    safeRoute.penetratedDangerZones.length > 0;

  const noSafeAlternativeNotice = safeRoutePenetratesDanger
    ? "No completely safe alternative exists. Showing the least risky available route."
    : null;


  // ==========================================================
  // 7. FAST VS SAFE COMPARISON
  // ==========================================================

  const isIdentical =
    evaluatedRoutes.length === 1 || fastRoute.routeId === safeRoute.routeId;

  const scoreIncrease = Math.max(
    0,
    Math.round((safeRoute.displayedSafetyScore - fastRoute.displayedSafetyScore) * 10) / 10
  );

  const timeAddedMinutes = Math.max(
    0,
    Math.round((safeRoute.durationSeconds - fastRoute.durationSeconds) / 60)
  );

  let comparisonText = isIdentical
    ? "This route is both the fastest and the safest."
    : noSafeAlternativeNotice
      ? noSafeAlternativeNotice
      : scoreIncrease > 0
        ? `Compared with the Fast Route, choosing the Safe Route increases the Safety Score by ${scoreIncrease} points while adding only ${timeAddedMinutes} minutes to the journey.`
        : avoidedDangerZones.length > 0
          ? `Compared with the Fast Route, choosing the Safe Route avoids ${avoidedDangerZones.length} danger zone(s) while adding only ${timeAddedMinutes} minutes to the journey.`
          : `Choosing the Safe Route provides lower internal risk while adding only ${timeAddedMinutes} minutes to the journey.`;


  // ==========================================================
  // TEMPORARY DEBUGGING LOGS (REQUIREMENT 2)
  // ==========================================================

  console.log("\n[ROUTE]");
  console.log(`Fast route coordinates: ${fastRoute.path?.length || 0} points`);

  console.log("\n[FAST ROUTE SAFETY]");
  console.log(`Historical risk: ${fastRoute.historicalRisk}`);
  console.log(`Community risk: ${fastRoute.communityRisk}`);
  console.log(`Reports detected: ${fastRoute.historicalReportCount + fastRoute.communityReportCount}`);
  console.log(`Safety score: ${fastRoute.displayedSafetyScore}`);

  console.log("\n[SAFE ROUTE]");
  console.log(`Risk detected on fast route: ${fastRoute.penetratedDangerZones?.length > 0 ? "YES" : "NO"}`);
  console.log(`Alternative candidates generated: ${evaluatedRoutes.length}`);

  evaluatedRoutes.forEach((cand, idx) => {
    console.log(`\nCandidate ${idx + 1} (${cand.routeId}):`);
    console.log(`- distance: ${cand.distance}`);
    console.log(`- duration: ${cand.duration}`);
    console.log(`- reports detected: ${cand.historicalReportCount + cand.communityReportCount}`);
    console.log(`- historical risk: ${cand.historicalRisk}`);
    console.log(`- community risk: ${cand.communityRisk}`);
    console.log(`- danger penalty: ${cand.dangerPenalty}`);
    console.log(`- final safety score: ${cand.displayedSafetyScore}`);
  });

  console.log("\n[ROUTE SELECTION]");
  console.log(`Fast score: ${fastRoute.displayedSafetyScore}`);
  console.log(`Safe score: ${safeRoute.displayedSafetyScore}`);
  console.log(`Different route: ${isIdentical ? "NO" : "YES"}`);
  console.log(`Reason: ${selectionReason}`);
  console.log("==================================================");


  // ==========================================================
  // BUILD DANGER ZONES
  // ==========================================================

  const dangerZones = buildDangerZones(
    safetyContext.safetyData,
    safetyContext.communityReports
  );


  // ==========================================================
  // RETURN COMPLETE ROUTING RESULT
  // ==========================================================

  return {
    fastest: fastRoute,
    safest: safeRoute,
    evaluatedRoutes,
    allEvaluations: evaluatedRoutes,
    dangerZones,
    avoidedDangerZones,
    noSafeAlternativeNotice,
    isIdentical,

    recommendation: {
      recommendedRouteType: "safest",
      reason: selectionReason,
      scoreIncrease,
      timeAddedMinutes,
      avoidedDangerZones,
      noSafeAlternativeNotice,
      comparisonText
    }
  };
}


// ============================================================
// BUILD ROUTE SUMMARY
// ============================================================

export async function buildRouteSummary(
  routeData,
  routeIndex = 0,
  label = "fast",
  safetyContext = {}
) {
  const routes =
    routeData?.routes ??
    (Array.isArray(routeData) ? routeData : [routeData]);

  const candidate = routes[routeIndex] ?? routes[0];

  return await evaluateCandidateRoute(
    candidate,
    routeIndex,
    safetyContext
  );
}


// ============================================================
// GET FASTEST ROUTE
// ============================================================

export async function getFastestRoute(
  from,
  to,
  safetyContext = {}
) {
  const result = await evaluateAllRoutes(from, to, safetyContext);
  return result.fastest;
}


// ============================================================
// GET SAFEST ROUTE
// ============================================================

export async function getSafestRoute(
  from,
  to,
  safetyContext = {}
) {
  const result = await evaluateAllRoutes(from, to, safetyContext);
  return result.safest;
}