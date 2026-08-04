import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  CreateVendorDto,
  LinkRopaDto,
  ListVendorsQueryDto,
  MarkVendorReviewedDto,
  TerminateVendorDto,
  UpdateVendorDto,
} from './dto/vendor.dto';
import { VendorProcessorService, VendorWithLinks } from './vendor-processor.service';

/**
 * Fase 31f — HR / Super Admin Vendor / Processor Register controller.
 *
 * All reads + writes scoped by `companyId` inside the service. Writes
 * throttled to prevent audit-log spam; reads unthrottled so DPOs can
 * click through the register quickly during a review cycle.
 */
@ApiTags('admin · privacy · vendors')
@Controller('admin/privacy/vendors')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class VendorProcessorController {
  constructor(private readonly service: VendorProcessorService) {}

  @Get()
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListVendorsQueryDto,
  ): Promise<{
    items: ReturnType<typeof toSummaryDto>[];
    nextCursor: string | null;
  }> {
    const { items, nextCursor } = await this.service.list(actor, query);
    return { items: items.map(toSummaryDto), nextCursor };
  }

  @Get(':id')
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(await this.service.detail(actor, id));
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateVendorDto,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(await this.service.create(actor, body));
  }

  @Patch(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateVendorDto,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(await this.service.update(actor, id, body));
  }

  @Post(':id/mark-reviewed')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async markReviewed(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: MarkVendorReviewedDto,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(
      await this.service.markReviewed(actor, id, body.note ?? null, body.nextReviewAt),
    );
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async terminate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: TerminateVendorDto,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(await this.service.terminate(actor, id, body.reason));
  }

  @Post(':id/ropa-links')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async linkRopa(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: LinkRopaDto,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(
      await this.service.linkRopa(actor, id, body.ropaActivityId, body.note ?? null),
    );
  }

  @Delete(':id/ropa-links/:linkId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async unlinkRopa(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ): Promise<ReturnType<typeof toDetailDto>> {
    return toDetailDto(await this.service.unlinkRopa(actor, id, linkId));
  }
}

// ------------------------------------------------------------------
// Mappers — kept adjacent so the wire shape stays in sync with the
// service's internal shape without a separate mapper module.
// ------------------------------------------------------------------

function toSummaryDto(v: VendorWithLinks) {
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    category: v.category,
    status: v.status,
    personalDataVolume: v.personalDataVolume,
    nextReviewAt: v.nextReviewAt.toISOString(),
    contractEndAt: v.contractEndAt?.toISOString() ?? null,
    dpaSignedAt: v.dpaSignedAt?.toISOString() ?? null,
    linkedRopaCount: v._count.ropaLinks,
    updatedAt: v.updatedAt.toISOString(),
  };
}

function toDetailDto(v: VendorWithLinks) {
  return {
    ...toSummaryDto(v),
    description: v.description,
    dataCategories: v.dataCategories,
    dataResidency: v.dataResidency,
    contactName: v.contactName,
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone,
    contractDocumentUrl: v.contractDocumentUrl,
    contractStartAt: v.contractStartAt?.toISOString() ?? null,
    subprocessorsAllowed: v.subprocessorsAllowed,
    securityCertifications: v.securityCertifications,
    lastReviewedAt: v.lastReviewedAt?.toISOString() ?? null,
    lastReviewNote: v.lastReviewNote,
    terminatedAt: v.terminatedAt?.toISOString() ?? null,
    terminatedReason: v.terminatedReason,
    createdAt: v.createdAt.toISOString(),
    ropaLinks: v.ropaLinks.map((link) => ({
      id: link.id,
      ropaActivityId: link.ropaActivityId,
      ropaActivitySlug: link.ropaActivity.slug,
      ropaActivityName: link.ropaActivity.currentVersion?.name ?? null,
      note: link.note,
      createdAt: link.createdAt.toISOString(),
    })),
  };
}
