export interface GeofenceResponseDto {
  id: string;
  companyId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /**
   * `null` when accuracy budget is disabled. Otherwise clock-ins
   * with `accuracyMeters > maxAccuracyMeters` are rejected server-
   * side.
   */
  maxAccuracyMeters: number | null;
  /**
   * Wi-Fi SSID allow-list. Empty means the SSID fallback is off.
   */
  allowedSsids: string[];
  shiftCount: number;
  createdAt: string;
  updatedAt: string;
}
