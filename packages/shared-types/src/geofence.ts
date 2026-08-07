import { z } from 'zod';

import { isoDateTimeSchema, latitudeSchema, longitudeSchema } from './common.js';

/** Sane bounds — 5m (indoor sensor) to 5km (rural office). */
export const radiusMetersSchema = z.number().int().min(5).max(5000);

/**
 * GPS accuracy threshold (in meters). Below 10m is aspirational for
 * consumer devices; above 500m implies the device is essentially
 * geolocating by IP and should not be trusted for attendance.
 */
export const maxAccuracyMetersSchema = z.number().int().min(10).max(500);

/**
 * Wi-Fi SSID entry. SSIDs can technically be up to 32 bytes (per
 * IEEE 802.11), often UTF-8. We keep the character bound loose but
 * cap to 64 chars to defend against payload-bloating.
 */
export const wifiSsidSchema = z.string().trim().min(1).max(64);

/**
 * Cap on the "fuzzy radius" leeway (in meters). `0` = strict circle
 * membership (legacy). `500` is the ceiling — beyond that a device
 * with bad accuracy could effectively walk in from anywhere.
 */
export const maxLeewayMetersSchema = z.number().int().min(0).max(500);

export const geofenceSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().int(),
  /**
   * `null` = no accuracy check (legacy). Any positive value gates
   * clock-in on the client's reported `accuracyMeters` field.
   */
  maxAccuracyMeters: z.number().int().nullable(),
  /**
   * Wi-Fi SSID allow-list. Empty = disabled. Non-empty acts as an
   * OR-fallback for indoor GPS-hostile buildings — clock-in
   * accepted when either the geofence check passes OR the client
   * reports a whitelisted SSID.
   */
  allowedSsids: z.array(wifiSsidSchema),
  /**
   * Fuzzy-radius cap. `0` restores strict circle-membership. Server
   * uses `effectiveRadius = radiusMeters + min(accuracyMeters, maxLeewayMeters)`.
   */
  maxLeewayMeters: z.number().int().nonnegative(),
  shiftCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Geofence = z.infer<typeof geofenceSchema>;

export const createGeofenceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusMeters: radiusMetersSchema,
  maxAccuracyMeters: maxAccuracyMetersSchema.nullable().optional(),
  allowedSsids: z.array(wifiSsidSchema).max(10).optional(),
  maxLeewayMeters: maxLeewayMetersSchema.optional(),
});
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;

export const updateGeofenceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radiusMeters: radiusMetersSchema.optional(),
    maxAccuracyMeters: maxAccuracyMetersSchema.nullable().optional(),
    allowedSsids: z.array(wifiSsidSchema).max(10).optional(),
    maxLeewayMeters: maxLeewayMetersSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;
