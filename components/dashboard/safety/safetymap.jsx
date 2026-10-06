import React, { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card.jsx";
import { Badge } from "../../../components/ui/badge.jsx";
import { 
  MapPin, 
  Navigation,
  AlertTriangle,
  Shield,
  Star,
  Clock,
  FileText,
  Calendar
} from "lucide-react";
import { motion } from "framer-motion";
import { ReportLocationDisplay } from "../../../services/geocoding.js";

// Fix default marker assets for Leaflet in bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

/**
 * Determine report marker color strictly based on star rating:
 * 1–2 stars → Red
 * 3 stars → Yellow
 * 4–5 stars → Green
 */
export function getReportSafetyStatus(report) {
  const rawRating = report.safety_rating ?? report.rating;
  const rating = Number(rawRating);

  if (!isNaN(rating) && rating <= 2) {
    return { color: '#ef4444', label: '1–2 Stars (Risky)', badgeClass: 'bg-rose-500 text-white', type: 'red' };
  }
  if (!isNaN(rating) && rating >= 4) {
    return { color: '#22c55e', label: '4–5 Stars (Safe)', badgeClass: 'bg-emerald-500 text-white', type: 'green' };
  }
  return { color: '#eab308', label: '3 Stars (Caution)', badgeClass: 'bg-amber-500 text-white', type: 'yellow' };
}

// Leaflet DivIcons for Red, Yellow, Green report markers with animated blinking dot + pulsing outer glow
const markerIcons = {
  red: L.divIcon({
    className: "custom-report-marker-red",
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
        <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background-color: #ef4444; opacity: 0.45; animation: reportDotPulse 1.8s infinite ease-out;"></div>
        <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background-color: #ef4444; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(239,68,68,0.9); animation: reportDotBlink 1.4s infinite ease-in-out;"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  }),
  yellow: L.divIcon({
    className: "custom-report-marker-yellow",
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
        <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background-color: #eab308; opacity: 0.45; animation: reportDotPulse 1.8s infinite ease-out;"></div>
        <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background-color: #eab308; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(234,179,8,0.9); animation: reportDotBlink 1.4s infinite ease-in-out;"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  }),
  green: L.divIcon({
    className: "custom-report-marker-green",
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
        <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background-color: #22c55e; opacity: 0.45; animation: reportDotPulse 1.8s infinite ease-out;"></div>
        <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background-color: #22c55e; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(34,197,94,0.9); animation: reportDotBlink 1.4s infinite ease-in-out;"></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  })
};

function MapController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, map.getZoom() || 12, { duration: 0.8 });
    }
  }, [center, map]);
  return null;
}

export default function SafetyMap({ reports = [] }) {
  // Filter valid reports containing real coordinates
  const validReports = useMemo(() => {
    if (!Array.isArray(reports)) return [];
    return reports.filter(r => 
      r && 
      r.latitude !== null && 
      r.latitude !== undefined && 
      !isNaN(Number(r.latitude)) && 
      r.longitude !== null && 
      r.longitude !== undefined && 
      !isNaN(Number(r.longitude)) &&
      Number(r.latitude) !== 0 &&
      Number(r.longitude) !== 0
    );
  }, [reports]);

  // Calculate dynamic center coordinate
  const mapCenter = useMemo(() => {
    if (validReports.length > 0) {
      // Use latest report's coordinates as focal point
      const latest = validReports[0];
      return [Number(latest.latitude), Number(latest.longitude)];
    }
    // Default fallback center (Chennai)
    return [13.0827, 80.2707];
  }, [validReports]);

  // Count reports by safety status
  const safeCount = validReports.filter(r => getReportSafetyStatus(r).type === 'green').length;
  const neutralCount = validReports.filter(r => getReportSafetyStatus(r).type === 'yellow').length;
  const riskCount = validReports.filter(r => getReportSafetyStatus(r).type === 'red').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Real Geospatial Leaflet Map */}
      <Card className="shadow-2xl border-0 rounded-3xl overflow-hidden glass">
        <CardHeader className="bg-slate-900 text-white p-5 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-lg font-black tracking-tight">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/30">
              <Navigation className="w-5 h-5 text-white" />
            </div>
            Geospatial Safety View
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-3 py-1 font-bold text-xs">
              Live Reports: {validReports.length}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="relative h-[480px] w-full bg-slate-100 overflow-hidden">
            <MapContainer 
              center={mapCenter} 
              zoom={12} 
              scrollWheelZoom={true}
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer 
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <MapController center={mapCenter} />

              {/* Render real report markers */}
              {validReports.map((report, idx) => {
                const status = getReportSafetyStatus(report);
                const icon = markerIcons[status.type];
                const lat = Number(report.latitude);
                const lon = Number(report.longitude);
                const categoryName = report.category || report.report_type || "Safety Incident";
                const rating = Number(report.safety_rating || 3);
                const formattedDate = report.created_date ? new Date(report.created_date).toLocaleString() : "Recently logged";

                return (
                  <Marker 
                    key={report.id || `report-${idx}-${lat}-${lon}`}
                    position={[lat, lon]}
                    icon={icon}
                  >
                    <Popup className="custom-report-popup">
                      <div className="p-1 space-y-2.5 max-w-xs">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${status.badgeClass}`}>
                            {status.label}
                          </span>
                          <div className="flex items-center gap-1 text-amber-500 font-bold text-xs bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                            <span>{rating}/5</span>
                          </div>
                        </div>

                        <div>
                          <h4 className="font-black text-slate-900 text-sm leading-snug">
                            {categoryName}
                          </h4>
                          <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">
                              <ReportLocationDisplay item={report} fallbackText="Location Recorded" />
                            </span>
                          </p>
                        </div>

                        {/* Validation Status Badge in Popup */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {(() => {
                            const valStatus = (report.status || (report.verified ? 'VERIFIED' : 'PROVISIONAL')).toUpperCase();
                            if (valStatus === 'VERIFIED' || report.has_evidence || report.verified) {
                              return (
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-emerald-500 text-white">
                                  ✓ Verified (Evidence)
                                </span>
                              );
                            }
                            if (valStatus === 'CORROBORATED') {
                              return (
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-blue-600 text-white">
                                  ✓ Corroborated ({report.corroboration_count || 1})
                                </span>
                              );
                            }
                            if (valStatus === 'EXPIRED') {
                              return (
                                <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-400 text-white">
                                  Stale / Expired
                                </span>
                              );
                            }
                            return (
                              <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-amber-500 text-white">
                                ⚠ Provisional (Unverified)
                              </span>
                            );
                          })()}

                          {report.corroboration_count > 0 && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              +{report.corroboration_count} user confirmed
                            </span>
                          )}
                        </div>

                        {report.description && (
                          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-medium text-slate-700 leading-relaxed flex items-start gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span className="line-clamp-3">{report.description}</span>
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 pt-1 border-t border-slate-100">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {report.time_cycle || "Day"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            {formattedDate}
                          </span>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            {/* Map Legend Floating Banner */}
            <div className="absolute bottom-4 left-4 z-[400] bg-white/95 backdrop-blur-md p-3.5 rounded-2xl shadow-xl border border-slate-200/80 space-y-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Report Safety Legend</h4>
              <div className="flex flex-col gap-1.5 text-xs font-bold text-slate-700">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm"></div>
                  <span>Safe / Positive (4-5★)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-amber-500 shadow-sm"></div>
                  <span>Neutral / Caution (3★)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500 shadow-sm"></div>
                  <span>Risky / Unsafe (1-2★)</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Real Map Statistics Grid */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="glass border-emerald-100 bg-emerald-50/30">
          <CardContent className="p-4 text-center">
            <Shield className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
            <div className="text-2xl font-black text-slate-900">
              {safeCount}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Safe Zones</div>
          </CardContent>
        </Card>
        <Card className="glass border-amber-100 bg-amber-50/30">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-1" />
            <div className="text-2xl font-black text-slate-900">
              {neutralCount}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Neutral Areas</div>
          </CardContent>
        </Card>
        <Card className="glass border-rose-100 bg-rose-50/30">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-1" />
            <div className="text-2xl font-black text-slate-900">
              {riskCount}
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Risk Areas</div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
