import React, { useState, useEffect } from "react";
import { 
  ShieldCheck, 
  MapPin, 
  Navigation, 
  Phone, 
  ExternalLink, 
  Building, 
  HeartPulse, 
  Loader2, 
  AlertTriangle,
  Home,
  GraduationCap,
  Building2,
  Briefcase,
  Users,
  Heart
} from "lucide-react";
import { findNearestPoliceStation, findNearestHospital } from "../../services/nearbySafetyService.js";
import { Button } from "../ui/button.jsx";
import { Card, CardContent } from "../ui/card.jsx";

const CATEGORY_ICONS = {
  Home: Home,
  College: GraduationCap,
  School: Building2,
  Work: Briefcase,
  "Friend's House": Users,
  "Relative's House": Heart,
  Other: MapPin,
};

export default function TrustedPlaceDetailsCard({
  trustedPlace: trustedPlaceProp,
  place: placeProp,
  onStartNavigation,
  onNavigate,
  onClose,
  onEdit,
  onDelete
}) {
  const trustedPlace = trustedPlaceProp || placeProp;
  const handleNavigation = onStartNavigation || onNavigate;

  const [policeStation, setPoliceStation] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [loadingSafety, setLoadingSafety] = useState(true);

  useEffect(() => {
    let isMounted = true;
    if (!trustedPlace?.latitude || !trustedPlace?.longitude) return;

    async function loadNearbyAssistance() {
      setLoadingSafety(true);
      try {
        const [police, hosp] = await Promise.all([
          findNearestPoliceStation(trustedPlace.latitude, trustedPlace.longitude),
          findNearestHospital(trustedPlace.latitude, trustedPlace.longitude)
        ]);

        if (isMounted) {
          setPoliceStation(police);
          setHospital(hosp);
        }
      } catch (err) {
        console.error("Error loading nearby safety assistance:", err);
      } finally {
        if (isMounted) setLoadingSafety(false);
      }
    }

    loadNearbyAssistance();

    return () => {
      isMounted = false;
    };
  }, [trustedPlace]);

  if (!trustedPlace) return null;

  const CatIcon = CATEGORY_ICONS[trustedPlace.category] || MapPin;

  return (
    <Card className="premium-card glass border-white/60 shadow-2xl p-6 bg-white/70 space-y-6 animate-in fade-in duration-300">
      {/* Selected Place Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-200/60">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-md">
            <CatIcon className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">{trustedPlace.place_name}</h3>
              <span className="text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-lg border border-slate-200">
                {trustedPlace.category}
              </span>
            </div>
            <p className="text-xs text-slate-600 font-semibold mt-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>{trustedPlace.formatted_address}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
          {onEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(trustedPlace)}
              className="rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100 font-bold text-xs px-3 py-2"
            >
              Edit
            </Button>
          )}
          {onDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(trustedPlace.id)}
              className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs px-3 py-2"
            >
              Delete
            </Button>
          )}
          {handleNavigation && (
            <Button
              onClick={() => handleNavigation(trustedPlace)}
              className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-5 py-2.5 h-auto text-sm shadow-lg shadow-emerald-600/20 flex items-center gap-2"
            >
              <span>Start Navigation</span>
              <Navigation className="w-4 h-4 fill-white" />
            </Button>
          )}
        </div>
      </div>

      {/* Nearby Safety Assistance */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Nearby Safety Assistance
          </h4>
          <span className="text-[11px] text-slate-500 font-medium italic">
            Dynamically identified from location feed
          </span>
        </div>

        {loadingSafety ? (
          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 text-center space-y-2">
            <Loader2 className="w-6 h-6 text-emerald-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-600 font-bold uppercase tracking-wider">
              Finding nearby safety assistance...
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Nearest Police Station Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/80 to-slate-50 border border-blue-200/80 space-y-3 relative overflow-hidden">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <Building className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold text-blue-700 uppercase tracking-wider">
                      Nearest Police Station
                    </div>
                    <div className="text-xs font-black text-slate-900 leading-tight">
                      Nearest Police Station Identified
                    </div>
                  </div>
                </div>
              </div>

              {policeStation ? (
                <div className="space-y-2 text-xs">
                  <div className="font-bold text-slate-900 line-clamp-1">{policeStation.name}</div>
                  <div className="text-slate-600 text-[11px] line-clamp-1">{policeStation.address}</div>
                  <div className="inline-block font-extrabold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md text-[11px]">
                    📍 {policeStation.formattedDistance}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-blue-100">
                    <a
                      href={policeStation.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-blue-700 hover:text-blue-900 flex items-center gap-1 bg-white hover:bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View on Map
                    </a>
                    {policeStation.phone && (
                      <a
                        href={`tel:${policeStation.phone}`}
                        className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 bg-white hover:bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors"
                      >
                        <Phone className="w-3 h-3" />
                        Call Station
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-medium py-2">
                  No nearby police station found for this place.
                </div>
              )}
            </div>

            {/* Nearest Hospital Card */}
            <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-50/80 to-slate-50 border border-rose-200/80 space-y-3 relative overflow-hidden">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
                    <HeartPulse className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-extrabold text-rose-700 uppercase tracking-wider">
                      Nearest Hospital
                    </div>
                    <div className="text-xs font-black text-slate-900 leading-tight">
                      Medical Support Facility
                    </div>
                  </div>
                </div>
              </div>

              {hospital ? (
                <div className="space-y-2 text-xs">
                  <div className="font-bold text-slate-900 line-clamp-1">{hospital.name}</div>
                  <div className="text-slate-600 text-[11px] line-clamp-1">{hospital.address}</div>
                  <div className="inline-block font-extrabold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md text-[11px]">
                    📍 {hospital.formattedDistance}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-rose-100">
                    <a
                      href={hospital.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-rose-700 hover:text-rose-900 flex items-center gap-1 bg-white hover:bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-200 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      View on Map
                    </a>
                    {hospital.phone && (
                      <a
                        href={`tel:${hospital.phone}`}
                        className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 flex items-center gap-1 bg-white hover:bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 transition-colors"
                      >
                        <Phone className="w-3 h-3" />
                        Call Hospital
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 font-medium py-2">
                  No nearby hospital information available.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
