import React, { useEffect, useMemo, useState, useRef } from "react";
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
  Locate,
  StopCircle,
  CheckCircle2,
  Radio,
  Navigation2
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
import { monitorRouteDeviation, calculateRouteProgress } from "../services/routeDeviationService";
import { analyzeRouteSafetyData } from "../services/routeSafetyAnalysis";
import { calculateSafetyScoreEngine } from "../services/safetyScoreEngine";
import { getTrustedPlaces } from "../services/trustedPlacesService";
import { geocodeAddress } from "../services/geocoding";
import { useLocationTracking } from "../hooks/useLocationTracking";

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
  const [reportAlert, setReportAlert] = useState("");
  const [searchError, setSearchError] = useState("");
  const [ambiguousCandidates, setAmbiguousCandidates] = useState([]);
  const routingRequestIdRef = useRef(0);

  // Active Real-Time Navigation & Geometry Preservation State
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeNavigationRoute, setActiveNavigationRoute] = useState(null);
  const [navigationStatus, setNavigationStatus] = useState("idle"); // idle | active | off_route | arrived | error
  const [currentProgress, setCurrentProgress] = useState({
    remainingDistanceMeters: 0,
    remainingDurationSeconds: 0,
    remainingDistanceLabel: "",
    remainingDurationLabel: "",
    isNearDestination: false
  });
  const [currentLocationDetails, setCurrentLocationDetails] = useState(null);
  const [navigationError, setNavigationError] = useState("");

  const { startActiveNavigationWatch, stopActiveNavigationWatch } = useLocationTracking();

  // Trusted Places State for Map Layer
  const [trustedPlaces, setTrustedPlaces] = useState([]);
  const [trustedPlacesLoading, setTrustedPlacesLoading] = useState(true);
  const [selectedTrustedPlace, setSelectedTrustedPlace] = useState(null);

  // Live Location & Camera Lock State
  const [userLiveCoords, setUserLiveCoords] = useState(null);
  const [flyToTarget, setFlyToTarget] = useState(null);
  const [recenterOnUser, setRecenterOnUser] = useState(true);
  const [isUserInteracting, setIsUserInteracting] = useState(false);

  // Persistent refs to avoid closure stale state in watchPosition callbacks
  const routesRef = useRef(routes);
  const selectedRouteRef = useRef(selectedRoute);
  const destinationRef = useRef(destination);
  const safetyDataRef = useRef(safetyData);
  const communityReportsRef = useRef(communityReports);
  const navigationStatusRef = useRef(navigationStatus);
  const isNavigatingRef = useRef(isNavigating);
  const activeNavigationRouteRef = useRef(activeNavigationRoute);
  const lastGpsLogRef = useRef(0);

  useEffect(() => { routesRef.current = routes; }, [routes]);
  useEffect(() => { selectedRouteRef.current = selectedRoute; }, [selectedRoute]);
  useEffect(() => { destinationRef.current = destination; }, [destination]);
  useEffect(() => { safetyDataRef.current = safetyData; }, [safetyData]);
  useEffect(() => { communityReportsRef.current = communityReports; }, [communityReports]);
  useEffect(() => { navigationStatusRef.current = navigationStatus; }, [navigationStatus]);
  useEffect(() => { isNavigatingRef.current = isNavigating; }, [isNavigating]);
  useEffect(() => { activeNavigationRouteRef.current = activeNavigationRoute; }, [activeNavigationRoute]);

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
        coords,
        precision: "exact",
        precisionLabel: "Exact address found"
      });
    }
  }, []);

  // Initial live location fetch & background watchPosition for Origin
  useEffect(() => {
    if (!navigator.geolocation) return;

    // Fetch immediate initial position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const coords = [latitude, longitude];
        setUserLiveCoords(coords);
        setCurrentLocationDetails({
          currentLatitude: latitude,
          currentLongitude: longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp || Date.now()
        });
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

    // Background watchPosition updates ONLY when not actively navigating to prevent mutating origin.coords during navigation
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const coords = [latitude, longitude];
        setUserLiveCoords(coords);
        setCurrentLocationDetails({
          currentLatitude: latitude,
          currentLongitude: longitude,
          accuracy,
          timestamp: position.timestamp || Date.now()
        });

        if (!isNavigatingRef.current) {
          setOrigin((prev) => {
            if (!prev.label || prev.label === "Live Location" || prev.label === "Current Location" || prev.label === "Auto-detected location") {
              return { label: "Live Location", coords };
            }
            return prev;
          });
        }
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
        setCurrentLocationDetails({
          currentLatitude: pos.coords.latitude,
          currentLongitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now()
        });
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

    const handleReportUpdated = async (event) => {
      console.log("[SAFE NAVIGATION] Real-time community report event received:", event?.detail);
      const updatedReports = await getCommunityReports();
      setCommunityReports(updatedReports);
      
      const statusLabel = event?.detail?.report?.status || "unverified";
      setReportAlert(`⚠️ Safe Route updated in real-time due to a nearby ${statusLabel.toLowerCase()} safety report.`);

      // Only recalculate automatically if NOT actively navigating
      if (!isNavigatingRef.current && origin.coords && destination.coords) {
        await calculateRouteWithCoords(origin.coords, destination.coords);
      }
    };

    window.addEventListener("community-report-updated", handleReportUpdated);
    return () => window.removeEventListener("community-report-updated", handleReportUpdated);
  }, [origin.coords, destination.coords]);

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

  const calculateRouteWithCoords = async (srcCoords, destCoords, srcLabel = "", destLabel = "") => {
    if (!srcCoords || !destCoords) return;
    
    const reqId = ++routingRequestIdRef.current;
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
        if (reqId !== routingRequestIdRef.current) return;
        setSafetyData(activeSafetyData);
        setCommunityReports(activeCommunityReports);
      }

      const safetyContext = {
        safetyData: activeSafetyData,
        communityReports: activeCommunityReports,
      };

      const fromObj = { label: srcLabel || origin.label || "Origin", coords: srcCoords };
      const toObj = { label: destLabel || destination.label || "Destination", coords: destCoords };

      const routeResults = await evaluateAllRoutes(fromObj, toObj, safetyContext);
      
      if (reqId !== routingRequestIdRef.current) {
        console.log("[ROUTING] Discarded stale route calculation for request ID:", reqId);
        return;
      }

      setRoutes(routeResults);

      const newChosen = selectedRoute === "fastest" 
        ? (routeResults.fastest ?? routeResults.safest) 
        : (routeResults.safest ?? routeResults.fastest);

      if (isNavigatingRef.current && newChosen) {
        setActiveNavigationRoute(newChosen);
        activeNavigationRouteRef.current = newChosen;
      }

      // Requirement 9 Debug Logging
      console.log("\n==================================");
      console.log("[ROUTE GENERATED]");
      console.log(`- mode: ${selectedRoute.toUpperCase()}`);
      console.log(`- origin:`, srcCoords);
      console.log(`- destination:`, destCoords);
      console.log(`- geometry points: ${routeResults.safest?.path?.length || routeResults.fastest?.path?.length || 0}`);
      console.log(`- distance: ${routeResults.safest?.distance || routeResults.fastest?.distance}`);
      console.log(`- duration: ${routeResults.safest?.duration || routeResults.fastest?.duration}`);
      console.log("==================================\n");

    } catch (error) {
      if (reqId === routingRequestIdRef.current) {
        console.error("Routing error:", error);
        setSearchError("Unable to generate routes for specified locations.");
      }
    } finally {
      if (reqId === routingRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleRouteCalculation = async () => {
    setSearchError("");
    setAmbiguousCandidates([]);

    let srcCoords = origin.coords;
    let srcLabel = origin.label;
    let destCoords = destination.coords;
    let destLabel = destination.label;

    setLoading(true);

    try {
      // 1. Resolve Origin if coords missing but label is present
      if (!srcCoords && srcLabel && srcLabel.trim().length >= 2) {
        const geoSrc = await geocodeAddress(srcLabel);
        if (geoSrc) {
          srcCoords = [geoSrc.latitude, geoSrc.longitude];
          srcLabel = geoSrc.address;
          setOrigin({ label: srcLabel, coords: srcCoords });
        } else {
          setSearchError("Origin location not found. Please check spelling or select Live Location.");
          setLoading(false);
          return;
        }
      }

      // 2. Resolve Destination if coords missing but label is present
      if (!destCoords && destLabel && destLabel.trim().length >= 2) {
        const geoDest = await geocodeAddress(destLabel);
        if (geoDest) {
          destCoords = [geoDest.latitude, geoDest.longitude];
          destLabel = geoDest.address;
          setDestination({ 
            label: destLabel, 
            coords: destCoords,
            precision: geoDest.precision,
            precisionLabel: geoDest.precisionLabel
          });

          if (geoDest.results && geoDest.results.length > 1) {
            setAmbiguousCandidates(geoDest.results);
          }
        } else {
          setSearchError(`Location not found for "${destLabel}". Please check spelling or enter coordinates (e.g. 13.0215, 80.1746).`);
          setLoading(false);
          return;
        }
      }

      if (!srcCoords || !destCoords) {
        setSearchError("Please specify both Origin and Destination locations.");
        setLoading(false);
        return;
      }

      await calculateRouteWithCoords(srcCoords, destCoords, srcLabel, destLabel);
    } catch (err) {
      console.error("Error resolving routing locations:", err);
      setSearchError("An error occurred while resolving location search.");
      setLoading(false);
    }
  };

  // Reroute using user's current GPS position when off-route (Requirement 5, 9, 10)
  const handleRerouteFromCurrentPosition = async (currentCoords, destCoords, currentRouteMode) => {
    if (!currentCoords || !destCoords) return;

    const reqId = ++routingRequestIdRef.current;

    try {
      const safetyContext = {
        safetyData: safetyDataRef.current || [],
        communityReports: communityReportsRef.current || []
      };

      const fromObj = { label: "Current GPS Position", coords: currentCoords };
      const toObj = { label: destinationRef.current?.label || "Destination", coords: destCoords };

      const routeResults = await evaluateAllRoutes(fromObj, toObj, safetyContext);

      if (reqId !== routingRequestIdRef.current) return;

      const newRouteCandidate = currentRouteMode === "fastest" 
        ? (routeResults.fastest ?? routeResults.safest) 
        : (routeResults.safest ?? routeResults.fastest);

      // ONLY replace active route geometry AFTER new route calculation succeeds
      if (newRouteCandidate?.path?.length > 0) {
        setRoutes(routeResults);
        setActiveNavigationRoute(newRouteCandidate);
        activeNavigationRouteRef.current = newRouteCandidate;
        setNavigationStatus("active");
        setDeviationAlert("✓ Route recalculated from your current position.");
        setTimeout(() => setDeviationAlert(""), 4000);
      }
    } catch (err) {
      if (reqId === routingRequestIdRef.current) {
        console.error("Rerouting failed:", err);
        setNavigationError("Rerouting attempt failed. Continuing on current route.");
      }
    }
  };

  // Start Navigation Tracking Lifecycle (Requirement 1, 2, 3, 4, 5, 9, 11, 13)
  const startNavigation = () => {
    if (!routes || (!routes.safest && !routes.fastest)) {
      alert("Please calculate a route first before pressing START.");
      return;
    }

    const chosenRoute = selectedRoute === "fastest" 
      ? (routes.fastest ?? routes.safest) 
      : (routes.safest ?? routes.fastest);

    if (!chosenRoute || !chosenRoute.path || chosenRoute.path.length === 0) {
      alert("Invalid route geometry. Please recalculate route.");
      return;
    }

    setNavigationError("");
    setSearchError("");
    setIsNavigating(true);
    isNavigatingRef.current = true;
    setNavigationStatus("active");
    setActiveNavigationRoute(chosenRoute);
    activeNavigationRouteRef.current = chosenRoute;

    // Requirement 9 Debug Logging
    console.log("\n==================================");
    console.log("[NAVIGATION START]");
    console.log(`- selected route exists: ${Boolean(chosenRoute)}`);
    console.log(`- selected route geometry exists: ${Boolean(chosenRoute?.path?.length)}`);
    console.log(`- geometry points: ${chosenRoute?.path?.length || 0}`);
    console.log(`- mode: ${selectedRoute.toUpperCase()}`);
    console.log("==================================\n");

    const startCoords = userLiveCoords || origin.coords;
    if (startCoords && chosenRoute) {
      const prog = calculateRouteProgress(startCoords, chosenRoute);
      setCurrentProgress(prog);
      setRecenterOnUser(true);
      setFlyToTarget({ coords: startCoords, key: Date.now() });
    }

    // Begin continuous high-accuracy watchPosition
    startActiveNavigationWatch(
      (locData) => {
        const coords = [locData.latitude, locData.longitude];
        setUserLiveCoords(coords);
        setCurrentLocationDetails({
          currentLatitude: locData.latitude,
          currentLongitude: locData.longitude,
          accuracy: locData.accuracy,
          timestamp: locData.timestamp
        });

        // Requirement 9 Throttled GPS Debug Logging (every ~2.5 seconds)
        const now = Date.now();
        if (now - lastGpsLogRef.current >= 2500) {
          lastGpsLogRef.current = now;
          console.log(`[GPS UPDATE] current position: [${locData.latitude.toFixed(5)}, ${locData.longitude.toFixed(5)}] | accuracy: ±${Math.round(locData.accuracy)}m`);
        }

        const activeRouteCandidate = activeNavigationRouteRef.current || (selectedRouteRef.current === "fastest" 
          ? (routesRef.current?.fastest ?? routesRef.current?.safest) 
          : (routesRef.current?.safest ?? routesRef.current?.fastest));

        if (!activeRouteCandidate) return;

        // Progress Calculation (Requirement 8)
        const prog = calculateRouteProgress(coords, activeRouteCandidate);
        setCurrentProgress(prog);

        // Destination Arrival Detection (Requirement 12)
        if (prog.isNearDestination) {
          setNavigationStatus("arrived");
          setIsNavigating(false);
          isNavigatingRef.current = false;
          stopActiveNavigationWatch();
          return;
        }

        // Off-Route Deviation Detection (Requirement 5 - 80m threshold)
        const deviation = monitorRouteDeviation(coords, activeRouteCandidate, 80);
        if (deviation?.warning) {
          setNavigationStatus("off_route");
          setDeviationAlert("⚠️ You are off route. Recalculating route from your current location...");

          if (destinationRef.current?.coords) {
            void handleRerouteFromCurrentPosition(coords, destinationRef.current.coords, selectedRouteRef.current);
          }
        } else if (navigationStatusRef.current === "off_route") {
          setNavigationStatus("active");
        }
      },
      (errMsg) => {
        console.warn("GPS navigation tracking error:", errMsg);
        setNavigationError(errMsg);
        setNavigationStatus("error");
      }
    );
  };

  const stopNavigation = () => {
    stopActiveNavigationWatch();
    setIsNavigating(false);
    isNavigatingRef.current = false;
    setActiveNavigationRoute(null);
    activeNavigationRouteRef.current = null;
    setNavigationStatus("idle");
    setDeviationAlert("");
    setNavigationError("");
  };

  // Auto-calculate route when destination is supplied via URL query parameters
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
      coords: placeCoords,
      precision: "exact",
      precisionLabel: "Exact address found"
    });

    // Fly map camera to trusted place
    setFlyToTarget({ coords: placeCoords, key: Date.now() });
  };

  const handleLocateMe = () => {
    handleShowLiveLocation();
  };

  const activeRoute = selectedRoute === "fastest" 
    ? (routes?.fastest ?? routes?.safest) 
    : (routes?.safest ?? routes?.fastest);

  // Preserve route polylines persistently so map zoom, pan, and GPS updates NEVER clear geometry
  const effectiveFastestPath = useMemo(() => {
    if (routes?.fastest?.path && routes.fastest.path.length > 0) {
      return routes.fastest.path;
    }
    if (activeNavigationRoute?.path && activeNavigationRoute.path.length > 0) {
      if (selectedRoute === "fastest" || activeNavigationRoute.routeId === routes?.fastest?.routeId) {
        return activeNavigationRoute.path;
      }
    }
    return activeNavigationRoute?.path || [];
  }, [routes, activeNavigationRoute, selectedRoute]);

  const effectiveSafestPath = useMemo(() => {
    if (routes?.safest?.path && routes.safest.path.length > 0) {
      return routes.safest.path;
    }
    if (activeNavigationRoute?.path && activeNavigationRoute.path.length > 0) {
      if (selectedRoute === "safest" || activeNavigationRoute.routeId === routes?.safest?.routeId) {
        return activeNavigationRoute.path;
      }
    }
    return activeNavigationRoute?.path || [];
  }, [routes, activeNavigationRoute, selectedRoute]);
  
  const routeAnalysis = useMemo(() => {
    const routeForAnalysis = activeNavigationRoute || activeRoute;
    if (!routeForAnalysis) return null;
    return routeForAnalysis.routeAnalysis || analyzeRouteSafetyData(routeForAnalysis, communityReports, safetyData);
  }, [activeNavigationRoute, activeRoute, communityReports, safetyData]);

  const safetyScoreResult = useMemo(() => {
    const routeForScore = activeNavigationRoute || activeRoute;
    if (!routeForScore) return null;
    return routeForScore.scoreResult || (routeAnalysis ? calculateSafetyScoreEngine(routeAnalysis) : null);
  }, [activeNavigationRoute, activeRoute, routeAnalysis]);

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
            Strategic Routing & Real-Time Tracking
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
                    onChange={(val) => {
                      setOrigin({ label: val, coords: null });
                    }}
                    onSelect={(sel) => {
                      setOrigin(sel);
                    }}
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
                    onChange={(val) => {
                      setSearchError("");
                      setAmbiguousCandidates([]);
                      setDestination({ label: val, coords: null });
                    }}
                    onSelect={(sel) => {
                      setSearchError("");
                      setAmbiguousCandidates([]);
                      setDestination(sel);
                    }}
                    placeholder="Enter landmark, address or coordinates (e.g. 12/5, Mount Poonamallee Road, Chennai)"
                  />
                </div>

                {destination.coords && (
                  <div className="flex items-center justify-between px-3 py-2 bg-white/80 border border-slate-200/80 rounded-xl text-xs shadow-2xs">
                    <span className="text-slate-500 font-semibold">Destination Precision:</span>
                    {destination.precision === "exact" ? (
                      <span className="font-extrabold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        🎯 Exact address found
                      </span>
                    ) : destination.precision === "street" ? (
                      <span className="font-extrabold text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        🛣️ Destination found at street level
                      </span>
                    ) : (
                      <span className="font-extrabold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        🏙️ Destination found at area level
                      </span>
                    )}
                  </div>
                )}
              </div>

              {ambiguousCandidates.length > 1 && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/90 p-3 space-y-2 text-left">
                  <div className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
                    Multiple candidate locations found. Select your destination:
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {ambiguousCandidates.slice(0, 4).map((cand, idx) => (
                      <button
                        key={cand.place_id || idx}
                        type="button"
                        onClick={() => {
                          const coords = [parseFloat(cand.lat), parseFloat(cand.lon)];
                          const label = cand.display_name;
                          setDestination({ 
                            label, 
                            coords,
                            precision: cand.precision || "street",
                            precisionLabel: cand.precisionLabel || "Destination found at street level"
                          });
                          setAmbiguousCandidates([]);
                          setSearchError("");
                          calculateRouteWithCoords(origin.coords, coords, origin.label, label);
                        }}
                        className="w-full text-left px-3 py-2 text-xs rounded-xl bg-white hover:bg-blue-100/60 border border-blue-100 text-slate-800 font-medium transition-colors flex items-start gap-2 cursor-pointer shadow-sm"
                      >
                        <span className="font-bold text-blue-600 shrink-0">#{idx + 1}</span>
                        <div className="flex-grow">
                          <span className="line-clamp-2">{cand.display_name}</span>
                          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
                            {cand.precisionLabel || "Street level"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-semibold flex items-center justify-between">
                  <span>{searchError}</span>
                  <button onClick={() => setSearchError("")} className="text-xs text-rose-500 hover:text-rose-800 font-bold ml-2">✕</button>
                </div>
              )}

              {navigationError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-semibold flex items-center justify-between">
                  <span>{navigationError}</span>
                  <button onClick={() => setNavigationError("")} className="text-xs text-rose-500 hover:text-rose-800 font-bold ml-2">✕</button>
                </div>
              )}

              <Button 
                onClick={handleRouteCalculation} 
                className="w-full btn-premium btn-primary py-4 text-lg mt-4 h-auto font-bold"
                disabled={loading || (!origin.coords && !origin.label) || (!destination.coords && !destination.label)}
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
                <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 font-semibold animate-pulse">
                  {deviationAlert}
                </div>
              )}

              {reportAlert && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 font-medium flex items-center justify-between">
                  <span>{reportAlert}</span>
                  <button 
                    onClick={() => setReportAlert("")} 
                    className="text-xs text-slate-500 hover:text-slate-800 ml-2 font-bold"
                  >
                    ✕
                  </button>
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
                  onRouteSelect={(mode) => {
                    setSelectedRoute(mode);
                    if (isNavigating && routes) {
                      const newSelected = mode === "fastest" ? (routes.fastest ?? routes.safest) : (routes.safest ?? routes.fastest);
                      if (newSelected) {
                        setActiveNavigationRoute(newSelected);
                        activeNavigationRouteRef.current = newSelected;
                      }
                    }
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Side: Map Feature */}
        <div className="lg:col-span-7">
          <Card className="premium-card overflow-hidden shadow-2xl border-0 h-full flex flex-col min-h-[600px]">
            {/* Real-time active navigation status bar */}
            {isNavigating && (
              <div className="bg-slate-950 text-white p-4 border-b border-emerald-500/40 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-widest text-emerald-400">
                      {navigationStatus === "off_route" ? "⚠️ OFF ROUTE - RECALCULATING" : "NAVIGATION ACTIVE"}
                    </div>
                    <div className="text-sm font-extrabold text-white flex items-center gap-3 mt-0.5">
                      <span>{currentProgress.remainingDistanceLabel || "Tracking position..."}</span>
                      {currentProgress.remainingDurationLabel && (
                        <>
                          <span className="text-slate-500">•</span>
                          <span className="text-emerald-300">{currentProgress.remainingDurationLabel}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {currentLocationDetails && (
                    <div className="hidden sm:block text-right text-[11px] text-slate-400 font-mono leading-tight">
                      <div>LAT: {currentLocationDetails.currentLatitude.toFixed(4)}, LON: {currentLocationDetails.currentLongitude.toFixed(4)}</div>
                      <div>ACCURACY: ±{Math.round(currentLocationDetails.accuracy)}m</div>
                    </div>
                  )}
                  <Button
                    type="button"
                    onClick={stopNavigation}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg border border-rose-400 flex items-center gap-1.5 cursor-pointer"
                  >
                    <StopCircle className="w-4 h-4" />
                    Stop Navigation
                  </Button>
                </div>
              </div>
            )}

            {navigationStatus === "arrived" && (
              <div className="p-4 bg-emerald-600 text-white font-black text-center text-base flex items-center justify-center gap-3 shadow-lg">
                <CheckCircle2 className="w-6 h-6 animate-bounce" />
                <span>🎉 Destination Reached! Navigation completed successfully.</span>
                <button 
                  onClick={() => setNavigationStatus("idle")} 
                  className="ml-4 text-xs underline font-semibold bg-emerald-800 px-3 py-1 rounded-lg"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="p-6 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                    <MapIcon className="w-4 h-4 text-white" />
                  </div>
                  <h3 className="text-xl font-bold tracking-tight">Intelligence Map</h3>
                </div>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest pl-11">
                  Blinking Blue: Live Marker | Red: Origin | Green: Destination
                </p>
              </div>
              
              <div className="flex gap-2">
                {!isNavigating ? (
                  <Button 
                    onClick={startNavigation} 
                    className="btn-premium bg-emerald-500 hover:bg-emerald-600 text-white border-0 shadow-lg shadow-emerald-500/20 font-bold px-6 py-3"
                    disabled={!routes}
                  >
                    START
                    <Navigation className="w-4 h-4 fill-white ml-2" />
                  </Button>
                ) : (
                  <Button 
                    onClick={stopNavigation} 
                    className="btn-premium bg-rose-600 hover:bg-rose-700 text-white border-0 shadow-lg shadow-rose-600/20 font-bold px-6 py-3"
                  >
                    STOP
                    <StopCircle className="w-4 h-4 fill-white ml-2" />
                  </Button>
                )}
              </div>
            </div>

            <CardContent className="p-0 flex-grow relative">
              <div className="absolute inset-0 grayscale-[0.2] contrast-[1.1]">
                <MapView
                  center={userLiveCoords || origin.coords || [12.9716, 77.5946]}
                  zoom={15}
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
                    fastestRoute={effectiveFastestPath}
                    safestRoute={effectiveSafestPath}
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
