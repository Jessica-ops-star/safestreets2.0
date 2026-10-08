let lastPosition = null;
let warningShown = false;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function minDistanceToPolylineMeters(posLat, posLon, path) {
  if (!Array.isArray(path) || path.length === 0) return 0;
  if (path.length === 1) {
    const node = path[0];
    const nLat = Number(Array.isArray(node) ? node[0] : node?.lat ?? node?.latitude);
    const nLon = Number(Array.isArray(node) ? node[1] : node?.lon ?? node?.longitude);
    const cosLat = Math.cos(toRadians(posLat));
    return Math.hypot((posLat - nLat) * 111_320, (posLon - nLon) * 111_320 * cosLat);
  }

  const cosLat = Math.cos(toRadians(posLat));
  const px = posLon * 111_320 * cosLat;
  const py = posLat * 111_320;

  let minDistance = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const nodeA = path[i];
    const nodeB = path[i + 1];

    const aLat = Number(Array.isArray(nodeA) ? nodeA[0] : nodeA?.lat ?? nodeA?.latitude);
    const aLon = Number(Array.isArray(nodeA) ? nodeA[1] : nodeA?.lon ?? nodeA?.longitude);
    const bLat = Number(Array.isArray(nodeB) ? nodeB[0] : nodeB?.lat ?? nodeB?.latitude);
    const bLon = Number(Array.isArray(nodeB) ? nodeB[1] : nodeB?.lon ?? nodeB?.longitude);

    if (isNaN(aLat) || isNaN(aLon) || isNaN(bLat) || isNaN(bLon)) continue;

    const ax = aLon * 111_320 * cosLat;
    const ay = aLat * 111_320;
    const bx = bLon * 111_320 * cosLat;
    const by = bLat * 111_320;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let dist = 0;
    if (lenSq === 0) {
      dist = Math.hypot(px - ax, py - ay);
    } else {
      let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      dist = Math.hypot(px - projX, py - projY);
    }

    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance === Infinity ? 0 : minDistance;
}

export function monitorRouteDeviation(currentPosition, selectedRoute, thresholdMeters = 80) {
  if (!currentPosition || !selectedRoute?.path?.length) return null;

  const position = {
    latitude: Number(currentPosition[0] ?? currentPosition.lat ?? currentPosition.latitude),
    longitude: Number(currentPosition[1] ?? currentPosition.lon ?? currentPosition.longitude),
  };

  if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return null;

  const distanceMeters = minDistanceToPolylineMeters(position.latitude, position.longitude, selectedRoute.path);

  const deviation = {
    distanceMeters,
    thresholdMeters,
    warning: distanceMeters > thresholdMeters,
  };

  if (deviation.warning && !warningShown) {
    warningShown = true;
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    return {
      ...deviation,
      message: 'Route deviation detected. Recalculation is recommended.',
    };
  }

  if (!deviation.warning) {
    warningShown = false;
  }

  lastPosition = position;
  return deviation;
}

export function calculateRouteProgress(currentPosition, selectedRoute) {
  if (!currentPosition || !selectedRoute?.path?.length) {
    return {
      remainingDistanceMeters: 0,
      remainingDurationSeconds: 0,
      remainingDistanceLabel: "0 m remaining",
      remainingDurationLabel: "0 min remaining",
      isNearDestination: false
    };
  }

  const posLat = Number(currentPosition[0] ?? currentPosition.lat ?? currentPosition.latitude);
  const posLon = Number(currentPosition[1] ?? currentPosition.lon ?? currentPosition.longitude);
  const path = selectedRoute.path;

  if (!Number.isFinite(posLat) || !Number.isFinite(posLon) || path.length === 0) {
    return {
      remainingDistanceMeters: 0,
      remainingDurationSeconds: 0,
      remainingDistanceLabel: "0 m remaining",
      remainingDurationLabel: "0 min remaining",
      isNearDestination: false
    };
  }

  // Final destination node
  const destNode = path[path.length - 1];
  const destLat = Number(Array.isArray(destNode) ? destNode[0] : destNode?.lat ?? destNode?.latitude);
  const destLon = Number(Array.isArray(destNode) ? destNode[1] : destNode?.lon ?? destNode?.longitude);
  
  const cosLatPos = Math.cos(toRadians(posLat));
  const distToDestMeters = Math.hypot((posLat - destLat) * 111320, (posLon - destLon) * 111320 * cosLatPos);

  // Find closest polyline segment
  let minSegDist = Infinity;
  let closestIndex = 0;
  let projectedPointOnSeg = [destLat, destLon];

  for (let i = 0; i < path.length - 1; i++) {
    const nodeA = path[i];
    const nodeB = path[i + 1];
    const aLat = Number(Array.isArray(nodeA) ? nodeA[0] : nodeA?.lat ?? nodeA?.latitude);
    const aLon = Number(Array.isArray(nodeA) ? nodeA[1] : nodeA?.lon ?? nodeA?.longitude);
    const bLat = Number(Array.isArray(nodeB) ? nodeB[0] : nodeB?.lat ?? nodeB?.latitude);
    const bLon = Number(Array.isArray(nodeB) ? nodeB[1] : nodeB?.lon ?? nodeB?.longitude);

    if (isNaN(aLat) || isNaN(aLon) || isNaN(bLat) || isNaN(bLon)) continue;

    const cosLat = Math.cos(toRadians(posLat));
    const px = posLon * 111320 * cosLat;
    const py = posLat * 111320;
    const ax = aLon * 111320 * cosLat;
    const ay = aLat * 111320;
    const bx = bLon * 111320 * cosLat;
    const by = bLat * 111320;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let dist = 0;
    let projLat = aLat;
    let projLon = aLon;

    if (lenSq > 0) {
      let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      projLat = aLat + t * (bLat - aLat);
      projLon = aLon + t * (bLon - aLon);
      const projX = ax + t * dx;
      const projY = ay + t * dy;
      dist = Math.hypot(px - projX, py - projY);
    } else {
      dist = Math.hypot(px - ax, py - ay);
    }

    if (dist < minSegDist) {
      minSegDist = dist;
      closestIndex = i;
      projectedPointOnSeg = [projLat, projLon];
    }
  }

  // Sum remaining polyline distance
  let remainingDistanceMeters = 0;
  if (closestIndex < path.length - 1) {
    const nextNode = path[closestIndex + 1];
    const nLat = Number(Array.isArray(nextNode) ? nextNode[0] : nextNode?.lat ?? nextNode?.latitude);
    const nLon = Number(Array.isArray(nextNode) ? nextNode[1] : nextNode?.lon ?? nextNode?.longitude);
    const cosL = Math.cos(toRadians(projectedPointOnSeg[0]));
    remainingDistanceMeters += Math.hypot((nLat - projectedPointOnSeg[0]) * 111320, (nLon - projectedPointOnSeg[1]) * 111320 * cosL);
  }

  for (let i = closestIndex + 1; i < path.length - 1; i++) {
    const nodeA = path[i];
    const nodeB = path[i + 1];
    const aLat = Number(Array.isArray(nodeA) ? nodeA[0] : nodeA?.lat ?? nodeA?.latitude);
    const aLon = Number(Array.isArray(nodeA) ? nodeA[1] : nodeA?.lon ?? nodeA?.longitude);
    const bLat = Number(Array.isArray(nodeB) ? nodeB[0] : nodeB?.lat ?? nodeB?.latitude);
    const bLon = Number(Array.isArray(nodeB) ? nodeB[1] : nodeB?.lon ?? nodeB?.longitude);

    const cosL = Math.cos(toRadians(aLat));
    remainingDistanceMeters += Math.hypot((bLat - aLat) * 111320, (bLon - aLon) * 111320 * cosL);
  }

  if (distToDestMeters < remainingDistanceMeters) {
    remainingDistanceMeters = distToDestMeters;
  }

  const totalDist = Number(selectedRoute.distanceMeters || 0);
  const totalDur = Number(selectedRoute.durationSeconds || 0);
  let remainingDurationSeconds = 0;

  if (totalDist > 0 && totalDur > 0) {
    const ratio = Math.min(1, Math.max(0, remainingDistanceMeters / totalDist));
    remainingDurationSeconds = Math.round(totalDur * ratio);
  } else {
    remainingDurationSeconds = Math.round(remainingDistanceMeters / 8.33);
  }

  const distKm = remainingDistanceMeters / 1000;
  const remainingDistanceLabel = distKm >= 1
    ? `${distKm.toFixed(1)} km remaining`
    : `${Math.round(remainingDistanceMeters)} m remaining`;

  const durMins = Math.max(1, Math.round(remainingDurationSeconds / 60));
  const remainingDurationLabel = `${durMins} min remaining`;

  // Destination arrival proximity threshold: <= 40 meters
  const isNearDestination = distToDestMeters <= 40 || remainingDistanceMeters <= 40;

  return {
    remainingDistanceMeters: Math.round(remainingDistanceMeters),
    remainingDurationSeconds: Math.round(remainingDurationSeconds),
    remainingDistanceLabel,
    remainingDurationLabel,
    isNearDestination
  };
}

