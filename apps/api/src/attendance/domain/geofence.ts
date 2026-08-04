import type { Coordinates } from './coordinates';
import { haversineDistanceMeters } from './coordinates';

export interface GeofenceCircle {
  center: Coordinates;
  radiusMeters: number;
}

export interface GeofenceCheckResult {
  inside: boolean;
  distanceMeters: number;
}

/**
 * Determine whether a given point falls inside a circular geofence.
 * Distance is inclusive of the boundary: exactly-on-boundary counts as inside.
 */
export function checkGeofence(point: Coordinates, fence: GeofenceCircle): GeofenceCheckResult {
  if (fence.radiusMeters <= 0) {
    throw new RangeError(`radiusMeters must be positive, got: ${fence.radiusMeters}`);
  }
  const distanceMeters = haversineDistanceMeters(point, fence.center);
  return {
    inside: distanceMeters <= fence.radiusMeters,
    distanceMeters: Math.round(distanceMeters),
  };
}
