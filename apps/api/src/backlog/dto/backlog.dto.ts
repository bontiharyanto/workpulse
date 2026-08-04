import { ApiProperty } from '@nestjs/swagger';

/**
 * Serialization shape for `GET /admin/approvals/backlog`. Dates are
 * emitted as ISO 8601 strings so the FE Zod schema can deserialize
 * without additional gymnastics.
 */

class BucketCountsDto {
  @ApiProperty({ example: 4 }) d0_1!: number;
  @ApiProperty({ example: 3 }) d1_3!: number;
  @ApiProperty({ example: 2 }) d3_7!: number;
  @ApiProperty({ example: 1 }) d7_plus!: number;
}

class BacklogItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() userFullName!: string;
  @ApiProperty({ example: '2026-07-30T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 3 }) ageDays!: number;
  @ApiProperty() summary!: string;
}

class ModuleBacklogDto {
  @ApiProperty({ example: 10 }) total!: number;
  @ApiProperty({ example: 7 }) fresh!: number;
  @ApiProperty({ example: 3 }) stale!: number;
  @ApiProperty({ type: BucketCountsDto }) buckets!: BucketCountsDto;
  @ApiProperty({ type: BacklogItemDto, isArray: true })
  oldest!: BacklogItemDto[];
}

export class BacklogSummaryDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ example: 3 }) staleAfterDays!: number;
  @ApiProperty({ type: ModuleBacklogDto }) leave!: ModuleBacklogDto;
  @ApiProperty({ type: ModuleBacklogDto }) overtime!: ModuleBacklogDto;
  @ApiProperty({ type: ModuleBacklogDto }) correction!: ModuleBacklogDto;
}
