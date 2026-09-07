import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { 
  Navigation, 
  Search, 
  Map as MapIcon, 
  Zap, 
  ShieldCheck, 
  AlertCircle,
  ArrowRight,
  Compass,
  Locate
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import RouteComparison from "../components/navigation/RouteComparison";
import NearbySafetyDisplay from "../components/navigation/NearbySafetyDisplay.jsx";
import SafetyScoreCard from "../components/navigation/SafetyScoreCard.jsx";
import MapView from "../components/map/MapView.jsx";
import RouteLayer from "../components/map/RouteLayer.jsx";
import SearchBox from "../components/map/SearchBox.jsx";

import { evaluateAllRoutes, getFastestRoute, getSafestRoute } from "../services/routing";
import { getCommunityReports, getSafetyData } from "../services/supabaseService";
import { monitorRouteDeviation } from "../services/routeDeviationService";
import { analyzeRouteSafetyData } from "../services/routeSafetyAnalysis";
import { calculateSafetyScoreEngine } from "../services/safetyScoreEngine";
import { getTrustedPlaces } from "../services/trustedPlacesService";

export default function SafeNavigation() {
  const [origin, setOrigin] = useState({ label: "", coords: null });
  const [destination, setDestination] = useState({ label: "", coords: null });
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState("safest");
  const [safetyData, setSafetyData] = useState([]);
  const [communityReports, setCommunityReports] = useState([]);
  const [safetyLoading, setSafetyLoading] = useState(true);
  const [safetyError, setSafetyError] = useState("");
  const [deviationAlert, setDeviationAlert] = useState("");

  // Trusted Places State for Map Layer
  const [trustedPlaces, setTrustedPlaces] = useState([]);
  const [trustedPlacesLoading, setTrustedPlacesLoading] = useState(true);
  const [selectedTrustedPlace, setSelectedTrustedPlace] = useState(null);

  // Live Location & Camera Lock State
  const [userLiveCoords, setUserLiveCoords] = useState(null);
  const [flyToTarget, setFlyToTarget] = useState(null);
  const [recenterOnUser, setRecenterOnUser] = useState(true);
  const [isUserInteracting, setIsUserInteracting] = useState(false);

  // 1. Load Trusted Places from Supabase
  const loadTrustedPlacesData = async () => {
    setTrustedPlacesLoading(true);
    try {
      const places = await getTrustedPlaces();
      setTrustedPlaces(places || []);
    } catch (err) {
      console.error("Error loading trusted places:", err);
    } finally {
      setTrustedPlacesLoading(false);
    }
  };

  useEffect(() => {
    loadTrustedPlacesData();

    // Check for destination query params (e.g. from Profile Trusted Places navigation)
    const params = new URLSearchParams(window.location.search);
    const lat = params.get('destLat');
    const lon = params.get('destLon');
    const label = params.get('destLabel');
    if (lat && lon) {
      const coords = [parseFloat(lat), parseFloat(lon)];
      setDestination({
        label: label ? decodeURIComponent(label) : "Trusted Place",
        coords
      });
    }
  }, []);

  // Initial live location fetch & continuous watchPosition for Origin
  useEffect(() => {
    if (!navigator.geolocation) return;

    // Fetch immediate initial position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const coords = [latitude, longitude];
        setUserLiveCoords(coords);
        setOrigin((prev) => ({
          label: prev.label || "Live Location",
          coords: prev.coords || coords,
        }));
      },
      (error) => {
        console.warn("Initial geolocation error:", error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    // Continuous watchPosition for live origin updates in the background
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const coords = [latitude, longitude];
        setUserLiveCoords(coords);
        setOrigin((prev) => {
          if (!prev.label || prev.label === "Live Location" || prev.label === "Current Location" || prev.label === "Auto-detected location") {
            return { label: "Live Location", coords };
          }
          return prev;
        });
      },
      (error) => {
        console.warn("Live geolocation watch warning:", error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const useLiveLocationAsOrigin = () => {
    if (userLiveCoords) {
      setOrigin({ label: "Live Location", coords: userLiveCoords });
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        setUserLiveCoords(coords);
        setOrigin({ label: "Live Location", coords });
      });
    }
  };

  const handleShowLiveLocation = () => {
    const coords = userLiveCoords || origin.coords;
    if (coords) {
      setIsUserInteracting(false);
      setRecenterOnUser(true);
      setFlyToTarget({ coords, key: Date.now() });
    }
  };

  useEffect(() => {
    void loadSafetyContext();
  }, []);

  useEffect(() => {
    if (!origin.coords || !destination.coords || !routes?.safest) return;

    const watchId = navigator.geolocation?.watchPosition(
      (position) => {
        const alert = monitorRouteDeviation([position.coords.latitude, position.coords.longitude], routes?.safest ?? routes?.fastest);
        if (alert?.warning) {
          setDeviationAlert(alert.message);
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );

    return () => navigator.geolocation?.clearWatch(watchId);
  }, [origin.coords, destination.coords, routes]);

  const loadSafetyContext = async () => {
    setSafetyLoading(true);
    setSafetyError("");

    try {
      const [records, reports] = await Promise.all([getSafetyData(), getCommunityReports()]);
      setSafetyData(records);
      setCommunityReports(reports);
    } catch (error) {
      console.error("Failed to load safety context:", error);
      setSafetyError("Unable to load safety data from the live analysis feed.");
    } finally {
      setSafetyLoading(false);
    }
  };

  const calculateRouteWithCoords = async (srcCoords, destCoords) => {
    if (!srcCoords || !destCoords) return;
    setLoading(true);
    setRecenterOnUser(false);
    setIsUserInteracting(false);

    try {
      let activeSafetyData = safetyData;
      let activeCommunityReports = communityReports;

      if (!activeSafetyData || activeSafetyData.length === 0) {
        console.log("[ROUTING] Safety data state empty, fetching live reports from Supabase...");
        [activeSafetyData, activeCommunityReports] = await Promise.all([
          getSafetyData(),
          getCommunityReports()
        ]);
        setSafetyData(activeSafetyData);
        setCommunityReports(activeCommunityReports);
      }

      const safetyContext = {
        safetyData: activeSafetyData,
        communityReports: activeCommunityReports,
      };

      const routeResults = await evaluateAllRoutes(origin, destination, safetyContext);
      setRoutes(routeResults);
      setSelectedRoute("safest");
    } catch (error) {
      console.error("Routing error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRouteCalculation = async () => {
    if (!origin.coords || !destination.coords) return;
    await calculateRouteWithCoords(origin.coords, destination.coords);
  };

  // Auto-calculate route when destination is supplied via URL query parameters (e.g. from Emergency page)
  useEffect(() => {
    if (origin.coords && destination.coords && !routes) {
      void calculateRouteWithCoords(origin.coords, destination.coords);
    }
  }, [origin.coords, destination.coords]);

  // Trusted Places Handlers
  const handleSelectTrustedPlace = (place) => {
    setSelectedTrustedPlace(place);
    const placeCoords = [Number(place.latitude), Number(place.longitude)];
    
    // Set destination inputs
    setDestination({
      label: `${place.place_name} (${place.formatted_address})`,
      coords: placeCoords
    });

    // Fly map camera to trusted place
    setFlyToTarget({ coords: placeCoords, key: Date.now() });
  };

  const handleStartNavigationToTrustedPlace = async (place) => {
    const placeCoords = [Number(place.latitude), Number(place.longitude)];
    const srcCoords = origin.coords || userLiveCoords;

    if (!srcCoords) {
      alert("Please enable or select an Origin location to start navigation.");
      return;
    }

    setDestination({
      label: `${place.place_name} (${place.formatted_address})`,
      coords: placeCoords
    });

    await calculateRouteWithCoords(srcCoords, placeCoords);
  };

  const handleLocateMe = () => {
    handleShowLiveLocation();
  };

  const handleFastestRoute = () => {
    const proceed = window.confirm(
      "⚠️ PREDICTIVE WARNING\n\nThis route traverses areas with significantly higher incident rates.\n\nOur recommendation: Use the Safest Route.\n\nProceed anyway?"
    );
    if (proceed) setSelectedRoute("fastest");
  };

  const startNavigation = () => {
    const routeName = selectedRoute === "safest" ? "Safest" : "Fastest";
    alert(`Initiating ${routeName} Protocol. Navigation active.`);
  };

  const activeRoute = selectedRoute === "fastest" 
    ? (routes?.fastest ?? routes?.safest) 
    : (routes?.safest ?? routes?.fastest);
  
  const routeAnalysis = useMemo(() => {
    if (!activeRoute) return null;
    return activeRoute.routeAnalysis || analyzeRouteSafetyData(activeRoute, communityReports, safetyData);
  }, [activeRoute, communityReports, safetyData]);

  const safetyScoreResult = useMemo(() => {
    if (!activeRoute) return null;
    return activeRoute.scoreResult || (routeAnalysis ? calculateSafetyScoreEngine(routeAnalysis) : null);
  }, [activeRoute, routeAnalysis]);

  const emptyStateLabel = useMemo(() => {
    if (safetyLoading) return "Loading live safety data...";
    if (safetyError) return safetyError;
    if (safetyData.length === 0) return "No safety history is available yet for this route.";
    return "";
  }, [safetyData.length, safetyError, safetyLoading]);

  return (
    <div className="space-y-10">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-slate-200/50">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold uppercase tracking-[0.2em] text-xs mb-3">
            <Compass className="w-4 h-4" />
            Strategic Routing & Safety Anchors
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
            Safe <span className="gradient-text">Navigation</span>
          </h1>
        </div>
        
        {/* Real-time positioning button */}
        <button
          type="button"
          onClick={handleShowLiveLocation}
          className="flex items-center gap-2.5 glass hover:bg-slate-900 hover:text-white px-5 py-2.5 rounded-2xl text-slate-800 font-semibold border-white/60 transition-all cursor-pointer shadow-sm hover:scale-[1.02] active:scale-[0.98]"
          title="Click to view live location on map"
        >
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-600"></span>
          </span>
          <span className="text-sm">Real-time positioning</span>
        </button>
      </div>

      {/* Main Layout Grid */}
      <div className="grid lg:grid-cols-12 gap-10">
        {/* Left Side: Controls & Insights & Trusted Places */}
        <div className="lg:col-span-5 space-y-8">
          {/* Destination Setup Card */}
          <Card className="premium-card glass border-white/60 shadow-2xl p-8 bg-white/40">
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center">
                  <Search className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Destination Setup</h3>
              </div>
              
              <div className="space-y-4">
                <div className="relative group">
                   <SearchBox
                    label="Current Origin"
                    value={origin.label}
                    onChange={(val) => setOrigin({ label: val, coords: origin.coords })}
                    onSelect={(sel) => setOrigin(sel)}
                    onSelectLive={useLiveLocationAsOrigin}
                    headerRight={
                      <button
                        type="button"
                        onClick={useLiveLocationAsOrigin}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors border border-blue-200"
                      >
                        <Locate className="w-3.5 h-3.5" />
                        Use Live Location
                      </button>
                    }
                    placeholder="Type address or select Live Location"
                  />
                </div>
                
                <div className="flex justify-center -my-2 relative z-10">
                   <div className="w-8 h-8 rounded-full glass border-emerald-100 flex items-center justify-center text-emerald-600">
                      <ArrowRight className="w-4 h-4 transform rotate-90" />
                   </div>
                </div>

                <div className="relative group">
                  <SearchBox
                    label="Final Destination"
                    value={destination.label}
                    onChange={(val) => setDestination({ label: val, coords: destination.coords })}
                    onSelect={(sel) => setDestination(sel)}
                    placeholder="Where are you heading?"
                  />
                </div>
              </div>

              <Button 
                onClick={handleRouteCalculation} 
                className="w-full btn-premium btn-primary py-4 text-lg mt-4 h-auto font-bold"
                disabled={loading || !origin.coords || !destination.coords}
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Synthesizing Routes...
                  </>
                ) : (
                  <>
                    Calculate Guarded Path
                    <Zap className="w-5 h-5 fill-white" />
                  </>
                )}
              </Button>

              {emptyStateLabel && (
                <div className="rounded-2xl border border-slate-200/60 bg-white/70 px-4 py-3 text-sm text-slate-600">
                  {emptyStateLabel}
                </div>
              )}

              {deviationAlert && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {deviationAlert}
                </div>
              )}
            </div>
          </Card>

          {/* Route Comparison Display */}
          <AnimatePresence>
            {routes && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-8"
              >
                <RouteComparison 
                  routes={routes}
                  selectedRoute={selectedRoute}
                  onRouteSelect={setSelectedRoute}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Side: Map Feature */}
        <div className="lg:col-span-7">
          <Card className="premium-card overflow-hidden shadow-2xl border-0 h-full flex flex-col min-h-[600px]">
            <div className="p-8 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                    <MapIcon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-xl font-bold tracking-tight">Intelligence Map</h3>
                </div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest pl-11">
                  Green Pins: Trusted Places | Red Pin: Origin
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={startNavigation} 
                  className="btn-premium bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-lg shadow-emerald-500/20 font-bold"
                  disabled={!routes}
                >
                  Start Mission
                  <Navigation className="w-4 h-4 fill-white ml-2" />
                </Button>
              </div>
            </div>

            <CardContent className="p-0 flex-grow relative">
              <div className="absolute inset-0 grayscale-[0.2] contrast-[1.1]">
                <MapView
                  center={origin.coords || userLiveCoords || [12.9716, 77.5946]}
                  zoom={14}
                  from={origin.coords}
                  to={destination.coords}
                  userLocation={userLiveCoords}
                  flyToTarget={flyToTarget}
                  safetyData={safetyData}
                  communityReports={communityReports}
                  trustedPlaces={trustedPlaces}
                  onSelectTrustedPlace={handleSelectTrustedPlace}
                  recenterOnUser={recenterOnUser && !isUserInteracting}
                  onUserInteract={() => {
                    setIsUserInteracting(true);
                    setRecenterOnUser(false);
                  }}
                >
                  <RouteLayer
                    fastestRoute={routes?.fastest?.path}
                    safestRoute={routes?.safest?.path}
                    selectedRoute={selectedRoute}
                    isIdentical={routes?.isIdentical}
                    dangerZones={routes?.dangerZones}
                  />
                </MapView>
              </div>
              
              {/* Floating Controls Overlay */}
              <div className="absolute bottom-6 right-6 flex flex-col gap-3">
                 <button 
                  onClick={handleLocateMe}
                  title="Recenter on live position"
                  className="w-12 h-12 glass-dark rounded-xl flex items-center justify-center text-white hover:scale-110 transition-transform shadow-2xl cursor-pointer"
                 >
                    <Locate className="w-5 h-5 text-emerald-400" />
                 </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Safety Score Assessment Display */}
      {safetyScoreResult && (
        <SafetyScoreCard scoreResult={safetyScoreResult} />
      )}

      {/* Nearby Safety Intelligence Display Below the Map */}
      {routeAnalysis && (
        <NearbySafetyDisplay analysisResult={routeAnalysis} />
      )}

    </div>
  );
}
