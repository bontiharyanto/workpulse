import { z } from 'zod';

/** ISO 8601 UTC timestamp string. */
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Must be a valid ISO 8601 datetime with timezone offset' });

/** WGS84 latitude in degrees. */
export const latitudeSchema = z.number().gte(-90).lte(90);

/** WGS84 longitude in degrees. */
export const longitudeSchema = z.number().gte(-180).lte(180);

/** GPS accuracy in meters (device-reported). */
export const accuracyMetersSchema = z.number().nonnegative().max(10_000);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

/** Standard error codes surfaced across FE/BE. */
export const errorCodeSchema = z.enum([
  'OUTSIDE_GEOFENCE',
  'INSUFFICIENT_BALANCE',
  'SHIFT_NOT_FOUND',
  'ALREADY_CLOCKED_IN',
  'NOT_CLOCKED_IN',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'CONFLICT',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
