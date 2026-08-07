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
  /**
   * Cap on the "fuzzy radius" leeway granted per clock-in based on
   * device-reported GPS accuracy. `0` = strict circle-membership
   * check (legacy). Default `50`.
   */
  maxLeewayMeters: number;
  shiftCount: number;
  createdAt: string;
  updatedAt: string;
}
