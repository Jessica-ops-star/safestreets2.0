import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { EmergencyContact, SOSAlert, triggerSOS } from "../entities/all.js";
import { supabase } from "../src/lib/supabase.js";
import { useLocationTracking } from "../hooks/useLocationTracking.js";
import { Button } from "../components/ui/button.jsx";
import { Card, CardContent } from "../components/ui/card.jsx";
import {
  AlertTriangle,
  Phone,
  Users,
  MapPin,
  Mic,
  Shield,
  Clock,
  Zap,
  Activity,
  Verified,
  LifeBuoy,
  Wifi,
  Radio,
  Building,
  HeartPulse,
  ExternalLink,
  CheckCircle2,
  Navigation
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import SOSButton from "../components/emergency/sosbutton.jsx";
import EmergencyContacts from "../components/emergency/emergencycontacts.jsx";
import { VoiceActivation } from "../components/emergency/VoiceActivation.jsx";
import { getTrustedPlaces, findNearbyTrustedPlace, TRUSTED_PLACE_PROXIMITY_THRESHOLD_METERS } from "../services/trustedPlacesService.js";
import { findNearestPoliceStation, findNearestHospital } from "../services/nearbySafetyService.js";
import {
  getSOSState,
  startSOSCountdown,
  cancelSOSCountdown,
  resolveActiveSOSAlert,
  finalizeSOSWorkflow
} from "../services/sosStateService.js";

export default function Emergency() {
  const navigate = useNavigate();
  const { getCurrentLocation, reverseGeocode, saveLocation } = useLocationTracking();

  const [contacts, setContacts] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [loading, setLoading] = useState(true);
  const [countdownActive, setCountdownActive] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(45);
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [workflowStatus, setWorkflowStatus] = useState("Standby");
  const [lastKnownLocation, setLastKnownLocation] = useState(null);

  // Trusted Places & Nearby Safety Assistance State for SOS
  const [trustedPlaces, setTrustedPlaces] = useState([]);
  const [nearbyTrustedPlaceResult, setNearbyTrustedPlaceResult] = useState(null);
  const [nearestPoliceStation, setNearestPoliceStation] = useState(null);
  const [nearestHospital, setNearestHospital] = useState(null);

  // Sync state with sosStateService
  const syncSOSState = () => {
    const currentState = getSOSState();
    if (currentState.status === "countdown") {
      setCountdownActive(true);
      setCountdownSeconds(currentState.remainingSeconds);
      setWorkflowStatus("Countdown active");
      setWorkflowMessage(`${currentState.source || "SOS"} trigger received. Emergency protocol will activate in ${currentState.remainingSeconds} seconds.`);
      if (currentState.remainingSeconds <= 0) {
        void handleFinalizeSOS();
      }
    } else if (currentState.status === "active") {
      setCountdownActive(false);
      setActiveAlert(currentState.activeAlert);
      if (currentState.location) {
        setLastKnownLocation({
          latitude: Number(currentState.location.latitude),
          longitude: Number(currentState.location.longitude)
        });
      }
      setWorkflowStatus("Dispatching support");
    } else {
      setCountdownActive(false);
      if (activeAlert && currentState.status === "idle") {
        setActiveAlert(null);
      }
    }
  };

  const handleFinalizeSOS = async () => {
    try {
      setWorkflowStatus("Dispatching support");
      const res = await finalizeSOSWorkflow(contacts);
      setActiveAlert(res.alert);
      if (res.location) {
        setLastKnownLocation({
          latitude: Number(res.location.latitude),
          longitude: Number(res.location.longitude)
        });
      }
      setCountdownActive(false);
      const locDisplay = res.location?.address || `${Number(res.location?.latitude).toFixed(4)}, ${Number(res.location?.longitude).toFixed(4)}`;
      setWorkflowMessage(`SOS dispatch active at ${locDisplay}.`);
      if (navigator.vibrate) navigator.vibrate([200, 100, 300]);
    } catch (err) {
      console.error("Failed to finalize SOS:", err);
      setWorkflowStatus("Location error");
      setWorkflowMessage(err.message || "Emergency dispatch error.");
    }
  };

  const loadEmergencyData = async () => {
    try {
      setLoading(true);

      const [contactList, savedTrustedPlaces] = await Promise.all([
        EmergencyContact.list(),
        getTrustedPlaces()
      ]);

      setContacts(contactList || []);
      setTrustedPlaces(savedTrustedPlaces || []);

      // Fetch user live location on mount for nearby police station & hospital context
      try {
        const loc = await getCurrentLocation();
        if (loc?.latitude && loc?.longitude) {
          setLastKnownLocation({
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude)
          });
        }
      } catch (locErr) {
        console.warn("Initial location fetch notice:", locErr);
      }
    } catch (error) {
      console.error("Error loading emergency data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmergencyData();
    syncSOSState();

    const handleStateChange = () => syncSOSState();

    window.addEventListener("sos_state_changed", handleStateChange);

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setContacts([]);
        EmergencyContact.clearCache();

        if (session?.user) {
          loadEmergencyData();
        }
      }
    );

    // ============================================
    // ESP32 HARDWARE SOS REALTIME LISTENER
    // ============================================

    const hardwareSOSChannel = supabase
      .channel("hardware-sos-alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sos_alerts",
        },
        (payload) => {
          console.log("🚨 HARDWARE SOS RECEIVED IN REACT:", payload);

          const alert = payload.new;

          // Make sure this alert belongs to the logged-in user
          const currentUser = JSON.parse(
            localStorage.getItem("current_user") || "null"
          );

          console.log("👤 Current application user:", currentUser);

          if (!currentUser) {
            console.warn("No application user found.");
            return;
          }

          console.log("🔍 Hardware SOS user_id:", alert.user_id);
          console.log("🔍 Current user id:", currentUser.id);

          if (alert.user_id !== currentUser.id) {
            console.log("SOS belongs to another user. Ignoring.");
            return;
          }

          // Convert database row to the format expected by the UI
          const hardwareAlert = {
            id: alert.id,
            user_id: alert.user_id,
            latitude: Number(alert.latitude),
            longitude: Number(alert.longitude),
            created_at: alert.created_at,
            created_date: alert.created_at,
            status: "active",
            alert_type: "hardware_sos",
            message: "Emergency SOS triggered from Safe Streets wearable.",
            location: "Wearable GPS Location",
          };
          console.log("🚨 HARDWARE SOS DETECTED:", hardwareAlert);

          // Start the existing 45-second SOS countdown
          const countdownState = startSOSCountdown(
            "hardware_sos",
            "Emergency SOS triggered from Safe Streets wearable.",
            "HARDWARE"
          );

          console.log("⏱️ Hardware SOS countdown started:", countdownState);

          // Save the hardware GPS location
          setLastKnownLocation({
            latitude: Number(alert.latitude),
            longitude: Number(alert.longitude),
          });

          // Start showing the countdown in the software
          setActiveAlert(null);
          setCountdownActive(true);
          setWorkflowStatus("Emergency countdown started");

          setWorkflowMessage(
            `Hardware SOS detected at ${Number(alert.latitude).toFixed(4)}, ${Number(alert.longitude).toFixed(4)}.`
          );


        },
      )
      .subscribe((status) => {
        console.log("📡 Hardware SOS realtime status:", status);
      });

    return () => {
      window.removeEventListener("sos_state_changed", handleStateChange);
      authListener?.subscription?.unsubscribe();

      // Remove Supabase Realtime listener
      supabase.removeChannel(hardwareSOSChannel);
    };
  }, []);

  // Real-time ticking interval for countdown
  useEffect(() => {
    if (!countdownActive) return undefined;

    const timer = window.setInterval(() => {
      const currentState = getSOSState();
      if (currentState.status === "countdown") {
        setCountdownSeconds(currentState.remainingSeconds);
        setWorkflowMessage(`${currentState.source || "SOS"} trigger received. Emergency protocol will activate in ${currentState.remainingSeconds} seconds.`);

        if (currentState.remainingSeconds <= 1) {
          window.clearInterval(timer);
          void handleFinalizeSOS();
        }
      } else {
        setCountdownActive(false);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [countdownActive, contacts]);

  // Update Trusted Place & Nearby Police/Hospital context when location/activeAlert changes
  useEffect(() => {
    const lat = activeAlert?.latitude || lastKnownLocation?.latitude;
    const lon = activeAlert?.longitude || lastKnownLocation?.longitude;

    if (!lat || !lon) {
      setNearbyTrustedPlaceResult(null);
      setNearestPoliceStation(null);
      setNearestHospital(null);
      return;
    }

    const proxResult = findNearbyTrustedPlace(lat, lon, trustedPlaces, TRUSTED_PLACE_PROXIMITY_THRESHOLD_METERS);
    setNearbyTrustedPlaceResult(proxResult);

    // Fetch dynamic nearby safety assistance for SOS
    let isMounted = true;
    Promise.all([
      findNearestPoliceStation(lat, lon),
      findNearestHospital(lat, lon)
    ]).then(([police, hospital]) => {
      if (isMounted) {
        setNearestPoliceStation(police);
        setNearestHospital(hospital);
      }
    }).catch((err) => console.error("Error fetching nearby safety assistance for SOS:", err));

    return () => { isMounted = false; };
  }, [activeAlert, lastKnownLocation, trustedPlaces]);

  const startEmergencyWorkflow = (alertType = 'manual_sos', message = '', source = 'SOS') => {
    startSOSCountdown(alertType, message, source);
    setCountdownActive(true);
    setCountdownSeconds(45);
    setWorkflowStatus("Countdown active");
    setWorkflowMessage(`${source} trigger received. Emergency protocol will activate in 45 seconds.`);
  };

  const cancelEmergencyWorkflow = () => {
    cancelSOSCountdown();
    setCountdownActive(false);
    setWorkflowStatus("Cancelled");
    setWorkflowMessage("Emergency protocol cancelled. Safe status restored.");
  };

  const handleSOSAlert = async (alertType = 'manual_sos', message = '') => {
    startEmergencyWorkflow(alertType, message, "SOS");
  };

  const resolveAlert = async () => {
    await resolveActiveSOSAlert();
    setActiveAlert(null);
    setWorkflowStatus("Standby");
  };

  const handleNavigateToPolice = () => {
    if (!nearestPoliceStation?.latitude || !nearestPoliceStation?.longitude) return;
    navigate(`/safenavigation?destLat=${nearestPoliceStation.latitude}&destLon=${nearestPoliceStation.longitude}&destLabel=${encodeURIComponent(nearestPoliceStation.name)}`);
  };

  const handleNavigateToHospital = () => {
    if (!nearestHospital?.latitude || !nearestHospital?.longitude) return;
    navigate(`/safenavigation?destLat=${nearestHospital.latitude}&destLon=${nearestHospital.longitude}&destLabel=${encodeURIComponent(nearestHospital.name)}`);
  };

  return (
    <div className="space-y-12 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/50">
        <div>
          <div className="flex items-center gap-2 text-rose-600 font-bold uppercase tracking-[0.2em] text-xs mb-3">
            <Radio className="w-4 h-4" />
            Priority Signal Base
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
            Emergency <span className="gradient-text-rose">Center</span>
          </h1>
        </div>
      </div>

      {/* Active SOS Alert Banner with Trusted Place Context & Nearby Safety Assistance */}
      <AnimatePresence>
        {activeAlert && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            className="premium-card bg-rose-600 p-8 text-white shadow-2xl shadow-rose-600/40 overflow-hidden relative space-y-6"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/20 blur-[100px] rounded-full -mr-32 -mt-32 animate-pulse"></div>

            <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10 border-b border-white/20 pb-6">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-white/20 backdrop-blur-xl rounded-[2rem] flex items-center justify-center border border-white/30 shadow-inner shrink-0">
                  <AlertTriangle className="w-10 h-10 text-white animate-bounce" />
                </div>
                <div>
                  <h3 className="text-3xl font-black tracking-tight mb-1">🚨 SOS ACTIVE</h3>
                  <p className="text-rose-100 font-bold uppercase tracking-[0.2em] text-xs pl-0.5">
                    Dispatch initiated at {new Date(activeAlert.created_date || activeAlert.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              <Button
                onClick={resolveAlert}
                variant="outline"
                className="btn-premium bg-white text-slate-900 hover:bg-slate-100 border-0 px-8 py-6 h-auto text-lg font-black shrink-0 shadow-md transition-colors"
              >
                <span className="text-slate-900 font-black">Mark Status: Guarded</span>
                <Verified className="w-6 h-6 ml-2 text-slate-900 shrink-0" />
              </Button>
            </div>

            {/* Emergency Context Section (Trusted Place & Nearby Assistance) */}
            <div className="grid md:grid-cols-2 gap-6 relative z-10 text-slate-900">
              {/* Current Location & Trusted Place Context */}
              <div className="p-5 rounded-2xl bg-white/95 backdrop-blur-md shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-rose-600" />
                    Current Location Context
                  </span>
                  <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded-md">
                    GPS Active
                  </span>
                </div>

                {nearbyTrustedPlaceResult?.isNear ? (
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      📍 Near {nearbyTrustedPlaceResult.nearestPlace.category}
                    </div>
                    <div className="text-lg font-black text-slate-900">
                      Trusted Place: {nearbyTrustedPlaceResult.nearestPlace.place_name}
                    </div>
                    <div className="text-xs text-slate-600 font-medium">
                      {nearbyTrustedPlaceResult.nearestPlace.formatted_address} ({nearbyTrustedPlaceResult.formattedDistance} away)
                    </div>
                  </div>
                ) : (
                  <div className="text-xs font-bold text-slate-600 italic py-1">
                    Location not near a saved Trusted Place.
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs font-extrabold">
                  <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Emergency Contacts: Alerted
                  </span>
                  <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Guardian: Alerted
                  </span>
                </div>
              </div>

              {/* Dynamic Nearby Safety Assistance */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 text-slate-900 shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Nearby Emergency Facilities
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* Police Station */}
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 space-y-2">
                    <div className="text-[10px] font-black text-blue-900 uppercase tracking-wider">
                      Nearest Police Assistance
                    </div>
                    {nearestPoliceStation ? (
                      <>
                        <div className="font-black text-slate-900 line-clamp-1">{nearestPoliceStation.name}</div>
                        <div className="text-[10px] text-blue-900 font-extrabold">{nearestPoliceStation.formattedDistance}</div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-blue-100">
                          <button
                            type="button"
                            onClick={handleNavigateToPolice}
                            className="text-[10px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded-md flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                          >
                            <Navigation className="w-2.5 h-2.5" /> Navigate
                          </button>
                          <a
                            href={nearestPoliceStation.mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-extrabold text-blue-800 hover:text-blue-950 underline flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-2.5 h-2.5" /> View Map
                          </a>
                          {nearestPoliceStation.phone ? (
                            <a
                              href={`tel:${nearestPoliceStation.phone}`}
                              className="text-[10px] font-extrabold text-emerald-800 hover:text-emerald-950 underline flex items-center gap-0.5"
                            >
                              <Phone className="w-2.5 h-2.5" /> Call
                            </a>
                          ) : (
                            <span className="text-[9px] text-slate-500 font-medium italic">Phone unavailable</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-slate-700 font-bold">No nearby police station found.</div>
                    )}
                  </div>

                  {/* Hospital */}
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-2">
                    <div className="text-[10px] font-black text-rose-900 uppercase tracking-wider">
                      Nearest Medical Facility
                    </div>
                    {nearestHospital ? (
                      <>
                        <div className="font-black text-slate-900 line-clamp-1">{nearestHospital.name}</div>
                        <div className="text-[10px] text-rose-900 font-extrabold">{nearestHospital.formattedDistance}</div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-rose-100">
                          <button
                            type="button"
                            onClick={handleNavigateToHospital}
                            className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 px-2 py-1 rounded-md flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                          >
                            <Navigation className="w-2.5 h-2.5" /> Navigate
                          </button>
                          <a
                            href={nearestHospital.mapUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-extrabold text-rose-800 hover:text-rose-950 underline flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-2.5 h-2.5" /> View Map
                          </a>
                          {nearestHospital.phone ? (
                            <a
                              href={`tel:${nearestHospital.phone}`}
                              className="text-[10px] font-extrabold text-emerald-800 hover:text-emerald-950 underline flex items-center gap-0.5"
                            >
                              <Phone className="w-2.5 h-2.5" /> Call
                            </a>
                          ) : (
                            <span className="text-[9px] text-slate-500 font-medium italic">Phone unavailable</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-slate-700 font-bold">No nearby hospital found.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {countdownActive && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="premium-card border-amber-200 bg-amber-50/80 p-6 shadow-lg"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.25em] text-amber-700">Emergency countdown</div>
                <div className="text-lg font-semibold text-slate-900">{workflowMessage}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white px-4 py-2 text-amber-700 font-black text-lg">{countdownSeconds}s</div>
                <Button onClick={cancelEmergencyWorkflow} className="bg-slate-900 text-white font-bold">Cancel</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid lg:grid-cols-12 gap-10">
        {/* SOS Action Center */}
        <div className="lg:col-span-12 space-y-4">
          <SOSButton onSOSAlert={handleSOSAlert} disabled={!!activeAlert} />
        </div>

        {/* Nearby Emergency Facilities (Hidden when SOS is active to avoid duplicate display) */}
        {!activeAlert && (
          <div className="lg:col-span-12">
            <Card className="premium-card glass border-white/60 p-6 bg-white/60 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200/60">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-black shadow-md">
                    <Shield className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Nearby Emergency Facilities</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Nearest Police Station & Medical Hospital</p>
                  </div>
                </div>
                {lastKnownLocation && (
                  <div className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 flex items-center gap-1.5 self-start sm:self-auto">
                    <MapPin className="w-3.5 h-3.5 text-rose-600" />
                    <span>GPS: {lastKnownLocation.latitude.toFixed(4)}, {lastKnownLocation.longitude.toFixed(4)}</span>
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Nearest Police Station Card */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50/90 to-slate-50 border border-blue-200/80 space-y-3 shadow-md relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-md">
                        <Building className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-blue-800 uppercase tracking-wider">Nearest Police Station</div>
                        <div className="text-sm font-black text-slate-900 line-clamp-1">{nearestPoliceStation?.name || "Searching police stations..."}</div>
                      </div>
                    </div>
                    {nearestPoliceStation && (
                      <span className="text-[11px] font-extrabold bg-blue-100 text-blue-900 px-2.5 py-1 rounded-lg border border-blue-200">
                        📍 {nearestPoliceStation.formattedDistance}
                      </span>
                    )}
                  </div>

                  {nearestPoliceStation ? (
                    <div className="space-y-3 pt-1">
                      <div className="text-xs text-slate-600 font-medium line-clamp-2">{nearestPoliceStation.address || nearestPoliceStation.full_address}</div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-blue-100">
                        <button
                          type="button"
                          onClick={handleNavigateToPolice}
                          className="text-xs font-black text-white bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5 fill-white" /> Navigate
                        </button>
                        <a
                          href={nearestPoliceStation.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-extrabold text-blue-800 hover:text-blue-950 bg-white hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View Map
                        </a>
                        {nearestPoliceStation.phone ? (
                          <a
                            href={`tel:${nearestPoliceStation.phone}`}
                            className="text-xs font-black text-emerald-800 hover:text-emerald-950 bg-white hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1 transition-colors"
                          >
                            <Phone className="w-3.5 h-3.5" /> Call ({nearestPoliceStation.phone})
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-medium italic">Phone unavailable</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 font-medium py-2 flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
                      Locating nearest police assistance station...
                    </div>
                  )}
                </div>

                {/* Nearest Hospital Card */}
                <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-50/90 to-slate-50 border border-rose-200/80 space-y-3 shadow-md relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-md">
                        <HeartPulse className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-rose-800 uppercase tracking-wider">Nearest Hospital</div>
                        <div className="text-sm font-black text-slate-900 line-clamp-1">{nearestHospital?.name || "Searching medical facilities..."}</div>
                      </div>
                    </div>
                    {nearestHospital && (
                      <span className="text-[11px] font-extrabold bg-rose-100 text-rose-900 px-2.5 py-1 rounded-lg border border-rose-200">
                        📍 {nearestHospital.formattedDistance}
                      </span>
                    )}
                  </div>

                  {nearestHospital ? (
                    <div className="space-y-3 pt-1">
                      <div className="text-xs text-slate-600 font-medium line-clamp-2">{nearestHospital.address || nearestHospital.full_address}</div>
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-rose-100">
                        <button
                          type="button"
                          onClick={handleNavigateToHospital}
                          className="text-xs font-black text-white bg-rose-600 hover:bg-rose-700 px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5 fill-white" /> Navigate
                        </button>
                        <a
                          href={nearestHospital.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-extrabold text-rose-800 hover:text-rose-950 bg-white hover:bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> View Map
                        </a>
                        {nearestHospital.phone ? (
                          <a
                            href={`tel:${nearestHospital.phone}`}
                            className="text-xs font-black text-emerald-800 hover:text-emerald-950 bg-white hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1 transition-colors"
                          >
                            <Phone className="w-3.5 h-3.5" /> Call ({nearestHospital.phone})
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-medium italic">Phone unavailable</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 font-medium py-2 flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border-2 border-rose-600 border-t-transparent animate-spin"></div>
                      Locating nearest hospital & emergency care...
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Tactical Controls */}
        <div className="lg:col-span-5 space-y-8">
          <Card className="premium-card glass border-white/60 p-8 bg-white/40 shadow-xl">
            <div className="space-y-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500">
                  <Mic className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">Voice Engagement</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Acoustic Signal Recognition</p>
                </div>
              </div>

              <VoiceActivation
                isListening={isListening}
                onToggleListening={setIsListening}
                onVoiceAlert={handleSOSAlert}
                disabled={!!activeAlert}
              />

              <div className="pt-6 border-t border-slate-100/50 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {isListening ? 'Listening for strategic keywords...' : 'Voice protocol standby'}
                </span>
              </div>
            </div>
          </Card>

          <Card className="premium-card glass-dark p-8 border-0 shadow-2xl">
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-white">
                  <LifeBuoy className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">Rapid Response</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Immediate Sector Support</p>
                </div>
              </div>

              <p className="text-slate-400 text-sm font-medium leading-relaxed">
                Direct connection to regional dispatch centers is synchronized.
                <span className="text-emerald-400 italic"> Tactical Guardian units</span> are briefed on your real-time vector.
              </p>

              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-slate-300">
                <div className="font-semibold text-white">Protocol status</div>
                <div>{workflowStatus}</div>
                {lastKnownLocation && (
                  <div className="mt-2 text-xs text-slate-400 font-mono">
                    Last known GPS: {lastKnownLocation.latitude.toFixed(4)}, {lastKnownLocation.longitude.toFixed(4)}
                  </div>
                )}
              </div>

              <Button className="w-full btn-premium bg-white/10 text-white hover:bg-white/20 border-white/20 font-bold">
                Access Local Dispatch
                <Phone className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        </div>

        {/* Guardian Management */}
        <div className="lg:col-span-7">
          <Card className="premium-card glass border-white/60 p-1 bg-white/20 h-full">
            <EmergencyContacts
              contacts={contacts}
              loading={loading}
              onContactsChange={loadEmergencyData}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
