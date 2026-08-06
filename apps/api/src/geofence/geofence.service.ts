import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Geofence, Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import type { GeofenceResponseDto } from './dto/geofence-response.dto';

export interface CreateGeofenceInput {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyMeters?: number | null;
  allowedSsids?: string[];
}

export interface UpdateGeofenceInput {
  name?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  maxAccuracyMeters?: number | null;
  allowedSsids?: string[];
}

@Injectable()
export class GeofenceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedUser): Promise<GeofenceResponseDto[]> {
    const rows = await this.prisma.geofence.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { shifts: { where: { deletedAt: null } } } } },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(actor: AuthenticatedUser, id: string): Promise<GeofenceResponseDto> {
    const row = await this.findOwn(actor.companyId, id);
    return this.toDto(row);
  }

  async create(actor: AuthenticatedUser, input: CreateGeofenceInput): Promise<GeofenceResponseDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.geofence.create({
        data: {
          companyId: actor.companyId,
          name: input.name.trim(),
          latitude: input.latitude,
          longitude: input.longitude,
          radiusMeters: input.radiusMeters,
          maxAccuracyMeters: input.maxAccuracyMeters ?? null,
          allowedSsids: sanitiseSsids(input.allowedSsids),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'GEOFENCE_CREATED',
          entityType: 'Geofence',
          entityId: row.id,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
      return row;
    });
    return this.get(actor, created.id);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateGeofenceInput,
  ): Promise<GeofenceResponseDto> {
    const existing = await this.findOwn(actor.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.geofence.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? undefined,
          latitude: input.latitude ?? undefined,
          longitude: input.longitude ?? undefined,
          radiusMeters: input.radiusMeters ?? undefined,
          // `null` is a valid update — it clears the accuracy check.
          // Only `undefined` skips the field, so we forward `null`
          // through explicitly.
          maxAccuracyMeters:
            input.maxAccuracyMeters === undefined
              ? undefined
              : input.maxAccuracyMeters,
          allowedSsids:
            input.allowedSsids === undefined
              ? undefined
              : sanitiseSsids(input.allowedSsids),
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'GEOFENCE_UPDATED',
          entityType: 'Geofence',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.findOwn(actor.companyId, id);
    if (existing._count.shifts > 0) {
      throw new ConflictException('GEOFENCE_IN_USE_BY_SHIFT');
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.geofence.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'GEOFENCE_DELETED',
          entityType: 'Geofence',
          entityId: row.id,
          beforeJson: existing as unknown as Prisma.InputJsonValue,
          afterJson: row as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async findOwn(
    companyId: string,
    id: string,
  ): Promise<Geofence & { _count: { shifts: number } }> {
    const row = await this.prisma.geofence.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { _count: { select: { shifts: { where: { deletedAt: null } } } } },
    });
    if (!row) throw new NotFoundException('GEOFENCE_NOT_FOUND');
    return row;
  }

  private toDto(row: Geofence & { _count: { shifts: number } }): GeofenceResponseDto {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      radiusMeters: row.radiusMeters,
      maxAccuracyMeters: row.maxAccuracyMeters,
      allowedSsids: row.allowedSsids,
      shiftCount: row._count.shifts,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Trim whitespace, drop empty strings, and dedupe SSIDs. Callers
 * pass raw form input; this defends against surprising duplicates
 * and whitespace-only entries slipping past class-validator.
 */
function sanitiseSsids(input: string[] | undefined): string[] {
  if (!input || input.length === 0) return [];
  const cleaned = input.map((s) => s.trim()).filter((s) => s.length > 0);
  return Array.from(new Set(cleaned));
}
