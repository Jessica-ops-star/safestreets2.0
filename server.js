import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { callEmergencyContact as callEmergencyContactTwilio, generateTwimlMessage, getTwilioFromNumber } from "./services/twilioService.js";
import { sendEmergencyEmail } from "./services/emailService.js";

dotenv.config({ override: true });

const app = express();
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
      .select("id, full_name, number, relationship, email")
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

    // ── Step 9: Call Twilio Voice API using emergency contacts ─────────────
    let twilioResult = null;
    let voiceSuccess = false;
    let dispatchedContact = primaryContact;

    const sosUserName = userRecord?.full_name || "A Safe Streets user";
    const requestHost = req.get("host");

    // Prioritize primary contact if set, then try available contacts
    const sortedContacts = [...emergencyContacts].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

    for (const contact of sortedContacts) {
      if (!contact.number) continue;
      console.log(`[SOS] Step 9 — Attempting Twilio call to: ${contact.full_name || "Contact"} (${contact.number}) for user: ${sosUserName}`);
      const result = await callEmergencyContactTwilio(contact.number, sosUserName, createdAlert?.id, requestHost);
      twilioResult = result;
      dispatchedContact = contact;

      if (result.success) {
        voiceSuccess = true;
        console.log(`[SOS] Step 9 ✔ Twilio call dispatched successfully to ${contact.full_name} (${contact.number}). Call SID: ${result.callSid}`);
        break;
      } else {
        console.warn(`[SOS] Step 9 ✘ Twilio call to ${contact.full_name} (${contact.number}) notice: ${result.error}`);
      }
    }

    // ── Step 10: Return response ──────────────────────────────────
    return res.json({
      success: voiceSuccess,
      message: voiceSuccess
        ? `SOS alert recorded and emergency contact voice call dispatched to ${dispatchedContact.full_name || dispatchedContact.number}.`
        : `SOS alert recorded, but voice call failed: ${twilioResult?.error || "Unable to dispatch call."}`,
      user: userRecord ? { id: userRecord.id, full_name: userRecord.full_name } : { id: userId },
      emergencyContact: {
        full_name: dispatchedContact.full_name,
        number: dispatchedContact.number,
        relationship: dispatchedContact.relationship
      },
      alert: createdAlert,
      location: { latitude, longitude, address },
      googleMapsUrl,
      twilio: twilioResult,
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
    const alertId = req.query.alertId || req.body?.alertId || req.query.alert_id || req.body?.alert_id;
    const userId = req.query.userId || req.body?.userId || req.query.user_id || req.body?.user_id;
    let userName = req.query.name || req.body?.name || req.query.userName || req.body?.userName;

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

    console.log(`[Twilio TwiML] Generating dynamic TwiML for user: "${userName || "Unknown User"}" (Alert ID: ${alertId || "N/A"})`);

    const twimlXml = generateTwimlMessage(userName);
    res.type("text/xml").send(twimlXml);
  } catch (err) {
    console.error("[Twilio TwiML] Error generating TwiML:", err.message);
    const twimlXml = generateTwimlMessage(null);
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

    if (!targetPhone) {
      return res.status(400).json({
        success: false,
        error: "A phone number is required (emergencyNumber, phoneNumber, or phone)."
      });
    }

    const requestHost = req.get("host");
    const result = await callEmergencyContactTwilio(targetPhone, userName, null, requestHost);
    return res.json(result);
  } catch (err) {
    console.error("[Twilio Direct Call] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
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

    // Strip Base64 data URL header if present
    const base64Clean = audioData.replace(/^data:audio\/\w+;base64,/, "").replace(/^data:application\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Clean, "base64");

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or empty audio buffer."
      });
    }

    // Write temp input file
    const scratchDir = path.join(__dirname, "scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const tempFileName = `temp_voice_${crypto.randomBytes(6).toString("hex")}.webm`;
    const tempFilePath = path.join(scratchDir, tempFileName);
    fs.writeFileSync(tempFilePath, buffer);

    // Root directory containing convert_and_predict.py
    const rootDir = path.resolve(__dirname, "..");
    const pythonScript = path.join(rootDir, "convert_and_predict.py");

    const cmd = `python "${pythonScript}" --audio_path "${tempFilePath}"`;

    exec(cmd, { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up input temp file immediately
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch { }
      }

      if (error) {
        console.error("[Voice ML API Error]:", stderr || error.message);
        return res.status(500).json({
          success: false,
          error: "Voice prediction failed during audio conversion or model execution."
        });
      }

      try {
        const result = JSON.parse(stdout.trim());
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