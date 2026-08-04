import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateErasureRequestDto {
  @ApiProperty({
    required: false,
    description: 'Alasan permintaan penghapusan. Bebas, opsional, maksimal 1000 karakter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class DecideErasureDto {
  @ApiProperty({
    required: false,
    description: 'Catatan keputusan. Wajib untuk penolakan, opsional untuk persetujuan.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectErasureDto {
  @ApiProperty({
    description: 'Alasan penolakan (wajib). 1–1000 karakter.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note!: string;
}

export class DataErasureRequestDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    enum: ['PENDING_APPROVAL', 'APPROVED_SCHEDULED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'FAILED'],
  })
  status!:
    'PENDING_APPROVAL' | 'APPROVED_SCHEDULED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'FAILED';

  @ApiProperty({ nullable: true })
  reason!: string | null;

  @ApiProperty()
  requestedAt!: string;

  @ApiProperty({ nullable: true })
  decidedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'HR/admin decider ID.' })
  decidedById!: string | null;

  @ApiProperty({ nullable: true })
  decisionNote!: string | null;

  @ApiProperty({ nullable: true })
  scheduledFor!: string | null;

  @ApiProperty({ nullable: true })
  executedAt!: string | null;

  @ApiProperty({ nullable: true })
  cancelledAt!: string | null;

  @ApiProperty({ nullable: true })
  failedAt!: string | null;

  @ApiProperty({ nullable: true })
  failureReason!: string | null;
}

export class DataErasureListResponseDto {
  @ApiProperty({ type: [DataErasureRequestDto] })
  requests!: DataErasureRequestDto[];
}

export class DataErasureAdminRequestDto extends DataErasureRequestDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  companyId!: string;

  /**
   * Convenience data flattened on the admin listing so the queue
   * doesn't need N extra fetches. Everything here is derived and
   * safe to expose to HR / admin scope.
   */
  @ApiProperty()
  requesterName!: string;

  @ApiProperty()
  requesterEmail!: string;
}

export class DataErasureAdminListResponseDto {
  @ApiProperty({ type: [DataErasureAdminRequestDto] })
  requests!: DataErasureAdminRequestDto[];
}
