import React, { useState, useEffect } from "react";

export function parseCoordinateInput(query) {
  if (!query || typeof query !== "string") return null;
  const str = query.trim();

  // Match decimal coordinate formats e.g. "13.0215, 80.1746", "13.0215 80.1746", "lat: 13.0215, lon: 80.1746"
  const coordRegex = /^(?:lat(?:itude)?:?\s*)?(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(?:lon(?:gitude)?:?\s*)?(-?\d+(?:\.\d+)?)$/i;
  const match = str.match(coordRegex);

  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      const formattedCoords = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      return {
        place_id: `coords_${lat}_${lon}`,
        lat: String(lat),
        lon: String(lon),
        display_name: `Coordinates (${formattedCoords})`,
        address: { road: formattedCoords },
        isCoordinates: true
      };
    }
  }

  return null;
}

export function determinePrecision(item, userQuery = "") {
  if (!item) return { precision: "area", precisionLabel: "Destination found at area level" };
  if (item.isCoordinates) return { precision: "exact", precisionLabel: "Exact coordinates specified" };

  const addr = item.address || {};
  const houseNum = addr.house_number || addr.building || addr.house || addr.door_number || addr.flat || addr.unit || addr.plot;
  const poi = addr.amenity || addr.building || addr.office || addr.shop || addr.college || addr.school || addr.hospital || addr.aerodrome || addr.university || addr.tourism || addr.leisure;
  const road = addr.road || addr.pedestrian || addr.street || addr.footway || addr.path || addr.highway;
  const rank = Number(item.place_rank || 0);

  // Exact house/building/POI match
  if (houseNum || poi || rank >= 30 || ["building", "amenity", "shop", "office", "tourism", "leisure", "craft"].includes(item.class)) {
    return {
      precision: "exact",
      precisionLabel: "Exact address found"
    };
  }

  // Street / road match
  if (road || rank >= 26 || item.class === "highway") {
    return {
      precision: "street",
      precisionLabel: "Destination found at street level"
    };
  }

  // Locality / area / city match
  return {
    precision: "area",
    precisionLabel: "Destination found at area level"
  };
}

export function generateSearchAttempts(rawQuery, defaultCity = "Chennai, Tamil Nadu, India") {
  if (!rawQuery || typeof rawQuery !== "string") return [];

  const attempts = [];
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) return [];

  // Attempt 1: Full raw user query (preserving house/door/plot/flat numbers)
  attempts.push(trimmed);

  // Attempt 2: Cleaned & normalized whitespace / punctuation
  let cleaned = trimmed
    .replace(/[#"'`]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned && !attempts.includes(cleaned)) {
    attempts.push(cleaned);
  }

  const locationKeywords = [
    "chennai", "tamil nadu", "india", "mumbai", "delhi", "bengaluru",
    "bangalore", "hyderabad", "kolkata", "kerala", "karnataka"
  ];
  const lowerQuery = trimmed.toLowerCase();
  const hasLocationContext = locationKeywords.some(kw => lowerQuery.includes(kw));

  // Attempt 3: Append region context if no location terms present
  if (!hasLocationContext && defaultCity) {
    const withCity = `${cleaned || trimmed}, ${defaultCity}`;
    if (!attempts.includes(withCity)) {
      attempts.push(withCity);
    }
  }

  // Attempt 4: Fallback - street + area + city (stripping house/door/flat/plot number)
  const doorNumRegex = /^(?:no\.?|plot|flat|door|apt\.?|apartment)?\s*[\d\w\/\-]+\s*,\s*/i;
  let simplifiedStreet = cleaned.replace(doorNumRegex, "").trim();

  if (simplifiedStreet && simplifiedStreet !== cleaned && !attempts.includes(simplifiedStreet)) {
    attempts.push(simplifiedStreet);
  }

  if (simplifiedStreet && !hasLocationContext && defaultCity) {
    const simplifiedWithCity = `${simplifiedStreet}, ${defaultCity}`;
    if (!attempts.includes(simplifiedWithCity)) {
      attempts.push(simplifiedWithCity);
    }
  }

  // Attempt 5: Fallback - area + city (stripping street name)
  const commaParts = cleaned.split(",").map(p => p.trim()).filter(Boolean);
  if (commaParts.length >= 3) {
    const areaCity = commaParts.slice(commaParts.length - 2).join(", ");
    if (areaCity && !attempts.includes(areaCity)) {
      attempts.push(areaCity);
    }
  }

  return attempts;
}

export function rankCandidates(candidates, userQuery) {
  if (!candidates || candidates.length === 0) return [];
  if (candidates.length === 1) return candidates;

  const queryTerms = userQuery
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);

  return [...candidates]
    .map(candidate => {
      let score = 0;
      const name = (candidate.display_name || "").toLowerCase();
      const type = (candidate.type || "").toLowerCase();
      const category = (candidate.class || "").toLowerCase();

      // Term matching score
      queryTerms.forEach(term => {
        if (name.includes(term)) {
          score += 10;
          const regex = new RegExp(`\\b${term}\\b`, "i");
          if (regex.test(name)) {
            score += 5;
          }
        }
      });

      // Prefer POIs / buildings / colleges / hospitals / aerodromes / stations over generic highway segments
      if (
        [
          "college", "university", "hospital", "aerodrome", "school",
          "bus_station", "station", "building", "townhall", "police"
        ].includes(type) ||
        ["amenity", "aeroway", "building", "tourism", "leisure", "healthcare"].includes(category)
      ) {
        score += 15;
      }

      if (candidate.importance) {
        score += parseFloat(candidate.importance) * 10;
      }

      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.candidate);
}

export async function searchAddress(query, options = {}) {
  if (!query || query.trim().length < 2) return [];

  // 1. Direct coordinate check
  const coordResult = parseCoordinateInput(query);
  if (coordResult) {
    const prec = determinePrecision(coordResult, query);
    return [{ ...coordResult, ...prec }];
  }

  // 2. Progressive search attempts with Nominatim
  const cityContext = options.defaultCity || "Chennai, Tamil Nadu, India";
  const attempts = generateSearchAttempts(query, cityContext);
  let allResults = [];
  const seenPlaceIds = new Set();

  for (const attemptQuery of attempts) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(attemptQuery)}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SafeStreets-App/1.0 (contact@safestreets.app)'
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          for (const item of data) {
            if (item.place_id && !seenPlaceIds.has(item.place_id)) {
              seenPlaceIds.add(item.place_id);
              const prec = determinePrecision(item, query);
              allResults.push({ ...item, ...prec });
            }
          }
          if (allResults.length > 0) {
            // Stop early if current attempt found candidate results
            break;
          }
        }
      }
    } catch (err) {
      console.warn("Nominatim search attempt failed for query:", attemptQuery, err);
    }
  }

  return rankCandidates(allResults, query);
}

export async function geocodeAddress(query, options = {}) {
  if (!query || query.trim().length < 2) return null;
  try {
    const coordResult = parseCoordinateInput(query);
    if (coordResult) {
      const prec = determinePrecision(coordResult, query);
      return {
        address: coordResult.display_name,
        latitude: parseFloat(coordResult.lat),
        longitude: parseFloat(coordResult.lon),
        isCoordinates: true,
        precision: prec.precision,
        precisionLabel: prec.precisionLabel,
        results: [{ ...coordResult, ...prec }]
      };
    }

    const results = await searchAddress(query.trim(), options);
    if (!results || !Array.isArray(results) || results.length === 0) return null;
    const top = results[0];
    const prec = top.precision ? { precision: top.precision, precisionLabel: top.precisionLabel } : determinePrecision(top, query);
    return {
      address: top.display_name,
      latitude: parseFloat(top.lat),
      longitude: parseFloat(top.lon),
      isCoordinates: false,
      precision: prec.precision,
      precisionLabel: prec.precisionLabel,
      results: results
    };
  } catch (err) {
    console.error("Geocoding failed for query:", query, err);
    return null;
  }
}

const reverseCache = new Map();

export async function reverseGeocodeAddress(latitude, longitude) {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (isNaN(lat) || isNaN(lon)) return null;

  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (reverseCache.has(cacheKey)) {
    return reverseCache.get(cacheKey);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SafeStreets-App/1.0 (contact@safestreets.app)'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.address) {
      const a = data.address;
      const road = a.road || a.pedestrian || a.suburb || a.neighbourhood || "";
      const locality = a.village || a.suburb || a.neighbourhood || a.town || a.city_district || "";
      const city = a.city || a.town || a.county || a.state_district || "";
      const state = a.state || "";

      const parts = [];
      [road, locality, city, state].forEach(p => {
        if (p && !parts.includes(p)) parts.push(p);
      });

      const formatted = parts.length > 0 ? parts.join(", ") : (data.display_name || null);

      if (formatted) {
        reverseCache.set(cacheKey, formatted);
        return formatted;
      }
    }
  } catch (err) {
    console.warn("Reverse geocoding failed for coordinates:", lat, lon, err);
  }

  return null;
}

export async function reverseGeocode(lat, lon) {
  return reverseGeocodeAddress(lat, lon);
}

export function useResolvedLocation(item) {
  const rawLoc = item?.location || item?.address || "";
  const lat = item?.latitude ?? item?.lat;
  const lon = item?.longitude ?? item?.lon;

  const hasValidCoords =
    lat !== null &&
    lat !== undefined &&
    lon !== null &&
    lon !== undefined &&
    !isNaN(Number(lat)) &&
    !isNaN(Number(lon));

  const fallbackCoords = hasValidCoords
    ? `Lat: ${Number(lat).toFixed(4)}, Lon: ${Number(lon).toFixed(4)}`
    : "";

  const isRawCoords =
    !rawLoc ||
    rawLoc.toLowerCase().includes("current gps") ||
    rawLoc.toLowerCase().includes("gps:") ||
    rawLoc.toLowerCase().startsWith("lat:") ||
    /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(rawLoc);

  const [locationText, setLocationText] = useState(() => {
    if (!isRawCoords && rawLoc) return rawLoc;
    if (hasValidCoords) return fallbackCoords;
    return rawLoc || "Location Recorded";
  });
  const [isLoading, setIsLoading] = useState(isRawCoords && hasValidCoords);

  useEffect(() => {
    let isMounted = true;

    if (!isRawCoords && rawLoc) {
      setLocationText(rawLoc);
      setIsLoading(false);
      return;
    }

    if (hasValidCoords) {
      setIsLoading(true);
      reverseGeocodeAddress(Number(lat), Number(lon))
        .then((resolvedAddr) => {
          if (isMounted) {
            if (resolvedAddr) {
              setLocationText(resolvedAddr);
            } else {
              setLocationText(rawLoc || fallbackCoords);
            }
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) {
            setLocationText(rawLoc || fallbackCoords);
            setIsLoading(false);
          }
        });
    } else {
      setLocationText(rawLoc || "Location Recorded");
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [rawLoc, lat, lon, isRawCoords, hasValidCoords, fallbackCoords]);

  return { locationText, isLoading, isRawCoords };
}

export function ReportLocationDisplay({ item, className = "", fallbackText = "Location Recorded" }) {
  const { locationText, isLoading } = useResolvedLocation(item);
  return React.createElement(
    "span",
    { className },
    isLoading ? "Resolving location..." : (locationText || fallbackText)
  );
}
