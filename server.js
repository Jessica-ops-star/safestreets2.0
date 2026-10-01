import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { callEmergencyContact as callEmergencyContactTwilio, generateTwimlMessage, getTwilioFromNumber } from "./services/twilioService.js";
import { callEmergencyContact as callEmergencyContactExotel } from "./services/exotelService.js";
import { sendEmergencyEmail } from "./services/emailService.js";

dotenv.config({ override: true });

const app = express();

let latestVoiceEvent = {
  detected: false,
  timestamp: 0
};

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "dist")));

// ─────────────────────────────────────────────────────────────
// Supabase Admin Client (backend only)
// ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Supabase environment variables missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
}

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ─────────────────────────────────────────────────────────────
// Helper: Resolve Authenticated User ID from Bearer token or body
// ─────────────────────────────────────────────────────────────
async function resolveAuthenticatedUserId(req) {
  if (!supabase) return null;

  // Prefer Bearer token from Authorization header (most secure)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user?.id) {
        return user.id;
      }
    } catch {
      // fall through to body fallback
    }
  }

  // Fallback: accept userId from request body (used when token forwarding is unavailable)
  return req.body?.userId || req.body?.user_id || null;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ─────────────────────────────────────────────────────────────
// GET /api/hello — Health check
// ─────────────────────────────────────────────────────────────
app.get("/api/hello", (req, res) => {
  res.json({ message: "Safe Streets backend is running." });
});
// ─────────────────────────────────────────────────────────────
// POST /api/hardware/test — ESP32 connection test
// ─────────────────────────────────────────────────────────────
app.post("/api/hardware/test", (req, res) => {
  console.log("================================");
  console.log("✅ HARDWARE TEST RECEIVED");
  console.log("ESP32 data:", req.body);
  console.log("================================");

  res.json({
    success: true,
    message: "Safe Streets backend received ESP32 test."
  });
});
// ─────────────────────────────────────────────────────────────
// POST /api/hardware/sos — Safe ESP32 SOS Test
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// POST /api/hardware/sos — Identify ESP32 owner
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// POST /api/hardware/sos — Create SOS alert from ESP32
// ─────────────────────────────────────────────────────────────
app.post("/api/hardware/sos", async (req, res) => {
  try {

    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: "Supabase is not configured."
      });
    }


    // Update user's current location

    // ---------------------------------------------------------
    // Get data from ESP32
    // ---------------------------------------------------------

    const deviceId = req.body?.deviceId;
    const reason = req.body?.reason || "Hardware SOS";

    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        error: "deviceId is required."
      });
    }

    console.log("================================");
    console.log("🚨 HARDWARE SOS RECEIVED");
    console.log("Device ID:", deviceId);
    console.log("Reason:", reason);
    console.log("Latitude:", latitude);
    console.log("Longitude:", longitude);
    console.log("================================");


    // ---------------------------------------------------------
    // STEP 1: Find registered ESP32
    // ---------------------------------------------------------

    const { data: device, error: deviceError } = await supabase
      .from("hardware_devices")
      .select("device_id, device_name, user_id")
      .eq("device_id", deviceId)
      .single();

    if (deviceError || !device) {

      console.error(
        "❌ Hardware device not registered:",
        deviceError?.message
      );

      return res.status(404).json({
        success: false,
        error: "This ESP32 device is not registered."
      });
    }

    console.log("✅ Device found:", device.device_id);
    console.log("✅ Device owner:", device.user_id);


    // ---------------------------------------------------------
    // STEP 2: Find user
    // ---------------------------------------------------------

    const { data: userRecord, error: userError } = await supabase
      .from("users")
      .select("id, full_name, email, phone")
      .eq("id", device.user_id)
      .single();

    if (userError || !userRecord) {

      console.error(
        "❌ User not found:",
        userError?.message
      );

      return res.status(404).json({
        success: false,
        error: "User associated with this ESP32 was not found."
      });
    }

    console.log("✅ User identified:", userRecord.full_name);


    // ---------------------------------------------------------
    // STEP 3: Validate GPS
    // ---------------------------------------------------------

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude === 0 ||
      longitude === 0
    ) {

      console.warn("⚠️ GPS location is not available.");

      return res.status(400).json({
        success: false,
        error: "GPS location is not available. SOS alert was not created."
      });
    }


    // ---------------------------------------------------------
    // STEP 4: Create SOS alert
    // ---------------------------------------------------------

    const now = new Date().toISOString();

    const { data: alertData, error: alertError } = await supabase
      .from("sos_alerts")
      .insert({
        user_id: device.user_id,
        latitude: latitude,
        longitude: longitude,
        created_at: now
      })
      .select()
      .single();

    if (alertError) {

      console.error(
        "❌ Failed to create SOS alert:",
        alertError.message
      );

      return res.status(500).json({
        success: false,
        error: "Failed to create SOS alert."
      });
    }

    console.log("================================");
    console.log("🚨 SOFTWARE SOS ALERT CREATED");
    console.log("Alert ID:", alertData.id);
    console.log("User:", userRecord.full_name);
    console.log("Latitude:", latitude);
    console.log("Longitude:", longitude);
    console.log("================================");


    // ---------------------------------------------------------
    // STEP 5: Return success
    // ---------------------------------------------------------

    return res.json({

      success: true,

      message: "Hardware SOS created successfully.",

      alert: alertData,

      user: {
        id: userRecord.id,
        full_name: userRecord.full_name
      },

      location: {
        latitude,
        longitude
      },

      reason

    });

  } catch (err) {

    console.error(
      "❌ Hardware SOS error:",
      err
    );

    return res.status(500).json({
      success: false,
      error: err.message || "Hardware SOS processing failed."
    });
  }
});
// ─────────────────────────────────────────────────────────────
// POST /api/sos — Full SOS Workflow (10 steps)
// ─────────────────────────────────────────────────────────────
app.post("/api/sos", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: "Supabase is not configured on the backend. Check environment variables."
      });
    }

    // ── Step 1: Retrieve the currently authenticated user ──────────────────
    const userId = await resolveAuthenticatedUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User is not authenticated. Please log in before triggering SOS."
      });
    }

    console.log(`[SOS] Step 1 ✔ Authenticated user ID: ${userId}`);

    // ── Step 2: Retrieve the user record from the users table ──────────────
    const { data: userRecord, error: userError } = await supabase
      .from("users")























































      .select("id, full_name, phone")
      .eq("id", userId)
      .single();

    if (userError || !userRecord) {
      console.warn("[SOS] Step 2 ✘ Could not retrieve user record:", userError?.message);
      // Non-fatal — we still have userId. Continue.
    } else {
      console.log(`[SOS] Step 2 ✔ User record: ${userRecord.full_name} (${userRecord.phone})`);
    }

    // ── Step 3: Query emergency_contacts table for this user ───────────────
    const { data: emergencyContacts, error: contactError } = await supabase
      .from("emergency_contacts")
      .select("id, full_name, number, relationship, email, preferred_language, is_primary")
      .eq("user_id", userId);

    if (contactError) {
      console.error("[SOS] Step 3 ✘ emergency_contacts query error:", contactError.message);
    }

    console.log(`[SOS] Step 3 ✔ Found ${emergencyContacts?.length ?? 0} emergency contact(s) for user ${userId}`);

    // ── Step 4: Return error if no emergency contacts exist ────────────────
    if (!emergencyContacts || emergencyContacts.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No emergency contacts found for this user. Please add at least one emergency contact in your profile before using SOS."
      });
    }

    // ── Step 5: Use the first emergency contact's number ───────────────────
    const primaryContact = emergencyContacts[0];
    const emergencyContactPhone = primaryContact.number;

    if (!emergencyContactPhone) {
      return res.status(400).json({
        success: false,
        error: `Emergency contact "${primaryContact.full_name}" does not have a phone number. Please update the contact's number.`
      });
    }

    console.log(`[SOS] Step 5 ✔ Emergency contact: ${primaryContact.full_name} (${primaryContact.relationship}) — ${emergencyContactPhone}`);

    // ── Step 6: Retrieve latest location from user_locations ───────────────
    const { data: locationRows, error: locError } = await supabase
      .from("user_locations")
      .select("latitude, longitude, address, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (locError) {
      console.error("[SOS] Step 6 ✘ user_locations query error:", locError.message);
    }

    if (!locationRows || locationRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No location found for this user. Please enable location tracking before sending SOS."
      });
    }

    const latitude = Number(locationRows[0].latitude);
    const longitude = Number(locationRows[0].longitude);
    const address = locationRows[0].address || "Location stored";

    console.log(`[SOS] Step 6 ✔ Location: ${latitude}, ${longitude} — ${address}`);

    // ==========================================
    // FIND NEARBY SAFE STREETS USERS
    // ==========================================

    let nearbyUsers = [];

    if (!locError && locationRows?.length > 0) {
      const sosLatitude = Number(locationRows[0].latitude);
      const sosLongitude = Number(locationRows[0].longitude);

      const { data: allLocations, error: nearbyError } = await supabase
        .from("user_locations")
        .select("user_id, latitude, longitude, updated_at")
        .neq("user_id", userId);

      if (nearbyError) {
        console.error("[Nearby Users Error]", nearbyError);
      } else if (allLocations) {
        nearbyUsers = allLocations
          .map((location) => {
            const distance = calculateDistanceKm(
              sosLatitude,
              sosLongitude,
              Number(location.latitude),
              Number(location.longitude)
            );

            return {
              ...location,
              distance
            };
          })
          .filter((location) => location.distance <= 2);
      }

      console.log("🚨 SOS Location:", sosLatitude, sosLongitude);
      console.log("📍 Nearby Safe Streets users:", nearbyUsers);
    }

    // ============================================================
    // CREATE NOTIFICATIONS FOR NEARBY USERS
    // ============================================================

    if (nearbyUsers.length > 0) {

      const notifications = nearbyUsers.map((user) => ({
        user_id: user.user_id,
        type: "SOS_NEARBY",
        title: "🚨 SOS ALERT NEAR YOU",
        message: "A Safe Streets user near you has triggered an emergency alert.",
        latitude: latitude,
        longitude: longitude,
        is_read: false
      }));

      const { data: createdNotifications, error: notificationError } =
        await supabase
          .from("notifications")
          .insert(notifications)
          .select();

      if (notificationError) {

        console.error(
          "[SOS] Nearby notification error:",
          notificationError.message
        );

      } else {

        console.log(
          `🚨 Created ${createdNotifications.length} nearby SOS notification(s)`
        );

      }

    } else {

      console.log("📍 No Safe Streets users found within 2 km.");

    }

    // ── Step 7: Create record in sos_alerts (permanent snapshot) ──────────
    const now = new Date().toISOString();

    let createdAlert = null;

    const { data: alertData, error: alertError } = await supabase
      .from("sos_alerts")
      .insert({
        user_id: userId,
        latitude: latitude,
        longitude: longitude,
        created_at: now
      })
      .select()
      .single();

    if (!alertError && alertData) {
      createdAlert = alertData;
      console.log(`[SOS] Step 7 ✔ SOS alert created in sos_alerts: ${createdAlert.id}`);
    } else {
      console.warn("[SOS] Step 7 ✘ sos_alerts insert error:", alertError?.message);
      // Non-fatal — continue with Exotel call even if DB insert fails
      createdAlert = { user_id: userId, latitude, longitude, created_at: now };
    }

    // ── Step 8: Generate Google Maps URL ──────────────────────────────────
    const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
    console.log(`[SOS] Step 8 ✔ Google Maps URL: ${googleMapsUrl}`);
    // ── Step 8.5: Send Emergency Email ───────────────────────────────
    console.log("[SOS] Step 8.5 — Sending emergency email...");

    const emailResult = await sendEmergencyEmail({
      to: primaryContact.email,
      contactName: primaryContact.full_name || "Emergency Contact",
      userName: userRecord?.full_name || "Safe Streets User",
      userPhone: userRecord?.phone || "Not Available",
      mapsUrl: googleMapsUrl,
      latitude,
      longitude
    });

    if (emailResult.success) {
      console.log("[SOS] Step 8.5 ✔ Email sent successfully.");
    } else {
      console.warn("[SOS] Step 8.5 ✘ Email failed:", emailResult.error);
    }

    // ── Step 9: Call Emergency Voice API using emergency contacts ─────────────
    let twilioResult = null;
    let exotelResult = null;
    let voiceSuccess = false;
    let dispatchedContact = primaryContact;
    let voiceProvider = "none";

    const sosUserName = userRecord?.full_name || "A Safe Streets user";
    const requestHost = req.get("host");

    // Prioritize primary contact if set, then try available contacts
    const sortedContacts = [...emergencyContacts].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

    for (const contact of sortedContacts) {
      if (!contact.number) continue;
      const contactLang = contact.preferred_language || "en";
      console.log(`[SOS] Step 9 — Attempting Twilio call (Lang: ${contactLang}) to: ${contact.full_name || "Contact"} (${contact.number}) for user: ${sosUserName}`);
      const tResult = await callEmergencyContactTwilio(contact.number, sosUserName, createdAlert?.id, requestHost, contactLang);
      twilioResult = tResult;
      dispatchedContact = contact;

      if (tResult.success) {
        voiceSuccess = true;
        voiceProvider = "twilio";
        console.log(`[SOS] Step 9 ✔ Twilio call dispatched successfully to ${contact.full_name} (${contact.number}). Call SID: ${tResult.callSid}`);
        break;
      } else {
        console.warn(`[SOS] Step 9 ✘ Twilio call to ${contact.full_name} (${contact.number}) notice: ${tResult.error}`);

        // Attempt Exotel voice call fallback if Twilio fails
        console.log(`[SOS] Step 9 — Attempting Exotel call fallback to: ${contact.full_name || "Contact"} (${contact.number})...`);
        const eResult = await callEmergencyContactExotel(contact.number);
        exotelResult = eResult;
        if (eResult.success) {
          voiceSuccess = true;
          voiceProvider = "exotel";
          console.log(`[SOS] Step 9 ✔ Exotel call dispatched successfully to ${contact.full_name} (${contact.number}).`);
          break;
        } else {
          console.warn(`[SOS] Step 9 ✘ Exotel call fallback notice for ${contact.full_name}:`, eResult.error);
        }
      }
    }

    // ── Step 10: Return response ──────────────────────────────────
    const callErrorMessage = twilioResult?.error || exotelResult?.error || "Voice dispatch unavailable (Twilio trial unverified recipient / Exotel KYC required).";

    return res.json({
      success: true, // SOS alert snapshot created and email sent successfully
      emailSuccess: emailResult?.success ?? false,
      voiceSuccess: voiceSuccess,
      message: voiceSuccess
        ? `SOS alert recorded and emergency contact voice call dispatched via ${voiceProvider} to ${dispatchedContact.full_name || dispatchedContact.number}.`
        : `SOS alert recorded & emergency email sent to ${primaryContact.email || primaryContact.full_name}. Voice call notice: ${callErrorMessage}`,
      user: userRecord ? { id: userRecord.id, full_name: userRecord.full_name } : { id: userId },
      emergencyContact: {
        full_name: dispatchedContact.full_name,
        number: dispatchedContact.number,
        relationship: dispatchedContact.relationship,
        preferred_language: dispatchedContact.preferred_language || "en"
      },
      alert: createdAlert,
      location: { latitude, longitude, address },
      googleMapsUrl,
      twilio: twilioResult,
      exotel: exotelResult,
      email: emailResult
    });

  } catch (err) {
    console.error("[SOS] Unhandled error in POST /api/sos:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "An unexpected server error occurred while processing the SOS request."
    });
  }
});

// ─────────────────────────────────────────────────────────────
// POST/GET /api/twilio/voice — Dynamic TwiML Endpoint for Outbound Calls
// ─────────────────────────────────────────────────────────────
app.all("/api/twilio/voice", async (req, res) => {
  try {
    console.log("===== TWILIO WEBHOOK RECEIVED =====");
    console.log("Method:", req.method);
    console.log("Query:", req.query);
    console.log("Body:", req.body);

    const alertId = req.query.alertId || req.body?.alertId || req.query.alert_id || req.body?.alert_id;
    const userId = req.query.userId || req.body?.userId || req.query.user_id || req.body?.user_id;
    let userName = req.query.name || req.body?.name || req.query.userName || req.body?.userName;
    const language = req.query.language || req.body?.language || req.query.lang || req.body?.lang || "en";

    console.log("Language received:", language);

    // Retrieve user's full_name from Supabase database if not directly passed in parameters
    if (!userName && alertId && supabase) {
      const { data: alert } = await supabase
        .from("sos_alerts")
        .select("user_id")
        .eq("id", alertId)
        .single();

      if (alert?.user_id) {
        const { data: userRec } = await supabase
          .from("users")
          .select("full_name")
          .eq("id", alert.user_id)
          .single();

        if (userRec?.full_name) {
          userName = userRec.full_name;
        }
      }
    } else if (!userName && userId && supabase) {
      const { data: userRec } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", userId)
        .single();

      if (userRec?.full_name) {
        userName = userRec.full_name;
      }
    }

    console.log(`[Twilio TwiML] Generating dynamic TwiML for user: "${userName || "Unknown User"}" (Lang: ${language}, Alert ID: ${alertId || "N/A"})`);

    const twimlXml = generateTwimlMessage(userName, language);
    console.log("Generated TwiML:", twimlXml);

    res.type("text/xml").send(twimlXml);
  } catch (err) {
    console.error("[Twilio TwiML] Error generating TwiML:", err.message);
    const twimlXml = generateTwimlMessage(null, "en");
    console.log("Generated Fallback TwiML:", twimlXml);
    res.type("text/xml").send(twimlXml);
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/sos/call — Direct Twilio call test endpoint
// ─────────────────────────────────────────────────────────────
app.post("/api/sos/call", async (req, res) => {
  try {
    const targetPhone = req.body?.emergencyNumber || req.body?.phoneNumber || req.body?.phone || req.body?.userNumber;
    const userName = req.body?.userName || req.body?.name || "Test User";
    const language = req.body?.language || req.body?.lang || req.query?.language || "en";

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        error: "A phone number is required (emergencyNumber, phoneNumber, or phone)."
      });
    }

    const requestHost = req.get("host");
    const result = await callEmergencyContactTwilio(targetPhone, userName, null, requestHost, language);
    return res.json(result);
  } catch (err) {
    console.error("[Twilio Direct Call] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/hardware/voice-status — ESP32 Voice Event Polling Endpoint
// ─────────────────────────────────────────────────────────────
app.get("/api/hardware/voice-status", (req, res) => {
  const now = Date.now();

  const valid =
    latestVoiceEvent.detected &&
    (now - latestVoiceEvent.timestamp <= 15000);

  if (valid) {
    const eventTimestamp = latestVoiceEvent.timestamp;

    // Consume the event so it is not repeatedly detected
    latestVoiceEvent.detected = false;

    console.log("🎙️ ESP32 received VOICE HELP event");

    return res.json({
      success: true,
      voiceDetected: true,
      timestamp: eventTimestamp
    });
  }

  return res.json({
    success: true,
    voiceDetected: false
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/predict-voice — PyTorch Voice ML Inference Endpoint
// ─────────────────────────────────────────────────────────────
app.post("/api/predict-voice", async (req, res) => {
  try {
    const audioData = req.body?.audio || req.body?.audioData || req.body?.base64;

    if (!audioData) {
      return res.status(400).json({
        success: false,
        error: "Missing audio data in request payload."
      });
    }

    // Robust Base64 data-URL extraction (handles ;codecs=opus and other MIME parameters)
    let base64Clean = audioData;
    if (typeof base64Clean === "string" && base64Clean.includes(",")) {
      base64Clean = base64Clean.substring(base64Clean.indexOf(",") + 1);
    }

    const buffer = Buffer.from(base64Clean, "base64");

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or empty audio buffer."
      });
    }

    console.log("[Voice ML] Received audio data URL:", {
      prefix: typeof audioData === "string" ? audioData.substring(0, 80) : typeof audioData,
      base64Length: base64Clean.length,
      bufferLength: buffer.length
    });

    // Write temp input file
    const scratchDir = path.join(__dirname, "scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const tempFileName = `temp_voice_${crypto.randomBytes(6).toString("hex")}.webm`;
    const tempFilePath = path.join(scratchDir, tempFileName);
    fs.writeFileSync(tempFilePath, buffer);

    console.log("[Voice ML] Temporary WebM file:", {
      path: tempFilePath,
      size: fs.statSync(tempFilePath).size
    });

    // server.js is already in the project root
    const rootDir = __dirname;
    const pythonScript = path.join(rootDir, "convert_and_predict.py");

    const cmd = `python "${pythonScript}" --audio_path "${tempFilePath}"`;

    exec(cmd, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up input temp file immediately
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch { }
      }

      if (error) {
        console.error("[Voice ML API Error]");
        console.error("Command:", cmd);
        console.error("Error:", error.message);
        console.error("STDOUT:", stdout);
        console.error("STDERR:", stderr);

        return res.status(500).json({
          success: false,
          error: "Voice prediction failed during audio conversion or model execution."
        });
      }

      try {
        const result = JSON.parse(stdout.trim());

        console.log("[Voice ML] Prediction:", result);

        const predictedClass = result?.prediction || result?.predicted_class;
        const confidenceScore = Number(result?.confidence || result?.confidence_pct || 0);

        if (
          predictedClass === "HELP" &&
          confidenceScore > 0
        ) {
          latestVoiceEvent = {
            detected: true,
            timestamp: Date.now()
          };

          console.log("🚨 VOICE HELP EVENT STORED FOR ESP32");
        }

        return res.json(result);
      } catch (parseErr) {
        console.error("[Voice ML Output Parse Error]:", stdout);
        return res.status(500).json({
          success: false,
          error: "Failed to parse voice prediction output."
        });
      }
    });
  } catch (err) {
    console.error("[Voice ML Route Exception]:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during voice processing."
    });
  }
});

app.post("/api/location/update", async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "userId, latitude and longitude are required"
      });
    }

    const { data, error } = await supabase
      .from("user_locations")
      .upsert(
        {
          user_id: userId,
          latitude: Number(latitude),
          longitude: Number(longitude),
          updated_at: new Date().toISOString()
        },
        {
          onConflict: "user_id"
        }
      )
      .select()
      .single();

    if (error) {
      console.error("[Location Update Error]", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update location",
        error: error.message
      });
    }

    console.log(
      `📍 Location updated: ${userId} → ${latitude}, ${longitude}`
    );

    res.json({
      success: true,
      message: "Location updated",
      location: data
    });

  } catch (error) {
    console.error("[Location Update]", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 404 — API routes only
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not Found", path: req.originalUrl });
  }
  next();
});



// ─────────────────────────────────────────────────────────────
// SPA fallback (React / Vite)
// ─────────────────────────────────────────────────────────────
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});


// ─────────────────────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err?.stack || err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {})
  });
});

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────
const port = process.env.PORT || 3000;



app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Safe Streets server running on port ${port}`);
  console.log(`[Twilio Config] Active Outbound FROM Number: ${getTwilioFromNumber() || "NOT CONFIGURED"}`);
});