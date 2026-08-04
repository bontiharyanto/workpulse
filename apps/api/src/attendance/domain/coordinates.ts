export interface Coordinates {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Great-circle distance between two WGS84 points in **meters**, using the Haversine formula.
 * Suitable for distances up to a few hundred km with sub-meter error tolerance.
 *
 * @throws {RangeError} if either coordinate is out of bounds.
 */
export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  assertCoordinate(a);
  assertCoordinate(b);

  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_METERS * c;
}

function assertCoordinate({ latitude, longitude }: Coordinates): void {
  if (latitude < -90 || latitude > 90) {
    throw new RangeError(`latitude out of range: ${latitude}`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new RangeError(`longitude out of range: ${longitude}`);
  }
}
