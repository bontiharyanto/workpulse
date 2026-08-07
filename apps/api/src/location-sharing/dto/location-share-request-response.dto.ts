import { ApiProperty } from '@nestjs/swagger';
import type { LocationShareRequestStatus } from '@prisma/client';

/**
 * Nested coordinate payload. Present iff the request was
 * `RESPONDED` AND its `LocationPing` hasn't been purged yet
 * (7-day window). Nullable elsewhere.
 */
export class LocationPingResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'WGS84 latitude in degrees.' })
  latitude!: number;

  @ApiProperty({ description: 'WGS84 longitude in degrees.' })
  longitude!: number;

  @ApiProperty({ description: 'Device-reported accuracy in meters at collection time.' })
  accuracyMeters!: number;

  @ApiProperty({ description: 'Client wall-clock at collection (Geolocation.timestamp).' })
  clientCapturedAt!: string;

  @ApiProperty({ description: 'Server receive time.' })
  createdAt!: string;
}

/**
 * Wire shape for the request row as consumed by both supervisor
 * and target-user endpoints. `ping` is only populated when the
 * caller is authorised to see it AND it hasn't been purged. See
 * `location-share-request-response.spec.ts` for the exact
 * visibility matrix.
 */
export class LocationShareRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  supervisorId!: string;

  @ApiProperty()
  supervisorName!: string;

  @ApiProperty()
  targetUserId!: string;

  @ApiProperty()
  targetUserName!: string;

  @ApiProperty({ enum: ['PENDING', 'RESPONDED', 'DECLINED', 'EXPIRED', 'CANCELLED'] })
  status!: LocationShareRequestStatus;

  @ApiProperty()
  reason!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ nullable: true })
  respondedAt!: string | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true })
  viewedAt!: string | null;

  @ApiProperty({ type: () => LocationPingResponseDto, nullable: true })
  ping!: LocationPingResponseDto | null;
}
