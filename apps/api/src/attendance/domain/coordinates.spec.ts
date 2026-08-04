import { haversineDistanceMeters } from './coordinates';

describe('haversineDistanceMeters', () => {
  it('returns 0 for the same point', () => {
    expect(
      haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toBe(0);
  });

  it('computes Jakarta Sudirman → Monas distance (~4.2km) within tolerance', () => {
    const sudirman = { latitude: -6.2088, longitude: 106.8456 };
    const monas = { latitude: -6.1754, longitude: 106.8272 };
    const d = haversineDistanceMeters(sudirman, monas);
    expect(d).toBeGreaterThan(4100);
    expect(d).toBeLessThan(4400);
  });

  it('is symmetric', () => {
    const a = { latitude: -6.2, longitude: 106.8 };
    const b = { latitude: -6.19, longitude: 106.81 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('rejects out-of-range latitude', () => {
    expect(() =>
      haversineDistanceMeters({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }),
    ).toThrow(RangeError);
  });

  it('rejects out-of-range longitude', () => {
    expect(() =>
      haversineDistanceMeters({ latitude: 0, longitude: 181 }, { latitude: 0, longitude: 0 }),
    ).toThrow(RangeError);
  });
});
