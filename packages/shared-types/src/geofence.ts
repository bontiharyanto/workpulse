import { z } from 'zod';

import { isoDateTimeSchema, latitudeSchema, longitudeSchema } from './common.js';

/** Sane bounds — 5m (indoor sensor) to 5km (rural office). */
export const radiusMetersSchema = z.number().int().min(5).max(5000);

export const geofenceSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().int(),
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
});
export type CreateGeofenceInput = z.infer<typeof createGeofenceSchema>;

export const updateGeofenceSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    radiusMeters: radiusMetersSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Setidaknya satu field harus diubah',
  });
export type UpdateGeofenceInput = z.infer<typeof updateGeofenceSchema>;
