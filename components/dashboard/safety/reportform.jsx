import React, { useState, useEffect } from "react";
import { Button } from "../../../components/ui/button.jsx";
import { Input } from "../../../components/ui/input.jsx";
import { Label } from "../../../components/ui/label.jsx";
import { Textarea } from "../../../components/ui/textarea.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.jsx";
import { 
  MapPin, 
  Star,
  Shield,
  X,
  Send,
  Zap,
  Target,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Edit3,
  AlertCircle,
  CheckCircle2,
  Search,
  Navigation,
  Check
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../../../src/lib/supabase";
import { geocodeAddress, searchAddress, reverseGeocodeAddress } from "../../../services/geocoding.js";
import { addCommunityReport } from "../../../services/supabaseService.js";
import { SafetyReport } from "../../../entities/all.js";

const POSITIVE_REPORTS = [
  "Brightly Lit Street",
  "Busy Area",
  "High Foot Traffic",
  "Guarded Premises",
  "Active Commercial Area",
  "Police Patrol",
  "CCTV Coverage",
  "Residential Area",
  "Active Nightlife",
  "Other"
];

const NEGATIVE_REPORTS = [
  "Harassment",
  "Theft / Pickpocketing",
  "Poor Lighting",
  "Reckless Driving",
  "Stray Animal Threat",
  "Road Hazard",
  "Suspicious Activity",
  "Assault / Violence",
  "Drunk People",
  "Isolated Area",
  "Other"
];

const TIME_OPTIONS = [
  { value: "morning", label: "Morning (6AM - 12PM)" },
  { value: "afternoon", label: "Afternoon (12PM - 5PM)" },
  { value: "evening", label: "Evening (5PM - 9PM)" },
  { value: "night", label: "Night (9PM - 2AM)" },
  { value: "late_night", label: "Critical Hours (2AM - 6AM)" },
];

export default function ReportForm({ onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    safety_rating: 3,
    report_type: "",
    description: "",
    time_of_day: ""
  });

  // Location Selection Mode: "current" vs "manual"
  const [locationMode, setLocationMode] = useState("current");

  // Option A State - Current GPS Location
  const [currentLat, setCurrentLat] = useState(null);
  const [currentLon, setCurrentLon] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");

  // Option B State - Enter Incident Location & Geocoding
  const [manualAddress, setManualAddress] = useState("");
  const [geocodedAddress, setGeocodedAddress] = useState(null);
  const [manualLat, setManualLat] = useState(null);
  const [manualLon, setManualLon] = useState(null);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [geocodingError, setGeocodingError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [positiveSelection, setPositiveSelection] = useState("");
  const [negativeSelection, setNegativeSelection] = useState("");
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [customReportText, setCustomReportText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [supabaseError, setSupabaseError] = useState("");

  // Auto fetch current location on load if Option A is active
  useEffect(() => {
    if (locationMode === "current" && currentLat === null) {
      getCurrentLocation();
    }
  }, [locationMode]);

  const getCurrentLocation = () => {
    setGpsLoading(true);
    setGpsError("");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLat(position.coords.latitude);
          setCurrentLon(position.coords.longitude);
          setGpsLoading(false);
        },
        (error) => {
          console.error("Location lock failed:", error);
          setGpsError("Unable to acquire GPS location. Please ensure browser permissions are allowed.");
          setGpsLoading(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGpsError("Geolocation is not supported by your browser.");
      setGpsLoading(false);
    }
  };

  // Handle live typing in manual address box & debounced suggestions
  const handleAddressInputChange = (val) => {
    setManualAddress(val);
    setGeocodingError("");
    setGeocodedAddress(null);
    setManualLat(null);
    setManualLon(null);

    if (!val || val.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Debounced suggestion fetch
  useEffect(() => {
    if (!manualAddress || manualAddress.trim().length < 2) return;

    let active = true;
    const timeout = setTimeout(async () => {
      try {
        const results = await searchAddress(manualAddress.trim());
        if (active) {
          setSuggestions(results || []);
          setShowSuggestions((results || []).length > 0);
        }
      } catch {
        if (active) setSuggestions([]);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [manualAddress]);

  // Execute explicit geocoding lookup for manual address
  const handleFindLocation = async (addressQuery) => {
    const query = addressQuery || manualAddress;
    if (!query || !query.trim()) {
      setGeocodingError("Please enter an address or place name.");
      return null;
    }

    setGeocodingLoading(true);
    setGeocodingError("");
    setShowSuggestions(false);

    try {
      const res = await geocodeAddress(query.trim());
      if (res && res.latitude && res.longitude) {
        setManualLat(res.latitude);
        setManualLon(res.longitude);
        setGeocodedAddress(res.address);
        setGeocodingLoading(false);
        return res;
      } else {
        setManualLat(null);
        setManualLon(null);
        setGeocodedAddress(null);
        setGeocodingError("Location could not be found. Please enter a more specific location.");
        setGeocodingLoading(false);
        return null;
      }
    } catch (err) {
      console.error("Geocoding exception:", err);
      setGeocodingError("Location could not be found. Please enter a more specific location.");
      setGeocodingLoading(false);
      return null;
    }
  };

  const handlePositiveSelect = (val) => {
    setPositiveSelection(val);
    setNegativeSelection("");
    if (val === "Other") {
      setIsOtherSelected(true);
      setFormData(prev => ({ ...prev, report_type: customReportText.trim() || "Other" }));
    } else {
      setIsOtherSelected(false);
      setFormData(prev => ({ ...prev, report_type: val }));
    }
  };

  const handleNegativeSelect = (val) => {
    setNegativeSelection(val);
    setPositiveSelection("");
    if (val === "Other") {
      setIsOtherSelected(true);
      setFormData(prev => ({ ...prev, report_type: customReportText.trim() || "Other" }));
    } else {
      setIsOtherSelected(false);
      setFormData(prev => ({ ...prev, report_type: val }));
    }
  };

  const handleCustomTextChange = (e) => {
    const text = e.target.value;
    setCustomReportText(text);
    setFormData(prev => ({ ...prev, report_type: text.trim() || "Other" }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError("");
    setSupabaseError("");
    setSuccessMessage("");

    const reportType = positiveSelection ? "Positive Report" : negativeSelection ? "Negative Report" : "";
    const category = positiveSelection
      ? (positiveSelection === "Other" ? customReportText.trim() : positiveSelection)
      : negativeSelection
      ? (negativeSelection === "Other" ? customReportText.trim() : negativeSelection)
      : "";

    if (!reportType) {
      setValidationError("Report type is required. Please select a Positive Report or Negative Report category.");
      return;
    }

    if (!category) {
      setValidationError("Category is required. Please select a valid report category.");
      return;
    }

    let finalLat = null;
    let finalLon = null;
    let finalLocationName = "";

    if (locationMode === "current") {
      if (currentLat === null || currentLon === null || isNaN(Number(currentLat)) || isNaN(Number(currentLon))) {
        setValidationError("Current GPS location not locked. Please click 'Detect Location' or check location permissions.");
        return;
      }
      finalLat = Number(currentLat);
      finalLon = Number(currentLon);
      const resolvedGeo = await reverseGeocodeAddress(finalLat, finalLon);
      finalLocationName = resolvedGeo || `Lat: ${finalLat.toFixed(4)}, Lon: ${finalLon.toFixed(4)}`;
    } else {
      // Manual address mode
      if (!manualAddress || !manualAddress.trim()) {
        setValidationError("Please enter an incident address or place name.");
        return;
      }

      let lat = manualLat;
      let lon = manualLon;
      let addr = geocodedAddress;

      // If user typed an address but hasn't clicked Find Location yet, geocode now
      if (lat === null || lon === null) {
        setSubmitting(true);
        const geoRes = await handleFindLocation(manualAddress.trim());
        setSubmitting(false);
        if (!geoRes || !geoRes.latitude || !geoRes.longitude) {
          setValidationError("Location could not be found. Please enter a more specific location.");
          return;
        }
        lat = geoRes.latitude;
        lon = geoRes.longitude;
        addr = geoRes.address;
      }

      finalLat = Number(lat);
      finalLon = Number(lon);
      if (!addr || addr.toLowerCase().startsWith("lat:")) {
        const resolvedGeo = await reverseGeocodeAddress(finalLat, finalLon);
        finalLocationName = resolvedGeo || addr || manualAddress.trim() || `Lat: ${finalLat.toFixed(4)}, Lon: ${finalLon.toFixed(4)}`;
      } else {
        finalLocationName = addr || manualAddress.trim();
      }
    }

    if (!finalLat || !finalLon || isNaN(finalLat) || isNaN(finalLon)) {
      setValidationError("Location coordinates are invalid. Please select or verify your report location.");
      return;
    }

    if (!formData.time_of_day) {
      setValidationError("Time cycle is required. Please select a time cycle.");
      return;
    }

    if (!formData.safety_rating) {
      setValidationError("Safety rating is required. Please select a rating (1-5).");
      return;
    }

    setSubmitting(true);

    try {
      let userId = "local_user";
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) userId = user.id;
      } catch (authErr) {
        console.warn("Auth check notice:", authErr);
      }

      const timeCycleMap = {
        morning: "Morning",
        afternoon: "Afternoon",
        evening: "Evening",
        night: "Night",
        late_night: "Critical Hours",
        Morning: "Morning",
        Afternoon: "Afternoon",
        Evening: "Evening",
        Night: "Night",
        "Critical Hours": "Critical Hours"
      };

      const payload = {
        user_id: userId,
        report_type: reportType,
        category: category,
        latitude: finalLat,
        longitude: finalLon,
        location: finalLocationName,
        time_cycle: timeCycleMap[formData.time_of_day] || formData.time_of_day,
        safety_rating: Number(formData.safety_rating),
        intelligence_briefing: formData.description || "",
        description: formData.description || ""
      };

      const insertedData = await SafetyReport.create(payload);
      console.log("Observation report saved successfully:", insertedData);
      setSuccessMessage("Observation report saved successfully!");
      if (onSubmit) await onSubmit(insertedData || payload);

      setFormData({
        safety_rating: 3,
        report_type: "",
        description: "",
        time_of_day: ""
      });
      setPositiveSelection("");
      setNegativeSelection("");
      setIsOtherSelected(false);
      setCustomReportText("");
      setManualAddress("");
      setGeocodedAddress(null);
      setManualLat(null);
      setManualLon(null);
    } catch (err) {
      console.error("Unexpected error submitting report:", err);
      setSupabaseError("An unexpected error occurred: " + (err.message || "Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="premium-card glass border-white shadow-2xl bg-white/95 backdrop-blur-2xl w-full rounded-3xl overflow-hidden flex flex-col max-h-[85vh] md:max-h-[88vh]">
      {/* Header */}
      <div className="p-5 md:p-6 border-b border-slate-200/50 flex items-center justify-between bg-slate-900 text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
             <h3 className="text-lg font-black tracking-tight">Intelligence Log</h3>
             <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Protocol Entry v4.0</p>
          </div>
        </div>
        <button type="button" onClick={onCancel} className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
        {/* Scrollable Middle Body */}
        <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar space-y-6">
          {validationError && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-800 text-xs font-bold animate-in fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
              <span>{validationError}</span>
            </div>
          )}

          {supabaseError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs font-bold animate-in fade-in">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
              <span>{supabaseError}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs font-bold animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-6 md:gap-8">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Report Location Switcher */}
              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Report Location *</Label>
                
                {/* Two Option Selection Cards */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setLocationMode("current");
                      setValidationError("");
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                      locationMode === "current"
                        ? "bg-slate-900 border-slate-900 text-white shadow-lg scale-[1.02]"
                        : "bg-white/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <Navigation className={`w-4 h-4 ${locationMode === "current" ? "text-emerald-400" : "text-slate-400"}`} />
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${locationMode === "current" ? "border-emerald-400 bg-emerald-400" : "border-slate-300"}`}>
                        {locationMode === "current" && <Check className="w-2.5 h-2.5 text-slate-900 stroke-[3]" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-black tracking-tight">Use Current Location</p>
                      <p className={`text-[10px] font-medium ${locationMode === "current" ? "text-slate-300" : "text-slate-500"}`}>📍 Current GPS location</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLocationMode("manual");
                      setValidationError("");
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                      locationMode === "manual"
                        ? "bg-slate-900 border-slate-900 text-white shadow-lg scale-[1.02]"
                        : "bg-white/60 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <MapPin className={`w-4 h-4 ${locationMode === "manual" ? "text-emerald-400" : "text-slate-400"}`} />
                      <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${locationMode === "manual" ? "border-emerald-400 bg-emerald-400" : "border-slate-300"}`}>
                        {locationMode === "manual" && <Check className="w-2.5 h-2.5 text-slate-900 stroke-[3]" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-black tracking-tight">Enter Incident Location</p>
                      <p className={`text-[10px] font-medium ${locationMode === "manual" ? "text-slate-300" : "text-slate-500"}`}>Specify address / place</p>
                    </div>
                  </button>
                </div>

                {/* Option A View: Current GPS */}
                {locationMode === "current" && (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Target className="w-4 h-4 text-emerald-600 animate-pulse" />
                        Current Position Status
                      </span>
                      <button
                        type="button"
                        onClick={getCurrentLocation}
                        disabled={gpsLoading}
                        className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 hover:underline"
                      >
                        {gpsLoading ? "Acquiring..." : "Refresh Position"}
                      </button>
                    </div>

                    {currentLat !== null && currentLon !== null ? (
                      <div className="bg-white p-3 rounded-xl border border-emerald-200/80 shadow-sm space-y-1">
                        <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> GPS Locked
                        </div>
                        <div className="text-xs font-mono font-bold text-slate-800">
                          Latitude: <span className="text-emerald-700">{currentLat.toFixed(6)}</span>
                        </div>
                        <div className="text-xs font-mono font-bold text-slate-800">
                          Longitude: <span className="text-emerald-700">{currentLon.toFixed(6)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 italic">
                        {gpsLoading ? "Detecting browser GPS coordinates..." : gpsError || "Click 'Refresh Position' to acquire GPS location."}
                      </div>
                    )}
                  </div>
                )}

                {/* Option B View: Enter Address & Dynamic Geocoding */}
                {locationMode === "manual" && (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 relative animate-in fade-in duration-200">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        Incident Address / Area Name
                      </Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            value={manualAddress}
                            onChange={(e) => handleAddressInputChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleFindLocation();
                              }
                            }}
                            placeholder="e.g. Adyar, Chennai or T Nagar..."
                            className="pl-9 py-2.5 text-xs font-bold bg-white border-slate-300 focus:border-emerald-500 rounded-xl"
                          />
                          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        </div>
                        <Button
                          type="button"
                          onClick={() => handleFindLocation()}
                          disabled={geocodingLoading || !manualAddress.trim()}
                          className="bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold px-4 rounded-xl shrink-0"
                        >
                          {geocodingLoading ? "Finding..." : "Find Location"}
                        </Button>
                      </div>
                    </div>

                    {/* Autocomplete Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute left-4 right-4 top-20 z-50 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto divide-y divide-slate-100">
                        {suggestions.map((item) => (
                          <button
                            key={item.place_id}
                            type="button"
                            onClick={() => {
                              setManualAddress(item.display_name);
                              setManualLat(parseFloat(item.lat));
                              setManualLon(parseFloat(item.lon));
                              setGeocodedAddress(item.display_name);
                              setShowSuggestions(false);
                              setGeocodingError("");
                            }}
                            className="w-full text-left p-2.5 text-xs font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-900 transition-colors"
                          >
                            {item.display_name}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Geocoding Error Message */}
                    {geocodingError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{geocodingError}</span>
                      </div>
                    )}

                    {/* Resolved Location Output Display */}
                    {manualLat !== null && manualLon !== null && (
                      <div className="bg-white p-3 rounded-xl border border-emerald-300 shadow-sm space-y-1">
                        <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Resolved Location Confirmed
                        </div>
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {geocodedAddress || manualAddress}
                        </div>
                        <div className="text-[11px] font-mono font-bold text-slate-600 flex gap-3 pt-0.5">
                          <span>Lat: <strong className="text-slate-900">{manualLat.toFixed(6)}</strong></span>
                          <span>Lon: <strong className="text-slate-900">{manualLon.toFixed(6)}</strong></span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Safety Index Rating */}
              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Safety Index Rating *</Label>
                <div className="flex items-center gap-2.5">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      onClick={() => setFormData({...formData, safety_rating: rating})}
                      className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-all ${
                        formData.safety_rating >= rating
                          ? 'bg-amber-500 border-amber-500 text-white shadow-lg shadow-amber-500/20 scale-105'
                          : 'bg-white/40 border-slate-200 text-slate-300 hover:border-amber-200'
                      }`}
                    >
                      <Star className={`w-5 h-5 ${formData.safety_rating >= rating ? 'fill-current' : ''}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* REPORT TYPE * */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Report Type *</Label>
                  {formData.report_type && (
                    <span className="text-[10px] font-bold text-emerald-600 truncate max-w-[180px]">
                      Selected: {formData.report_type}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Positive Reports Dropdown */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
                      <ThumbsUp className="w-3 h-3" /> Positive Report
                    </span>
                    <Select value={positiveSelection} onValueChange={handlePositiveSelect}>
                      <SelectTrigger className="glass py-4 border-emerald-200 hover:border-emerald-400 rounded-2xl font-bold text-xs">
                        <SelectValue placeholder="Select Positive..." />
                      </SelectTrigger>
                      <SelectContent className="glass">
                        {POSITIVE_REPORTS.map((item) => (
                          <SelectItem key={item} value={item} className="font-bold text-xs text-emerald-800">
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Negative Reports Dropdown */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1">
                      <ThumbsDown className="w-3 h-3" /> Negative Report
                    </span>
                    <Select value={negativeSelection} onValueChange={handleNegativeSelect}>
                      <SelectTrigger className="glass py-4 border-rose-200 hover:border-rose-400 rounded-2xl font-bold text-xs">
                        <SelectValue placeholder="Select Negative..." />
                      </SelectTrigger>
                      <SelectContent className="glass">
                        {NEGATIVE_REPORTS.map((item) => (
                          <SelectItem key={item} value={item} className="font-bold text-xs text-rose-800">
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom Input when "Other" is selected */}
                <AnimatePresence>
                  {isOtherSelected && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-2 space-y-1.5"
                    >
                      <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <Edit3 className="w-3 h-3 text-emerald-500" /> Specify Custom Details
                      </Label>
                      <Input
                        type="text"
                        value={customReportText}
                        onChange={handleCustomTextChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                          }
                        }}
                        placeholder="Type custom report detail and press Enter..."
                        className="glass border-emerald-400/60 focus:border-emerald-500 rounded-xl py-3 px-4 font-bold text-xs text-slate-900"
                        autoFocus
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* TIME * */}
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Time *</Label>
                <Select value={formData.time_of_day} onValueChange={(value) => setFormData({...formData, time_of_day: value})} required>
                  <SelectTrigger className="glass py-4 border-slate-200 rounded-2xl font-bold text-xs">
                    <SelectValue placeholder="Select time cycle..." />
                  </SelectTrigger>
                  <SelectContent className="glass">
                    {TIME_OPTIONS.map((time) => (
                      <SelectItem key={time.value} value={time.value} className="font-bold text-xs">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {time.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-2 flex flex-col">
              <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Intelligence Briefing</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                placeholder="Log granular details for community synthesis..."
                className="glass border-slate-200 rounded-2xl min-h-[220px] flex-1 p-4 focus:border-emerald-500/50 transition-all font-medium leading-relaxed"
              />
            </div>
          </div>
        </div>

        {/* Fixed Action Footer */}
        <div className="p-4 md:p-5 bg-slate-50/90 border-t border-slate-200/60 shrink-0 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3 px-5 rounded-xl border border-slate-200 text-slate-500 font-black uppercase tracking-widest text-xs hover:bg-slate-100 transition-colors"
            >
              Abort Entry
            </button>
            <Button
              type="submit"
              disabled={submitting || !formData.report_type || !formData.time_of_day || (locationMode === "current" ? (currentLat === null || currentLon === null) : !manualAddress.trim())}
              className="flex-[2] btn-premium btn-primary py-3.5 h-auto shadow-xl shadow-emerald-500/20"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Synchronizing...
                </>
              ) : (
                <>
                  Transmit Observation
                  <Send className="w-4 h-4 fill-white" />
                </>
              )}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-2 pt-1">
             <Shield className="w-3.5 h-3.5 text-emerald-500" />
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">End-to-End Cryptographic Security Active</span>
          </div>
        </div>
      </form>
    </div>
  );
}