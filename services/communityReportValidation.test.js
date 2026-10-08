import test from "node:test";
import assert from "node:assert/strict";

import { 
  addCommunityReport, 
  corroborateReport, 
  attachEvidenceToReport, 
  sanitizeText,
  getNearbyUsersForReport,
  isUserEligibleToValidate
} from "./supabaseService.js";
import { getValidationStatusMultiplier } from "./safetyScoreEngine.js";
import { evaluateAllRoutes } from "./routing.js";

test("Sanitization: Text Sanitization (Anti-Abuse / Privacy)", () => {
  const dangerousInput = "John Doe (john@example.com, 555-123-4567) is guilty of stealing!";
  const sanitized = sanitizeText(dangerousInput);
  
  assert.ok(!sanitized.includes("John Doe"), "Should remove personal names");
  assert.ok(!sanitized.includes("john@example.com"), "Should remove emails");
  assert.ok(!sanitized.includes("555-123-4567"), "Should remove phone numbers");
  assert.ok(!sanitized.includes("guilty"), "Should sanitize accusation keywords");
  assert.ok(sanitized.includes("[email redacted]") || sanitized.includes("[redacted]"), "Should insert redacted placeholders");
});

// ============================================================
// REQUIRED COMMUNITY VALIDATION FLOW TESTS (1 - 12)
// ============================================================

test("Req Test 1: Report creator is excluded from nearby-user results", async () => {
  const report = {
    id: "rep-creator-test",
    user_id: "user-creator-A",
    latitude: 13.0827,
    longitude: 80.2707,
    status: "PROVISIONAL"
  };
  const mockLocations = [
    { user_id: "user-creator-A", latitude: 13.0827, longitude: 80.2707 },
    { user_id: "user-nearby-B", latitude: 13.0850, longitude: 80.2710 }
  ];

  const eligible = await getNearbyUsersForReport(report, 2.0, mockLocations);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].user_id, "user-nearby-B");
  assert.ok(!eligible.some(u => u.user_id === "user-creator-A"), "Creator must be excluded");
});

test("Req Test 2: Nearby user from Supabase is selected", async () => {
  const report = {
    id: "rep-nearby-test",
    user_id: "user-creator-A",
    latitude: 13.0827,
    longitude: 80.2707,
    status: "PROVISIONAL"
  };
  const mockLocations = [
    { user_id: "user-nearby-B", latitude: 13.0835, longitude: 80.2715 }
  ];

  const eligible = await getNearbyUsersForReport(report, 2.0, mockLocations);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].user_id, "user-nearby-B");
});

test("Req Test 3: Non-nearby Supabase user is excluded", async () => {
  const report = {
    id: "rep-non-nearby-test",
    user_id: "user-creator-A",
    latitude: 13.0827,
    longitude: 80.2707,
    status: "PROVISIONAL"
  };
  const mockLocations = [
    { user_id: "user-far-C", latitude: 13.2500, longitude: 80.4500 }
  ];

  const eligible = await getNearbyUsersForReport(report, 2.0, mockLocations);
  assert.equal(eligible.length, 0, "Non-nearby user must be excluded");
});

test("Req Test 4: Multiple nearby users are correctly identified", async () => {
  const report = {
    id: "rep-multi-test",
    user_id: "user-creator-A",
    latitude: 13.0827,
    longitude: 80.2707,
    status: "PROVISIONAL"
  };
  const mockLocations = [
    { user_id: "user-nearby-B", latitude: 13.0830, longitude: 80.2710 },
    { user_id: "user-nearby-C", latitude: 13.0840, longitude: 80.2720 },
    { user_id: "user-nearby-D", latitude: 13.0850, longitude: 80.2730 },
    { user_id: "user-far-E", latitude: 13.5000, longitude: 80.9000 }
  ];

  const eligible = await getNearbyUsersForReport(report, 2.0, mockLocations);
  assert.equal(eligible.length, 3);
  const ids = eligible.map(u => u.user_id);
  assert.ok(ids.includes("user-nearby-B"));
  assert.ok(ids.includes("user-nearby-C"));
  assert.ok(ids.includes("user-nearby-D"));
  assert.ok(!ids.includes("user-far-E"));
});

test("Req Test 5: No nearby users -> report remains PROVISIONAL", async () => {
  const reportData = {
    id: "rep-no-nearby-1",
    user_id: "isolated-user",
    latitude: 13.9900,
    longitude: 80.9900,
    report_type: "incident",
    description: "Isolated area event"
  };

  const created = await addCommunityReport(reportData);
  const mockLocations = [];

  const nearby = await getNearbyUsersForReport(created, 2.0, mockLocations);
  assert.equal(nearby.length, 0);
  assert.equal(created.status, "PROVISIONAL");
  assert.equal(getValidationStatusMultiplier(created), 0.0);
});

test("Req Test 6: Reporter cannot validate through backend", async () => {
  const reporterId = "11111111-1111-1111-1111-111111111111";
  const report = await addCommunityReport({
    id: "rep-self-val-backend",
    user_id: reporterId,
    latitude: 13.0827,
    longitude: 80.2707,
    description: "Self val test"
  });

  await assert.rejects(
    async () => {
      await corroborateReport(report.id, "SIMILAR", "Self feedback", reporterId);
    },
    (err) => Boolean(err && err.message && err.message.toLowerCase().includes("cannot validate your own")),
    "Backend must reject self-validation attempt by creator"
  );
});

test("Req Test 7: Nearby user can validate", async () => {
  const report = await addCommunityReport({
    id: "rep-valid-test-7",
    user_id: "reporter-A",
    latitude: 13.0827,
    longitude: 80.2707,
    description: "Validation test 7"
  });

  const res = await corroborateReport(report.id, "SIMILAR", "Confirmed", "user-nearby-valid-B");
  assert.equal(res.report.status, "CORROBORATED");
  assert.equal(res.report.corroboration_count, 1);
});

test("Req Test 8: Duplicate validation is rejected", async () => {
  const report = await addCommunityReport({
    id: "rep-dup-test-8",
    user_id: "reporter-A",
    latitude: 13.0827,
    longitude: 80.2707
  });

  await corroborateReport(report.id, "SIMILAR", "First confirmation", "user-validator-dup");
  
  await assert.rejects(
    async () => {
      await corroborateReport(report.id, "SIMILAR", "Second confirmation", "user-validator-dup");
    },
    (err) => Boolean(err && err.message && (err.message.toLowerCase().includes("already submitted") || err.message.toLowerCase().includes("duplicate"))),
    "Duplicate validation attempt by same user must be rejected"
  );
});

test("Req Test 9: PROVISIONAL = 0 safety-score impact", () => {
  const report = { status: "PROVISIONAL", corroboration_count: 0, created_at: new Date().toISOString() };
  assert.equal(getValidationStatusMultiplier(report), 0.0);
});

test("Req Test 10: CORROBORATED = positive safety-score impact", () => {
  const report = { status: "CORROBORATED", corroboration_count: 1, created_at: new Date().toISOString() };
  assert.ok(getValidationStatusMultiplier(report) >= 1.5);
});

test("Req Test 11: VERIFIED = stronger impact", () => {
  const report = { status: "VERIFIED", has_evidence: true, created_at: new Date().toISOString() };
  assert.equal(getValidationStatusMultiplier(report), 3.0);
});

test("Req Test 12: EXPIRED = 0 impact", () => {
  const report = { status: "EXPIRED", corroboration_count: 0, created_at: new Date().toISOString() };
  assert.equal(getValidationStatusMultiplier(report), 0.0);
});

// ============================================================
// REQUIRED NAVIGATION TESTS (13 - 18)
// ============================================================

test("Req Test 13: Destination A produces route A", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destA = { label: "Destination A", coords: [13.0900, 80.2800] };

  const evalA = await evaluateAllRoutes(origin, destA);
  assert.ok(evalA.safest);
  assert.equal(typeof evalA.safest.distance, "string");
  assert.equal(typeof evalA.safest.duration, "string");
});

test("Req Test 14: Destination B produces route B", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destB = { label: "Destination B", coords: [13.0400, 80.2000] };

  const evalB = await evaluateAllRoutes(origin, destB);
  assert.ok(evalB.safest);
  assert.equal(typeof evalB.safest.distance, "string");
});

test("Req Test 15: Destination C produces route C", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destC = { label: "Destination C", coords: [12.9716, 77.5946] };

  const evalC = await evaluateAllRoutes(origin, destC);
  assert.ok(evalC.safest);
  assert.equal(typeof evalC.safest.distance, "string");
});

test("Req Test 16: A -> B does not reuse A's route", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destA = { label: "Destination A", coords: [13.0900, 80.2800] };
  const destB = { label: "Destination B", coords: [13.0400, 80.2000] };

  const evalA = await evaluateAllRoutes(origin, destA);
  const evalB = await evaluateAllRoutes(origin, destB);

  assert.notEqual(evalA.safest.distanceMeters, evalB.safest.distanceMeters);
  assert.notDeepEqual(evalA.safest.path, evalB.safest.path);
});

test("Req Test 17: B -> C does not reuse B's route", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destB = { label: "Destination B", coords: [13.0400, 80.2000] };
  const destC = { label: "Destination C", coords: [12.9716, 77.5946] };

  const evalB = await evaluateAllRoutes(origin, destB);
  const evalC = await evaluateAllRoutes(origin, destC);

  assert.notEqual(evalB.safest.distanceMeters, evalC.safest.distanceMeters);
  assert.notDeepEqual(evalB.safest.path, evalC.safest.path);
});

test("Req Test 18: A -> B -> A does not incorrectly retain B's route", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destA = { label: "Destination A", coords: [13.0900, 80.2800] };
  const destB = { label: "Destination B", coords: [13.0400, 80.2000] };

  const evalA1 = await evaluateAllRoutes(origin, destA);
  const evalB = await evaluateAllRoutes(origin, destB);
  const evalA2 = await evaluateAllRoutes(origin, destA);

  assert.equal(evalA1.safest.distanceMeters, evalA2.safest.distanceMeters);
  assert.notEqual(evalA2.safest.distanceMeters, evalB.safest.distanceMeters);
});

test("Req Test 19: Sequential A -> B -> C -> A routing verification", async () => {
  const origin = { label: "Origin", coords: [13.0827, 80.2707] };
  const destA = { label: "Destination A", coords: [13.0900, 80.2800] };
  const destB = { label: "Destination B", coords: [13.0400, 80.2000] };
  const destC = { label: "Destination C", coords: [12.9716, 77.5946] };

  const routeA = await evaluateAllRoutes(origin, destA);
  const routeB = await evaluateAllRoutes(origin, destB);
  const routeC = await evaluateAllRoutes(origin, destC);
  const routeA_again = await evaluateAllRoutes(origin, destA);

  assert.notEqual(routeA.safest.distanceMeters, routeB.safest.distanceMeters, "A and B routes must differ");
  assert.notEqual(routeB.safest.distanceMeters, routeC.safest.distanceMeters, "B and C routes must differ");
  assert.notEqual(routeC.safest.distanceMeters, routeA.safest.distanceMeters, "C and A routes must differ");
  assert.equal(routeA.safest.distanceMeters, routeA_again.safest.distanceMeters, "Returning to A must produce route A");
});

test("Req Test 20: Validated hazard forces Safe Route geometry to differ from Fast Route geometry", async () => {
  const origin = { label: "Start", coords: [13.0827, 80.2707] };
  const destination = { label: "End", coords: [13.1400, 80.2800] }; // ~6.5 km distance

  // Place a CORROBORATED safety hazard directly along the midpoint of the direct corridor (3.1 km from origin & dest)
  const validatedReport = {
    id: "rep-validated-hazard-midpoint",
    user_id: "user-reporter-x",
    latitude: 13.1100,
    longitude: 80.2750,
    status: "CORROBORATED",
    corroboration_count: 3,
    safety_rating: 1,
    report_type: "incident",
    description: "Active high risk incident zone along direct corridor midpoint",
    created_at: new Date().toISOString()
  };

  const results = await evaluateAllRoutes(origin, destination, {
    safetyData: [],
    communityReports: [validatedReport]
  });

  assert.ok(results.fastest, "Fastest route exists");
  assert.ok(results.safest, "Safest route exists");

  // Verify Safe Route avoids the hazard, producing a safer alternative candidate
  assert.notEqual(results.fastest.routeId, results.safest.routeId, "Fast Route and Safe Route MUST select different candidate routes when a validated hazard penalizes the fast route");
  assert.equal(results.isIdentical, false, "isIdentical flag MUST be false when Safe Route takes a different path");
  assert.notDeepEqual(results.fastest.path, results.safest.path, "Geometries MUST differ");
  assert.ok(results.safest.displayedSafetyScore >= results.fastest.displayedSafetyScore, "Safe Route MUST have equal or higher safety score");
  assert.ok(results.fastest.dangerPenalty > results.safest.dangerPenalty, "Fast Route MUST have higher danger penalty than Safe Route");
});
