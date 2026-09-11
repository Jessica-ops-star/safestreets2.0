import { supabase } from "../src/lib/supabase.js";

export const TRUSTED_PLACE_PROXIMITY_THRESHOLD_METERS = 500;

function normalizePlace(item) {
  if (!item) return null;
  const nameVal = item.place_name || item.name || "Trusted Place";
  const addrVal = item.formatted_address || item.address || "";
  const catVal = item.category || "Other";
  return {
    id: item.id,
    user_id: item.user_id,
    place_name: nameVal,
    name: nameVal,
    category: catVal,
    formatted_address: addrVal,
    address: addrVal,
    latitude: Number(item.latitude || 0),
    longitude: Number(item.longitude || 0),
    created_at: item.created_at || new Date().toISOString()
  };
}

function readUserStore(userId) {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`trusted_places_${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizePlace).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeUserStore(userId, places) {
  if (typeof window === "undefined" || !userId) return;
  try {
    const normalized = (places || []).map(normalizePlace).filter(Boolean);
    window.localStorage.setItem(`trusted_places_${userId}`, JSON.stringify(normalized));
  } catch (err) {
    console.warn("Failed to write local trusted places cache:", err);
  }
}

async function getAuthUserId(overrideUserId = null) {
  if (overrideUserId && overrideUserId !== "me" && overrideUserId !== "guest") {
    return overrideUserId;
  }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user?.id) return sessionData.session.user.id;
    if (typeof window !== "undefined") {
      const localUser = window.localStorage.getItem("current_user");
      if (localUser) {
        const u = JSON.parse(localUser);
        if (u?.id && u.id !== "me" && u.id !== "guest") return u.id;
      }
    }
  } catch {}
  return "local_user";
}

/**
 * Fetch all Trusted Places for the authenticated user from Supabase with RLS.
 */
export async function getTrustedPlaces(overrideUserId = null) {
  const userId = await getAuthUserId(overrideUserId);
  const localItems = readUserStore(userId);

  try {
    const { data, error } = await supabase
      .from("trusted_places")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      const dbMap = new Map();
      // Populate with Supabase data
      data.forEach((item) => {
        const norm = normalizePlace(item);
        if (norm?.id) dbMap.set(norm.id, norm);
      });
      // Merge local items not yet in Supabase (prevent cache loss)
      localItems.forEach((item) => {
        const norm = normalizePlace(item);
        if (norm?.id && !dbMap.has(norm.id)) {
          dbMap.set(norm.id, norm);
        }
      });
      const merged = Array.from(dbMap.values());
      writeUserStore(userId, merged);
      return merged;
    }

    if (error) {
      console.warn("Supabase trusted_places fetch notice (using user cache fallback):", error.message);
    }
  } catch (err) {
    console.warn("Exception fetching trusted_places from Supabase:", err);
  }

  return localItems;
}

/**
 * Add a new Trusted Place to Supabase for the authenticated user.
 */
export async function addTrustedPlace(placeData, overrideUserId = null) {
  const userId = await getAuthUserId(overrideUserId);

  const nameVal = (placeData.place_name || placeData.name || "").trim();
  const addrVal = (placeData.formatted_address || placeData.address || "").trim();
  const catVal = placeData.category || "Other";

  // Database payload only contains columns present in Supabase trusted_places table
  const dbPayload = {
    user_id: userId,
    name: nameVal,
    address: addrVal,
    latitude: Number(placeData.latitude),
    longitude: Number(placeData.longitude)
  };

  let createdPlace = null;

  try {
    const { data, error } = await supabase
      .from("trusted_places")
      .insert([dbPayload])
      .select()
      .single();

    if (!error && data) {
      createdPlace = normalizePlace({ ...data, category: catVal, place_name: nameVal, formatted_address: addrVal });
    } else if (error) {
      console.warn("Supabase insert trusted_places notice (falling back to local cache):", error.message);
    }
  } catch (err) {
    console.warn("Exception inserting trusted_places in Supabase:", err);
  }

  if (!createdPlace) {
    createdPlace = normalizePlace({
      id: `tp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      user_id: userId,
      place_name: nameVal,
      name: nameVal,
      category: catVal,
      formatted_address: addrVal,
      address: addrVal,
      latitude: Number(placeData.latitude),
      longitude: Number(placeData.longitude),
      created_at: new Date().toISOString()
    });
  }

  const currentLocal = readUserStore(userId);
  const updatedLocal = [createdPlace, ...currentLocal.filter((p) => p.id !== createdPlace.id)];
  writeUserStore(userId, updatedLocal);

  return createdPlace;
}

/**
 * Update an existing Trusted Place for the authenticated user.
 */
export async function updateTrustedPlace(id, updates, overrideUserId = null) {
  const userId = await getAuthUserId(overrideUserId);
  if (!id) {
    throw new Error("Valid place ID required to update.");
  }

  const nameVal = (updates.place_name || updates.name || "").trim();
  const addrVal = (updates.formatted_address || updates.address || "").trim();
  const catVal = updates.category || "Other";

  const dbPayload = {
    name: nameVal,
    address: addrVal,
    latitude: Number(updates.latitude),
    longitude: Number(updates.longitude)
  };

  let updatedPlace = null;

  try {
    const { data, error } = await supabase
      .from("trusted_places")
      .update(dbPayload)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (!error && data) {
      updatedPlace = normalizePlace({ ...data, category: catVal, place_name: nameVal, formatted_address: addrVal });
    } else if (error) {
      console.warn("Supabase update trusted_places notice:", error.message);
    }
  } catch (err) {
    console.warn("Exception updating trusted_places:", err);
  }

  const currentLocal = readUserStore(userId);
  const idx = currentLocal.findIndex((p) => p.id === id);
  const fullUpdateObj = normalizePlace({
    id,
    user_id: userId,
    place_name: nameVal,
    name: nameVal,
    category: catVal,
    formatted_address: addrVal,
    address: addrVal,
    latitude: Number(updates.latitude),
    longitude: Number(updates.longitude)
  });

  if (idx >= 0) {
    currentLocal[idx] = { ...currentLocal[idx], ...fullUpdateObj };
    writeUserStore(userId, currentLocal);
    if (!updatedPlace) updatedPlace = currentLocal[idx];
  } else if (!updatedPlace) {
    updatedPlace = fullUpdateObj;
    currentLocal.unshift(updatedPlace);
    writeUserStore(userId, currentLocal);
  }

  return updatedPlace;
}

/**
 * Delete a Trusted Place for the authenticated user.
 */
export async function deleteTrustedPlace(id, overrideUserId = null) {
  const userId = await getAuthUserId(overrideUserId);
  if (!id) return false;

  try {
    const { error } = await supabase
      .from("trusted_places")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.warn("Supabase delete trusted_places notice:", error.message);
    }
  } catch (err) {
    console.warn("Exception deleting trusted_places:", err);
  }

  const currentLocal = readUserStore(userId);
  const updatedLocal = currentLocal.filter((p) => p.id !== id);
  writeUserStore(userId, updatedLocal);

  return true;
}

/**
 * Calculate distance between two lat/lon points using Haversine Formula (in meters).
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Determine if current coordinates are near any of the user's Trusted Places.
 */
export function findNearbyTrustedPlace(currentLat, currentLon, trustedPlaces = [], thresholdMeters = TRUSTED_PLACE_PROXIMITY_THRESHOLD_METERS) {
  if (!currentLat || !currentLon || !Array.isArray(trustedPlaces) || trustedPlaces.length === 0) {
    return { isNear: false, nearestPlace: null, distanceMeters: null };
  }

  let nearestPlace = null;
  let minDistanceMeters = Infinity;

  for (const place of trustedPlaces) {
    const pLat = Number(place.latitude);
    const pLon = Number(place.longitude);
    if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) continue;

    const dist = calculateDistanceMeters(currentLat, currentLon, pLat, pLon);
    if (dist < minDistanceMeters) {
      minDistanceMeters = dist;
      nearestPlace = place;
    }
  }

  if (nearestPlace && minDistanceMeters <= thresholdMeters) {
    return {
      isNear: true,
      nearestPlace,
      distanceMeters: Math.round(minDistanceMeters),
      formattedDistance: minDistanceMeters < 1000 ? `${Math.round(minDistanceMeters)}m` : `${(minDistanceMeters / 1000).toFixed(1)}km`
    };
  }

  return {
    isNear: false,
    nearestPlace,
    distanceMeters: minDistanceMeters === Infinity ? null : Math.round(minDistanceMeters),
    formattedDistance: minDistanceMeters === Infinity ? null : (minDistanceMeters < 1000 ? `${Math.round(minDistanceMeters)}m` : `${(minDistanceMeters / 1000).toFixed(1)}km`)
  };
}
