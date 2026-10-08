import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, Marker, Popup, CircleMarker, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Fix default marker assets for Leaflet in bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom Red Pin for Source / Origin
const sourceIcon = L.divIcon({
  className: "custom-source-pin",
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" stroke="#991b1b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));">
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0z"/>
        <circle cx="12" cy="10" r="3" fill="#ffffff"/>
      </svg>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Custom Green Pin for Destination
const destinationIcon = L.divIcon({
  className: "custom-dest-pin",
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="#22c55e" stroke="#14532d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));">
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0z"/>
        <circle cx="12" cy="10" r="3" fill="#ffffff"/>
      </svg>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Custom Blinking Blue Dot for Live Location
const liveLocationIcon = L.divIcon({
  className: "custom-live-blue-dot",
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;">
      <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background-color: #3b82f6; opacity: 0.55; animation: liveDotPulse 1.6s infinite ease-in-out;"></div>
      <div style="position: relative; width: 14px; height: 14px; border-radius: 50%; background-color: #2563eb; border: 2.5px solid #ffffff; box-shadow: 0 0 10px rgba(37,99,235,0.9);"></div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

// Helper for Category Emoji/Badge on Trusted Place Pins
function getCategoryEmoji(category) {
  switch (category) {
    case "Home": return "🏠";
    case "College": return "🎓";
    case "School": return "🏫";
    case "Work": return "💼";
    case "Friend's House": return "👥";
    case "Relative's House": return "🏠";
    default: return "📍";
  }
}

// Custom Trusted Place Pin Icon Generator
function createTrustedPlaceIcon(category, name) {
  const emoji = getCategoryEmoji(category);
  return L.divIcon({
    className: "custom-trusted-place-pin",
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));">
        <div style="background-color: #0f172a; color: #ffffff; font-size: 14px; font-weight: 800; border-radius: 9999px; padding: 4px 8px; border: 2px solid #10b981; display: flex; align-items: center; gap: 4px; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
          <span>${emoji}</span>
          <span style="font-family: system-ui, sans-serif; font-size: 11px; max-width: 90px; overflow: hidden; text-overflow: ellipsis;">${name || category}</span>
        </div>
        <div style="width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #10b981; margin-top: -1px;"></div>
      </div>
    `,
    iconSize: [100, 36],
    iconAnchor: [50, 36],
    popupAnchor: [0, -36],
  });
}

function MapController({ center, zoom, from, to, recenterOnUser, flyToTarget, onUserInteract }) {
  const map = useMap();
  const prevRouteKey = useRef("");
  const prevCenterKey = useRef("");
  const prevFlyKey = useRef(null);

  // Track user drag/zoom interactions to lock map from auto-snapping
  useMapEvents({
    dragstart: () => {
      onUserInteract?.();
    },
    zoomstart: () => {
      onUserInteract?.();
    },
  });

  // Explicit flyTo target
  useEffect(() => {
    if (flyToTarget?.coords && flyToTarget.key !== prevFlyKey.current) {
      prevFlyKey.current = flyToTarget.key;
      map.flyTo(flyToTarget.coords, 15, { duration: 0.8 });
    }
  }, [flyToTarget, map]);

  // Fit bounds ONCE when a route (from & to) is set or changed
  useEffect(() => {
    if (from && to && Array.isArray(from) && Array.isArray(to)) {
      const routeKey = `${Number(from[0]).toFixed(4)},${Number(from[1]).toFixed(4)}-${Number(to[0]).toFixed(4)},${Number(to[1]).toFixed(4)}`;
      if (prevRouteKey.current !== routeKey) {
        prevRouteKey.current = routeKey;
        const bounds = L.latLngBounds([from, to]);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } else {
      prevRouteKey.current = "";
    }
  }, [from, to, map]);

  // Center on user position ONLY when explicitly requested AND no active route is being inspected
  useEffect(() => {
    const hasRoute = Boolean(from && to);
    if (center && recenterOnUser && !hasRoute) {
      const centerKey = `${center[0]},${center[1]}`;
      if (prevCenterKey.current !== centerKey) {
        prevCenterKey.current = centerKey;
        map.flyTo(center, zoom, { duration: 0.75 });
      }
    }
  }, [center, zoom, recenterOnUser, from, to, map]);

  return null;
}

export default function MapView({ 
  center = [12.9716, 77.5946], 
  zoom = 13, 
  from, 
  to, 
  userLocation,
  flyToTarget,
  children, 
  safetyData = [], 
  communityReports = [],
  trustedPlaces = [],
  onSelectTrustedPlace,
  recenterOnUser = false,
  onUserInteract
}) {
  const markers = Array.isArray(safetyData) ? safetyData : [];
  const reports = Array.isArray(communityReports) ? communityReports : [];
  const places = Array.isArray(trustedPlaces) ? trustedPlaces : [];

  return (
    <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapController 
        center={center} 
        zoom={zoom} 
        from={from} 
        to={to} 
        recenterOnUser={recenterOnUser}
        flyToTarget={flyToTarget}
        onUserInteract={onUserInteract}
      />

      {/* Live Location - Blinking Blue Dot */}
      {userLocation && (
        <Marker position={userLocation} icon={liveLocationIcon}>
          <Popup>Your Live Location</Popup>
        </Marker>
      )}

      {/* Source Pin - Red Pin */}
      {from && (
        <Marker position={from} icon={sourceIcon}>
          <Popup>Source Location (Origin)</Popup>
        </Marker>
      )}

      {/* Destination Pin - Green Pin */}
      {to && (
        <Marker position={to} icon={destinationIcon}>
          <Popup>Destination</Popup>
        </Marker>
      )}

      {/* Trusted Places Markers */}
      {places.map((place) => {
        const lat = Number(place.latitude);
        const lon = Number(place.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const icon = createTrustedPlaceIcon(place.category, place.place_name);

        return (
          <Marker 
            key={place.id || `${lat}-${lon}`} 
            position={[lat, lon]} 
            icon={icon}
            eventHandlers={{
              click: () => onSelectTrustedPlace?.(place)
            }}
          >
            <Popup>
              <div style={{ padding: "4px", minWidth: "160px" }}>
                <div style={{ fontWeight: "800", fontSize: "14px", color: "#0f172a" }}>
                  {getCategoryEmoji(place.category)} {place.place_name}
                </div>
                <div style={{ fontSize: "11px", fontWeight: "700", color: "#10b981", textTransform: "uppercase", marginTop: "2px" }}>
                  {place.category}
                </div>
                <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px", lineHeight: "1.3" }}>
                  {place.formatted_address}
                </div>
                {onSelectTrustedPlace && (
                  <button
                    type="button"
                    onClick={() => onSelectTrustedPlace(place)}
                    style={{
                      marginTop: "8px",
                      width: "100%",
                      backgroundColor: "#0f172a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    Start Navigation
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}

      {children}
    </MapContainer>
  );
}
