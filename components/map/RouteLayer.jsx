import React, { useMemo } from "react";
import { Polyline } from "react-leaflet";

export default function RouteLayer({ 
  fastestRoute = [], 
  safestRoute = [], 
  selectedRoute = "safest",
  isIdentical = false,
  dangerZones = []
}) {
  const hasFastest = Array.isArray(fastestRoute) && fastestRoute.length > 0;
  const hasSafest = Array.isArray(safestRoute) && safestRoute.length > 0;

  if (!hasFastest && !hasSafest) return null;

  const routesAreIdentical = isIdentical || (!hasFastest && hasSafest) || (hasFastest && !hasSafest);

  // Define stable path options for Fast (Blue) and Safe (Green) routes
  const fastestOptions = useMemo(() => {
    const isPrimary = selectedRoute === "fastest" || selectedRoute === "compare" || routesAreIdentical;
    return {
      color: "#3B82F6", // Blue
      weight: isPrimary ? 8 : 4,
      opacity: isPrimary ? 0.95 : 0.35,
      lineCap: "round",
      lineJoin: "round",
    };
  }, [selectedRoute, routesAreIdentical]);

  const safestOptions = useMemo(() => {
    const isPrimary = selectedRoute === "safest" || selectedRoute === "compare" || routesAreIdentical;
    return {
      color: "#10B981", // Green
      weight: isPrimary ? 8 : 4,
      opacity: isPrimary ? 0.95 : 0.35,
      lineCap: "round",
      lineJoin: "round",
    };
  }, [selectedRoute, routesAreIdentical]);

  if (routesAreIdentical) {
    const singlePath = hasSafest ? safestRoute : fastestRoute;
    if (!singlePath || singlePath.length === 0) return null;
    return (
      <Polyline
        key="single-identical-route-polyline"
        positions={singlePath}
        pathOptions={selectedRoute === "fastest" ? fastestOptions : safestOptions}
      />
    );
  }

  // Dual Routes: Keep both polylines stably mounted so zooming/panning never drops layers!
  return (
    <>
      {hasFastest && (
        <Polyline
          key="fastest-route-polyline"
          positions={fastestRoute}
          pathOptions={fastestOptions}
        />
      )}

      {hasSafest && (
        <Polyline
          key="safest-route-polyline"
          positions={safestRoute}
          pathOptions={safestOptions}
        />
      )}
    </>
  );
}

