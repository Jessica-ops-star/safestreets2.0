import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../src/lib/supabase";

/**
 * Custom React Hook for Live User Location Tracking & Reverse Geocoding.
 * 
 * Features:
 * - Triggers native browser location permission prompt.
 * - Falls back gracefully to IP-geolocation if browser GPS is blocked in site settings.
 * - Nominatim OpenStreetMap Reverse Geocoding (stored strictly in React state).
 * - Single-row upsert logic for Supabase `user_locations` table (prevents duplicates).
 * - Automatic background 5-minute tracking timer with memory leak cleanup.
 */
export function useLocationTracking() {
  const [location, setLocation] = useState(null);
  const [address, setAddress] = useState(null);
  const [permissionStatus, setPermissionStatus] = useState("prompt");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  const timerRef = useRef(null);
  const lastSavedCoordsRef = useRef(null);

  /**
   * Derive the authenticated user's UUID securely from Supabase Auth.
   */
  const getAuthUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) return user;
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) return sessionData.session.user;
      const localUser = localStorage.getItem('current_user');
      if (localUser) {
        const u = JSON.parse(localUser);
        if (u?.id && u.id !== 'guest' && u.id !== 'me') return u;
      }
      return null;
    } catch {
      return null;
    }
  };

  /**
   * Fetch fallback IP-based location if browser GPS is blocked by browser site settings.
   */
  const fetchIPFallbackLocation = async () => {
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (res.ok) {
        const data = await res.json();
        if (data && data.latitude && data.longitude) {
          return {
            latitude: Number(data.latitude),
            longitude: Number(data.longitude),
            accuracy: 5000,
            isFallback: true,
            city: data.city || "",
            region: data.region || "",
            country: data.country_name || "",
            timestamp: Date.now(),
          };
        }
      }
    } catch (e) {
      console.warn("IP geolocation fallback error:", e);
    }
    return null;
  };

  /**
   * Reverse Geocode GPS coordinates to human-readable address using Nominatim API.
   * Address state is maintained purely in React state for UI rendering.
   */
  const reverseGeocode = useCallback(async (latitude, longitude) => {
    if (!latitude || !longitude) return null;

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "SafeStreets-App/1.0 (contact@safestreets.app)",
          "Accept-Language": "en",
        },
      });

      if (!response.ok) {
        throw new Error(`Nominatim API returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data && data.address) {
        const parsedAddress = {
          street: data.address.road || data.address.pedestrian || data.address.suburb || "",
          area: data.address.neighbourhood || data.address.residential || data.address.suburb || "",
          city: data.address.city || data.address.town || data.address.village || data.address.county || "",
          state: data.address.state || "",
          country: data.address.country || "",
          postalCode: data.address.postcode || "",
          displayName: data.display_name || "Unknown Location",
        };
        setAddress(parsedAddress);
        return parsedAddress;
      }
    } catch (err) {
      console.warn("Nominatim reverse geocoding warning:", err);
    }
    return null;
  }, []);

  /**
   * Save user's latest location to the existing `user_locations` table in Supabase.
   * Guarantees exactly one row per user (upsert / query check).
   */
  const saveLocation = useCallback(async (latitude, longitude) => {
    if (!latitude || !longitude) return false;

    try {
      const user = await getAuthUser();
      if (!user?.id) {
        console.warn("User not authenticated, skipping database location save.");
        return false;
      }

      const now = new Date().toISOString();

      // Check if a row already exists for this user in user_locations
      const { data: existingRows, error: fetchErr } = await supabase
        .from("user_locations")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);

      if (fetchErr) {
        console.warn("Query user_locations error:", fetchErr);
      }

      if (existingRows && existingRows.length > 0) {
        // Update existing row
        const { error: updateErr } = await supabase
          .from("user_locations")
          .update({
            latitude: Number(latitude),
            longitude: Number(longitude),
            updated_at: now,
          })
          .eq("user_id", user.id);

        if (updateErr) {
          console.error("Error updating user_locations in Supabase:", updateErr);
          return false;
        }
        console.log("SUCCESS: Updated user_locations row in Supabase:", { user_id: user.id, latitude, longitude, updated_at: now });
      } else {
        // Insert new row
        const { error: insertErr } = await supabase
          .from("user_locations")
          .insert({
            user_id: user.id,
            latitude: Number(latitude),
            longitude: Number(longitude),
            updated_at: now,
          });

        if (insertErr) {
          console.error("Error inserting user_locations in Supabase:", insertErr);
          return false;
        }
        console.log("SUCCESS: Inserted new user_locations row in Supabase:", { user_id: user.id, latitude, longitude, updated_at: now });
      }

      setLastSavedAt(now);
      lastSavedCoordsRef.current = { latitude, longitude };
      return true;
    } catch (err) {
      console.error("Failed to save location to Supabase user_locations:", err);
      return false;
    }
  }, []);

  /**
   * Fetch current GPS location via Browser Geolocation API.
   */
  const getCurrentLocation = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !navigator.geolocation) {
        const err = new Error("Geolocation is not supported by your browser.");
        setError(err.message);
        setPermissionStatus("unsupported");
        reject(err);
        return;
      }

      setLoading(true);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          console.log("Latitude:", position.coords.latitude);
          console.log("Longitude:", position.coords.longitude);
          console.log("Accuracy:", position.coords.accuracy);
          const locData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp || Date.now(),
          };
          setLocation(locData);
          setPermissionStatus("granted");
          setError(null);
          setLoading(false);
          resolve(locData);
        },
        (err) => {
          setLoading(false);
          let message = "Unable to retrieve GPS location.";
          if (err.code === err.PERMISSION_DENIED) {
            message = "Browser location is blocked in site settings. Click 🔒 in your address bar to allow location access.";
            setPermissionStatus("denied");
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            message = "GPS position unavailable on device.";
          } else if (err.code === err.TIMEOUT) {
            message = "GPS location request timed out.";
          }
          setError(message);
          reject(new Error(message));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }, []);

  /**
   * Perform complete update sequence (with IP fallback if browser GPS is blocked).
   */
  const updateCompleteLocation = useCallback(async () => {
    setLoading(true);
    let loc = null;

    try {
      // 1. Try Browser GPS
      loc = await getCurrentLocation();
    } catch {
      // 2. If browser GPS is denied or fails, use IP location fallback so location is ALWAYS saved in user_locations
      console.log("GPS denied/unavailable. Attempting IP location fallback...");
      loc = await fetchIPFallbackLocation();
      if (loc) {
        setLocation(loc);
        setAddress({
          street: "",
          area: loc.region || "",
          city: loc.city || "",
          state: loc.region || "",
          country: loc.country || "",
          postalCode: "",
          displayName: `${loc.city ? loc.city + ", " : ""}${loc.region ? loc.region + ", " : ""}${loc.country}`,
        });
      }
    }

    if (loc?.latitude && loc?.longitude) {
      try {
        await Promise.all([
          reverseGeocode(loc.latitude, loc.longitude),
          saveLocation(loc.latitude, loc.longitude),
        ]);
      } catch (err) {
        console.warn("Location save sequence warning:", err);
      }
      setLoading(false);
      return loc;
    }

    setLoading(false);
    return null;
  }, [getCurrentLocation, reverseGeocode, saveLocation]);

  /**
   * Request location permission / trigger update.
   */
  const requestLocationPermission = useCallback(async () => {
    return await updateCompleteLocation();
  }, [updateCompleteLocation]);

  /**
   * Start automatic background tracking every `intervalMs` milliseconds (default: 5 minutes = 300,000ms).
   */
  const startTracking = useCallback((intervalMs = 300000) => {
    stopTracking();

    // Initial location update
    void updateCompleteLocation();

    // Scheduled background updates
    timerRef.current = window.setInterval(() => {
      void updateCompleteLocation();
    }, intervalMs);
  }, [updateCompleteLocation]);

  /**
   * Clean up background tracking timer.
   */
  const stopTracking = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const watchIdRef = useRef(null);
  const [isNavigatingTracking, setIsNavigatingTracking] = useState(false);

  /**
   * Start continuous real-time GPS watchPosition for active navigation.
   */
  const startActiveNavigationWatch = useCallback((onUpdate, onError) => {
    stopActiveNavigationWatch();

    if (typeof window === "undefined" || !navigator.geolocation) {
      const errMessage = "Geolocation is not supported by your browser.";
      setError(errMessage);
      setPermissionStatus("unsupported");
      if (onError) onError(errMessage);
      return;
    }

    setIsNavigatingTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const locData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp || Date.now(),
        };
        setLocation(locData);
        setPermissionStatus("granted");
        setError(null);
        if (onUpdate) onUpdate(locData);
      },
      (err) => {
        let message = "Unable to retrieve real-time GPS location.";
        if (err.code === err.PERMISSION_DENIED) {
          message = "Location permission denied. Please allow location access in browser settings.";
          setPermissionStatus("denied");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = "GPS position unavailable on device.";
        } else if (err.code === err.TIMEOUT) {
          message = "GPS location request timed out.";
        }
        setError(message);
        if (onError) onError(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, []);

  /**
   * Stop continuous active navigation GPS watch.
   */
  const stopActiveNavigationWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsNavigatingTracking(false);
  }, []);

  // Cleanup on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      stopTracking();
      stopActiveNavigationWatch();
    };
  }, [stopTracking, stopActiveNavigationWatch]);

  return {
    location,
    address,
    permissionStatus,
    loading,
    error,
    lastSavedAt,
    isNavigatingTracking,
    requestLocationPermission,
    getCurrentLocation,
    reverseGeocode,
    saveLocation,
    updateCompleteLocation,
    startTracking,
    stopTracking,
    startActiveNavigationWatch,
    stopActiveNavigationWatch,
  };
}
