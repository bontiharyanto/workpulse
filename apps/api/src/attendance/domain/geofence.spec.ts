import { checkGeofence } from './geofence';

describe('checkGeofence', () => {
  const jakartaHQ = { latitude: -6.2088, longitude: 106.8456 };
  const fence = { center: jakartaHQ, radiusMeters: 150 };

  it('returns inside=true for the exact center', () => {
    expect(checkGeofence(jakartaHQ, fence).inside).toBe(true);
  });

  it('returns inside=true just inside the boundary (~145m)', () => {
    const nearby = { latitude: -6.2088 + 0.0013, longitude: 106.8456 };
    const result = checkGeofence(nearby, fence);
    expect(result.inside).toBe(true);
    expect(result.distanceMeters).toBeLessThanOrEqual(150);
  });

  it('returns inside=false just outside the boundary (~200m)', () => {
    const far = { latitude: -6.2088 + 0.0018, longitude: 106.8456 };
    const result = checkGeofence(far, fence);
    expect(result.inside).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(150);
  });

  it('rejects zero or negative radius', () => {
    expect(() => checkGeofence(jakartaHQ, { center: jakartaHQ, radiusMeters: 0 })).toThrow(
      RangeError,
    );
    expect(() => checkGeofence(jakartaHQ, { center: jakartaHQ, radiusMeters: -5 })).toThrow(
      RangeError,
    );
  });
});
