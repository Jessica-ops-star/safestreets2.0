import React, { useState, useEffect } from "react";
import { SOSAlert, SafetyReport, EmergencyContact } from "@/entities/all";
import { supabase } from "../src/lib/supabase.js";
import { useLocationTracking } from "../hooks/useLocationTracking";
import { Button } from "@/components/ui/button.jsx";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Shield,
  AlertTriangle,
  Navigation,
  Users,
  MapPin,
  Clock,
  CheckCircle,
  ArrowRight,
  TrendingUp,
  Activity,
  Zap,
  Sparkles,
  Radio,
  Compass,
  AlertCircle,
  LocateFixed,
  Loader2,
  X,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import QuickActions from "../components/dashboard/QuickActions.jsx";
import SafetyMetrics from "../components/dashboard/safemetrics.jsx";
import RecentActivity from "../components/dashboard/RecentActivity.jsx";

export default function Dashboard() {
  const {
    location,
    address,
    permissionStatus,
    loading: locationLoading,
    error: locationError,
    lastSavedAt,
    requestLocationPermission,
    startTracking,
    stopTracking
  } = useLocationTracking();

  const [nearbySosNotification, setNearbySosNotification] = useState(null);

  const [stats, setStats] = useState({
    totalAlerts: 0,
    activeAlerts: 0,
    safetyReports: 0,
    emergencyContacts: 0
  });
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      const [alerts, reports, contacts] = await Promise.all([
        SOSAlert.list('-created_date', 5).catch(() => []),
        SafetyReport.list('-created_date', 5).catch(() => []),
        EmergencyContact.list().catch(() => [])
      ]);

      const activeAlerts = (alerts || []).filter(alert => alert.status === 'active').length;

      setStats({
        totalAlerts: (alerts || []).length,
        activeAlerts,
        safetyReports: (reports || []).length,
        emergencyContacts: contacts ? contacts.length : 0
      });

      setRecentAlerts(alerts || []);
      setRecentReports(reports || []);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      EmergencyContact.clearCache();
      loadDashboardData();
    });

    // Prompt for location permission and start automatic background location tracking (every 5 minutes)
    void requestLocationPermission();
    startTracking(300000);

    return () => {
      stopTracking();
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let notificationChannel = null;

    const setupNotificationListener = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) return;

        notificationChannel = supabase
          .channel(`user-notifications-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${user.id}`
            },
            (payload) => {
              console.log("🚨 Realtime notification received:", payload.new);
              setNearbySosNotification(payload.new);
            }
          )
          .subscribe();
      } catch (err) {
        console.error("Error setting up notification realtime listener:", err);
      }
    };

    setupNotificationListener();

    return () => {
      if (notificationChannel) {
        supabase.removeChannel(notificationChannel);
      }
    };
  }, []);

  return (
    <div className="space-y-12 relative">
      {/* Realtime Nearby SOS Emergency Alert Notification Banner */}
      <AnimatePresence>
        {nearbySosNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="fixed top-6 right-6 z-50 max-w-md w-full bg-slate-900/95 border-2 border-red-500/80 text-white rounded-2xl p-5 shadow-2xl backdrop-blur-xl ring-4 ring-red-500/20"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/50 flex items-center justify-center text-red-500 shrink-0 animate-pulse">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-red-400 flex items-center gap-1.5 leading-tight">
                    🚨 SOS ALERT NEAR YOU
                  </h4>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Emergency Broadcast • Within 2 km
                  </span>
                </div>
              </div>
              <button
                onClick={() => setNearbySosNotification(null)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-200 mb-4 leading-relaxed bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 font-medium">
              {nearbySosNotification.message || "A Safe Streets user near you has triggered an emergency alert."}
            </p>

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNearbySosNotification(null)}
                className="border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-xs rounded-xl"
              >
                Dismiss
              </Button>
              {nearbySosNotification.latitude && nearbySosNotification.longitude && (
                <Button
                  size="sm"
                  asChild
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs rounded-xl shadow-lg shadow-red-600/30 gap-1.5"
                >
                  <a
                    href={`https://www.google.com/maps?q=${nearbySosNotification.latitude},${nearbySosNotification.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    View Location
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Dynamic Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-4 border-b border-slate-200/50">
        <div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 text-emerald-600 font-bold uppercase tracking-[0.2em] text-xs mb-3"
          >
            <Sparkles className="w-4 h-4 fill-emerald-500" />
            Security Intelligence
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight"
          >
            Safety <span className="gradient-text">Control Center</span>
          </motion.h1>
        </div>
      </div>

      {/* Live User Location Tracking Widget */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <Card className="border-0 shadow-lg bg-gradient-to-r from-emerald-900/90 via-slate-900 to-teal-950 text-white rounded-3xl overflow-hidden relative">
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 blur-[100px] rounded-full -mr-32 -mt-32 pointer-events-none"></div>
          <CardContent className="p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-emerald-500/20 border border-emerald-400/30 rounded-2xl flex items-center justify-center shrink-0 shadow-lg">
                <MapPin className="w-7 h-7 text-emerald-400 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-1">
                    <Radio className="w-3 h-3 text-emerald-400 animate-spin" />
                    Live Geolocation Tracking
                  </span>
                  {permissionStatus === "granted" ? (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                      GPS Active (High Accuracy)
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                      Location Connected
                    </Badge>
                  )}
                </div>

                <h3 className="text-xl font-bold text-white tracking-tight">
                  {address ? (
                    `${address.street || address.area ? `${address.street || address.area}, ` : ""}${address.city || address.state || "Current Position"}`
                  ) : location ? (
                    `GPS: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
                  ) : (
                    "Acquiring GPS Position..."
                  )}
                </h3>

                <p className="text-xs text-slate-300 max-w-xl">
                  {address?.displayName ? address.displayName : "Your coordinates are continuously synced every 5 minutes and protected via Supabase Auth."}
                </p>

                {locationError && (
                  <p className="text-xs text-amber-300 font-medium flex items-center gap-1 mt-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {locationError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end shrink-0 gap-2 text-right border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6 w-full md:w-auto">
              <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Last Synced</div>
              <div className="text-xs font-semibold text-emerald-300">
                {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : "Syncing..."}
              </div>

              <div className="flex items-center gap-2 mt-1">
                {locationLoading ? (
                  <Button
                    size="sm"
                    disabled
                    className="bg-amber-500/80 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Syncing Location...
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={requestLocationPermission}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    Refresh Location
                  </Button>
                )}

                <Link to="/safenavigation">
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-md">
                    <Compass className="w-3.5 h-3.5" />
                    View Map Navigation
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Primary Dashboard Modules */}
      <div className="grid grid-cols-1 gap-10">
        <section>
          <QuickActions />
        </section>

        <section>
          <SafetyMetrics stats={stats} loading={loading} />
        </section>

        <div className="grid lg:grid-cols-2 gap-10">
          <RecentActivity
            title="Emergency Alerts"
            items={recentAlerts}
            type="alerts"
            loading={loading}
          />
          <RecentActivity
            title="Intelligence Reports"
            items={recentReports}
            type="reports"
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
