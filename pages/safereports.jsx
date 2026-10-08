import React, { useState, useEffect } from "react";
import { SafetyReport } from "@/entities/all";
import { supabase } from "../src/lib/supabase.js";
import { normalizeCommunityReport } from "../services/supabaseService.js";
import { Button } from "@/components/ui/button.jsx";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.jsx";
import { 
  Shield, 
  MapPin, 
  Plus,
  TrendingUp,
  AlertTriangle,
  Users,
  Search,
  Zap,
  Sparkles,
  Map as MapIcon,
  List
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import ReportForm from "../components/safety/reportform.jsx";
import ReportsList from "../components/safety/reportlist.jsx";
import SafetyMap from "../components/safety/safetymap.jsx";

export default function SafetyReports() {
  const [reports, setReports] = useState([]);
  const [showReportForm, setShowReportForm] = useState(false);
  const [activeTab, setActiveTab] = useState("reports");
  const [filterType, setFilterType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadReports();

    // 1. Supabase Realtime postgres_changes subscription for community_reports
    const channel = supabase
      .channel("realtime-community-reports")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_reports",
        },
        (payload) => {
          console.log("📡 Realtime report payload received:", payload.eventType, payload.new);
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const raw = payload.new;
            if (!raw) return;
            const normalized = normalizeCommunityReport(raw);

            setReports((prev) => {
              const exists = prev.some((r) => String(r.id) === String(normalized.id));
              if (exists) {
                return prev.map((r) => (String(r.id) === String(normalized.id) ? { ...r, ...normalized } : r));
              } else {
                return [normalized, ...prev];
              }
            });
          } else if (payload.eventType === "DELETE") {
            if (payload.old?.id) {
              setReports((prev) => prev.filter((r) => String(r.id) !== String(payload.old.id)));
            }
          }
        }
      )
      .subscribe();

    // 2. Custom local window event listener for immediate fallback
    const handleLocalUpdate = (event) => {
      const { report: updatedReport } = event.detail || {};
      if (!updatedReport || !updatedReport.id) return;

      setReports((prev) => {
        const exists = prev.some((r) => String(r.id) === String(updatedReport.id));
        if (exists) {
          return prev.map((r) => (String(r.id) === String(updatedReport.id) ? { ...r, ...updatedReport } : r));
        } else {
          return [updatedReport, ...prev];
        }
      });
    };

    window.addEventListener("community-report-updated", handleLocalUpdate);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("community-report-updated", handleLocalUpdate);
    };
  }, []);

  const loadReports = async () => {
    try {
      const reportList = await SafetyReport.list('-created_date');
      setReports(reportList);
    } catch (error) {
      console.error("Error loading safety reports:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitReport = async () => {
    try {
      await loadReports();
      setTimeout(() => {
        setShowReportForm(false);
      }, 1200);
    } catch (error) {
      console.error("Error updating report list:", error);
    }
  };

  const handleDeleteReport = async (reportId) => {
    try {
      await SafetyReport.delete(reportId);
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (error) {
      console.error("Error deleting report:", error);
    }
  };

  const filteredReports = reports.filter(report => {
    const matchesFilter = filterType === "all" || report.report_type === filterType;
    const matchesSearch = (report.location && report.location.toLowerCase().includes(searchQuery.toLowerCase())) || 
                         (report.description && report.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const stats = [
    { label: "Total Intel", value: reports.length, icon: Shield, color: "indigo" },
    { label: "Weekly Velocity", value: reports.filter(r => new Date(r.created_date) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length, icon: TrendingUp, color: "blue" },
    { label: "Active Alerts", value: reports.filter(r => r.report_type === 'incident').length, icon: AlertTriangle, color: "rose" },
    { label: "Guarded Zones", value: reports.filter(r => r.report_type === 'safe_zone').length, icon: MapPin, color: "emerald" },
  ];

  return (
    <div className="space-y-12">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/50">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold uppercase tracking-[0.2em] text-xs mb-3">
            <Users className="w-4 h-4" />
            Community Intelligence
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
            Safety <span className="gradient-text">Reports</span>
          </h1>
        </div>
        
        <Button
          onClick={() => setShowReportForm(true)}
          className="btn-premium btn-primary px-8 h-auto py-4 shadow-2xl shadow-emerald-500/20 group"
        >
          <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500" />
          Log Security Incident
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="premium-card glass p-6 border-white/60">
               <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl bg-${stat.color}-50 flex items-center justify-center`}>
                    <stat.icon className={`w-5 h-5 text-${stat.color}-600`} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                    <p className="text-2xl font-black text-slate-900 leading-tight">{stat.value}</p>
                  </div>
               </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Tabs */}
      <div className="space-y-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
             <TabsList className="glass p-1.5 rounded-2xl border-white/60">
                <TabsTrigger value="reports" className="px-6 py-2.5 rounded-xl flex items-center gap-2 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">
                  <List className="w-4 h-4" />
                  Reports Feed
                </TabsTrigger>
                <TabsTrigger value="map" className="px-6 py-2.5 rounded-xl flex items-center gap-2 data-[state=active]:bg-slate-900 data-[state=active]:text-white transition-all">
                  <MapIcon className="w-4 h-4" />
                  Geospatial View
                </TabsTrigger>
             </TabsList>
             
             <div className="flex items-center gap-3">
                <div className="glass px-4 py-2 rounded-xl flex items-center gap-3 border-white/60 group focus-within:border-emerald-500/50 transition-colors">
                   <Search className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                   <input 
                     type="text" 
                     placeholder="Search intelligence logs..." 
                     className="bg-transparent border-0 outline-0 text-sm font-medium w-48 text-slate-900 placeholder:text-slate-400"
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                   />
                </div>
             </div>
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <TabsContent value="reports" className="mt-0 focus-visible:outline-none">
                <ReportsList 
                  reports={filteredReports}
                  loading={loading}
                  filterType={filterType}
                  onFilterChange={setFilterType}
                  onDeleteReport={handleDeleteReport}
                />
              </TabsContent>
              
              <TabsContent value="map" className="mt-0 focus-visible:outline-none">
                <div className="premium-card glass border-white/80 overflow-hidden min-h-[600px] shadow-2xl">
                   <SafetyMap reports={reports} />
                </div>
              </TabsContent>
            </motion.div>
          </AnimatePresence>
        </Tabs>
      </div>

      {/* Modal Form Overlay */}
      <AnimatePresence>
        {showReportForm && (
          <div className="fixed inset-0 z-[200] overflow-y-auto p-4 md:p-6 flex items-start sm:items-center justify-center">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReportForm(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl my-auto py-6 z-10"
            >
              <ReportForm 
                onSubmit={handleSubmitReport}
                onCancel={() => setShowReportForm(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

 