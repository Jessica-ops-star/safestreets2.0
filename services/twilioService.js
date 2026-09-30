import dotenv from "dotenv";
import twilio from "twilio";

dotenv.config({ override: true });

/**
 * Backend-only Twilio Voice Service
 */

export function getTwilioFromNumber() {
  return (
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.TWILIO_FROM_NUMBER ||
    process.env.TWILIO_CALLER_ID ||
    ""
  ).trim();
}

function formatPhoneForTwilio(phone) {
  if (!phone) return "";

  const trimmed = String(phone).trim();
  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");

  // 6382691953 -> +916382691953
  if (digits.length === 10) {
    return "+91" + digits;
  }

  // 916382691953 -> +916382691953
  if (digits.length === 12 && digits.startsWith("91")) {
    return "+" + digits;
  }

  // 06382691953 -> +916382691953
  if (digits.length === 11 && digits.startsWith("0")) {
    return "+91" + digits.slice(1);
  }

  return "+" + digits;
}

/**
 * Phonetic pronunciation helper for TTS engine
 */
export function formatNameForTTS(name) {
  if (!name || typeof name !== "string") return "A user";

  let formatted = name.trim();
  if (!formatted) return "A user";

  // Replace specific names with phonetic/syllable-spaced forms for clear speech synthesis
  formatted = formatted.replace(/Keerrthana/gi, "Keer-tha-na");
  formatted = formatted.replace(/Keerthana/gi, "Keer-tha-na");

  return formatted;
}

/**
 * Generate TwiML XML using Twilio VoiceResponse helper.
 * Message: "Hello. This is Safe Streets calling with an emergency alert. [NAME] has triggered the SOS button and is currently in an emergency. Their last known location has been shared with you by email. Please check the email immediately."
 */
export function generateTwimlMessage(userName) {
  const response = new twilio.twiml.VoiceResponse();
  const rawName = (userName && String(userName).trim()) || "";
  const nameToUse = rawName ? formatNameForTTS(rawName) : "A user";

  const message = `Hello. This is Safe Streets calling with an emergency alert. ${nameToUse} has triggered the SOS button and is currently in an emergency. Their last known location has been shared with you by email. Please check the email immediately.`;

  response.say({ voice: "alice" }, message);
  return response.toString();
}

/**
 * Make an outbound SOS call via Twilio.
 */
export async function callEmergencyContact(phoneNumber, userName = "A Safe Streets user", alertId = null, reqHost = null) {
  if (!phoneNumber) {
    return {
      success: false,
      error: "Emergency contact phone number is missing."
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = getTwilioFromNumber();

  if (!accountSid || !authToken || !twilioPhone) {
    console.error("❌ Missing Twilio environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER / TWILIO_FROM_NUMBER).");
    return {
      success: false,
      error: "Twilio credentials missing in server environment variables."
    };
  }

  const destinationNumber = formatPhoneForTwilio(phoneNumber);
  const rawName = (userName && String(userName).trim()) || "";
  const nameToUse = rawName ? formatNameForTTS(rawName) : "A Safe Streets user";

  try {
    const client = twilio(accountSid, authToken);

    console.log("\n================ TWILIO VOICE =================");
    console.log("Destination :", destinationNumber);
    console.log("Twilio From :", twilioPhone);
    console.log("User Name   :", nameToUse);
    console.log("Alert ID    :", alertId || "N/A");
    console.log("===============================================\n");

    const callOptions = {
      to: destinationNumber,
      from: twilioPhone
    };

    const webhookUrl = process.env.TWILIO_WEBHOOK_URL || process.env.PUBLIC_URL || (reqHost ? `https://${reqHost}` : null);

    // If a public domain/ngrok URL is configured, use the TwiML endpoint URL
    if (webhookUrl && !webhookUrl.includes("localhost") && !webhookUrl.includes("127.0.0.1")) {
      const cleanBase = webhookUrl.replace(/\/$/, "");
      const params = new URLSearchParams();
      if (alertId) params.append("alertId", alertId);
      if (rawName) params.append("name", rawName);
      callOptions.url = `${cleanBase}/api/twilio/voice?${params.toString()}`;
      console.log(`[Twilio Voice] Outbound call webhook URL: ${callOptions.url}`);
    } else if (process.env.TWILIO_VOICE_URL) {
      callOptions.url = process.env.TWILIO_VOICE_URL;
      console.log(`[Twilio Voice] Using custom voice URL: ${callOptions.url}`);
    } else {
      // Local development fallback: pass dynamic TwiML via Twimlet echo URL for trial account compatibility
      console.log("[Twilio Voice] Local environment: rendering dynamic TwiML via Twimlet echo URL.");
      const twimlXml = generateTwimlMessage(userName);
      callOptions.url = `http://twimlets.com/echo?Twiml=${encodeURIComponent(twimlXml)}`;
    }

    const call = await client.calls.create(callOptions);

    console.log(`✅ Twilio Voice call dispatched successfully. Call SID: ${call.sid}`);

    return {
      success: true,
      callSid: call.sid,
      status: call.status
    };
  } catch (err) {
    console.error("❌ Twilio Voice call error:", err.message);
    return {
      success: false,
      error: err.message,
      code: err.code || null
    };
  }
}
