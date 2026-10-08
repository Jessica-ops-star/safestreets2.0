import React, { useState, useEffect } from "react";
import { Check, X, AlertCircle, ShieldCheck, MapPin, Clock, MessageSquare, AlertTriangle, Send } from "lucide-react";
import { Button } from "../ui/button.jsx";
import { corroborateReport, checkUserCorroborated, isUserEligibleToValidate } from "../../services/supabaseService.js";

export default function NearbyValidationCard({ report, currentUser, userLocation, onCorroborated }) {
  const [hasResponded, setHasResponded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showInfoInput, setShowInfoInput] = useState(false);
  const [additionalText, setAdditionalText] = useState("");
  const [currentReport, setCurrentReport] = useState(report);
  const [currentUserId, setCurrentUserId] = useState(() => {
    if (currentUser?.id) return currentUser.id;
    try {
      const u = localStorage.getItem("current_user");
      if (u) {
        const parsed = JSON.parse(u);
        return parsed.id || parsed.email || null;
      }
      return localStorage.getItem("safestreets_session_user_id") || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    setCurrentReport(report);
    if (report?.id) {
      checkUserCorroborated(report.id, currentUserId).then((responded) => {
        setHasResponded(responded);
      });
    }
  }, [report, currentUserId]);

  if (!currentReport) return null;

  const isReportCreator = Boolean(
    currentReport.user_id && currentUserId && String(currentReport.user_id) === String(currentUserId)
  );

  const status = String(currentReport.status || "PROVISIONAL").toUpperCase();
  const isEvidenceBacked = Boolean(currentReport.has_evidence || status === "VERIFIED");
  const isCorroborated = status === "CORROBORATED" || (currentReport.corroboration_count || 0) > 0;

  let bannerTitle = "Possible safety incident reported nearby";
  let statusBadgeLabel = "🟡 Unverified Signal";
  let statusBadgeClass = "bg-amber-100 text-amber-900 border-amber-300";

  if (isEvidenceBacked) {
    bannerTitle = "Safety incident supported by available evidence";
    statusBadgeLabel = "🟢 Evidence-Backed";
    statusBadgeClass = "bg-emerald-100 text-emerald-900 border-emerald-300";
  } else if (isCorroborated) {
    bannerTitle = "Multiple users reported a similar safety concern nearby";
    statusBadgeLabel = `🔵 Corroborated (${currentReport.corroboration_count || 1})`;
    statusBadgeClass = "bg-blue-100 text-blue-900 border-blue-300";
  }

  const handleResponse = async (responseType, textNote = "") => {
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      const res = await corroborateReport(currentReport.id, responseType, textNote);
      const updatedReportObj = res?.report || res;
      setHasResponded(true);
      setCurrentReport(updatedReportObj || currentReport);

      if (responseType === "SIMILAR") {
        setSuccessMsg("Positive corroboration recorded. Thank you for contributing to community safety!");
      } else if (responseType === "NOT_OBSERVED") {
        setSuccessMsg("Non-observation signal recorded. Thank you for your feedback.");
      } else if (responseType === "ADDITIONAL_INFO") {
        setSuccessMsg("Additional safety information recorded.");
        setShowInfoInput(false);
        setAdditionalText("");
      }

      if (onCorroborated) {
        onCorroborated(updatedReportObj || currentReport);
      }
    } catch (err) {
      console.warn("Corroboration error:", err);
      setErrorMsg(err.message || "Unable to record feedback.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white/95 backdrop-blur-xl border border-slate-200/90 rounded-2xl p-5 shadow-xl space-y-4 text-slate-900 transition-all hover:border-slate-300">
      {/* Banner Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isEvidenceBacked ? 'bg-emerald-500 text-white' : isCorroborated ? 'bg-blue-500 text-white' : 'bg-amber-500 text-white'}`}>
            {isEvidenceBacked ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          </div>
          <div>
            <h4 className="text-xs font-black tracking-tight text-slate-900 leading-snug">
              {bannerTitle}
            </h4>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Community Safety Signal
            </p>
          </div>
        </div>

        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border shrink-0 ${statusBadgeClass}`}>
          {statusBadgeLabel}
        </span>
      </div>

      {/* Incident Details Summary */}
      <div className="space-y-1.5 text-xs">
        <div className="font-bold text-slate-800 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">{currentReport.location || currentReport.category || "Reported Location"}</span>
        </div>
        {currentReport.description && (
          <p className="text-slate-600 font-medium italic bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed text-[11px]">
            "{currentReport.description}"
          </p>
        )}
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Interactive Options */}
      {isReportCreator ? (
        <div className="text-[11px] font-bold text-amber-800 bg-amber-50/80 p-2.5 rounded-xl border border-amber-200/80 flex items-center justify-center gap-1.5">
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Report Submitted — Awaiting nearby community validation (Creator self-validation disabled)</span>
        </div>
      ) : !hasResponded ? (
        <div className="space-y-2 pt-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Have you observed anything nearby?
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              type="button"
              disabled={loading}
              onClick={() => handleResponse("SIMILAR")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>I saw similar</span>
            </Button>

            <Button
              type="button"
              disabled={loading}
              onClick={() => handleResponse("NOT_OBSERVED")}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 border border-slate-200"
            >
              <X className="w-3.5 h-3.5 text-slate-500" />
              <span>Did not observe</span>
            </Button>

            <Button
              type="button"
              disabled={loading}
              onClick={() => setShowInfoInput(!showInfoInput)}
              className="bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Add info</span>
            </Button>
          </div>

          {/* Additional Info Text Dialog */}
          {showInfoInput && (
            <div className="pt-2 space-y-2 animate-in fade-in duration-200">
              <input
                type="text"
                value={additionalText}
                onChange={(e) => setAdditionalText(e.target.value)}
                placeholder="Type additional safety context (no personal names/accusations)..."
                className="w-full text-xs font-medium p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-amber-500"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowInfoInput(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={loading || !additionalText.trim()}
                  onClick={() => handleResponse("ADDITIONAL_INFO", additionalText)}
                  className="bg-slate-900 text-white text-xs font-bold"
                >
                  Submit Info
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[11px] font-bold text-slate-500 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-center gap-1.5">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Feedback recorded — Thank you for helping keep the community safe.</span>
        </div>
      )}
    </div>
  );
}
