import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

import {
  CreateSavedReportDto,
  CustomReportResultDto,
  PreviewCustomReportDto,
  SavedReportResponseDto,
  UpdateSavedReportDto,
} from './dto/custom-report.dto';
import {
  InvalidReportDefinitionError,
  metricDescriptor,
  validateDefinition,
} from './domain/custom-report-definition';
import {
  ReportBuilderService,
  customReportCatalogue,
} from './report-builder.service';
import { SavedReportService } from './saved-report.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Fase 33b — endpoints for the ad-hoc / saved custom report surface.
 *
 * `preview` runs a definition once and returns the raw rows — used by
 * the FE builder while the DPO is composing. `saved/*` persists a
 * favourite recipe. `saved/:id/export.csv` and `saved/:id/export.xlsx`
 * write CSV / XLSX bytes and emit `SAVED_REPORT_EXPORTED` audit rows
 * with the audit-before-stream SHA-256 idiom.
 */
@ApiTags('admin · reports · custom')
@Controller('admin/reports/custom')
@Roles('HR_MANAGER', 'SUPER_ADMIN')
export class CustomReportController {
  constructor(
    private readonly saved: SavedReportService,
    private readonly builder: ReportBuilderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('catalogue')
  catalogue() {
    return customReportCatalogue();
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: PreviewCustomReportDto,
  ): Promise<CustomReportResultDto> {
    let def;
    try {
      def = validateDefinition(body.definition);
    } catch (err) {
      if (err instanceof InvalidReportDefinitionError) {
        throw new BadRequestException(err.message);
      }
      throw err as Error;
    }
    const result = await this.builder.execute(actor.companyId, def);
    return result;
  }

  @Get('saved')
  async list(
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SavedReportResponseDto[]> {
    const rows = await this.saved.list(actor);
    return rows.map(toDto);
  }

  @Get('saved/:id')
  async detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SavedReportResponseDto> {
    return toDto(await this.saved.detail(actor, id));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('saved')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateSavedReportDto,
  ): Promise<SavedReportResponseDto> {
    return toDto(await this.saved.create(actor, body));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Patch('saved/:id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateSavedReportDto,
  ): Promise<SavedReportResponseDto> {
    return toDto(await this.saved.update(actor, id, body));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('saved/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.saved.remove(actor, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('saved/:id/export.csv')
  @Header('Cache-Control', 'no-store')
  async exportCsv(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('windowDaysOverride') windowDaysOverride?: string,
  ): Promise<void> {
    const { def, bytes, filename, contentType, sha256 } =
      await this.buildForExport(actor, id, 'csv', windowDaysOverride);
    await this.auditExport(actor, id, def, bytes, sha256, 'csv');
    this.stream(res, bytes, filename, contentType, sha256);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('saved/:id/export.xlsx')
  @Header('Cache-Control', 'no-store')
  async exportXlsx(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('windowDaysOverride') windowDaysOverride?: string,
  ): Promise<void> {
    const { def, bytes, filename, contentType, sha256 } =
      await this.buildForExport(actor, id, 'xlsx', windowDaysOverride);
    await this.auditExport(actor, id, def, bytes, sha256, 'xlsx');
    this.stream(res, bytes, filename, contentType, sha256);
  }

  // -------- helpers --------

  private async buildForExport(
    actor: AuthenticatedUser,
    id: string,
    format: 'csv' | 'xlsx',
    windowDaysOverride?: string,
  ): Promise<{
    def: ReturnType<typeof validateDefinition>;
    bytes: Buffer;
    filename: string;
    contentType: string;
    sha256: string;
  }> {
    const saved = await this.saved.detail(actor, id);
    let def = validateDefinition(saved.definition);
    if (windowDaysOverride) {
      const days = Number(windowDaysOverride);
      def = validateDefinition({ ...def, filter: { ...def.filter, windowDays: days } });
    }
    const result = await this.builder.execute(actor.companyId, def);
    const bytes =
      format === 'csv'
        ? Buffer.from(renderCsv(saved.name, def, result.rows), 'utf-8')
        : await renderXlsx(saved.name, def, result.rows);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const safeName = saved.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    return {
      def,
      bytes,
      filename: `report-${safeName}-${new Date().toISOString().slice(0, 10)}.${format}`,
      contentType:
        format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256,
    };
  }

  private async auditExport(
    actor: AuthenticatedUser,
    id: string,
    def: ReturnType<typeof validateDefinition>,
    bytes: Buffer,
    sha256: string,
    format: 'csv' | 'xlsx',
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'SAVED_REPORT_EXPORTED',
        entityType: 'SavedReport',
        entityId: id,
        afterJson: {
          format,
          sha256,
          bytes: bytes.byteLength,
          dimension: def.dimension,
          metric: def.metric,
          windowDays: def.filter.windowDays,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private stream(
    res: Response,
    bytes: Buffer,
    filename: string,
    contentType: string,
    sha256: string,
  ): void {
    res
      .header('Content-Type', contentType)
      .header(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      )
      .header('X-Payload-Sha256', sha256)
      .header('Content-Length', String(bytes.byteLength))
      .status(200)
      .send(bytes);
  }
}

function toDto(r: {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  definition: unknown;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SavedReportResponseDto {
  return {
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    description: r.description,
    definition: r.definition,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------- CSV / XLSX renderers ----------

function renderCsv(
  title: string,
  def: ReturnType<typeof validateDefinition>,
  rows: readonly { key: string; label?: string; value: number }[],
): string {
  const md = metricDescriptor(def.metric);
  const header = ['key', 'label', md.label];
  // UTF-8 BOM + CRLF line endings for Excel compatibility.
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push(`# dimension=${def.dimension} metric=${def.metric} windowDays=${def.filter.windowDays}`);
  lines.push(header.map(csvField).join(','));
  for (const r of rows) {
    lines.push(
      [
        csvField(r.key),
        csvField(r.label ?? ''),
        csvField(r.value.toFixed(md.fractionDigits)),
      ].join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function csvField(v: string): string {
  if (/[,"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

async function renderXlsx(
  title: string,
  def: ReturnType<typeof validateDefinition>,
  rows: readonly { key: string; label?: string; value: number }[],
): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');
  const md = metricDescriptor(def.metric);

  ws.mergeCells('A1:C1');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A2:C2');
  ws.getCell('A2').value = `dimension=${def.dimension} · metric=${def.metric} · windowDays=${def.filter.windowDays}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF555555' } };

  ws.getRow(4).values = ['Key', 'Label', md.label];
  ws.getRow(4).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.columns = [
    { key: 'key', width: 30 },
    { key: 'label', width: 30 },
    { key: 'value', width: 20 },
  ];

  rows.forEach((r, idx) => {
    const row = ws.getRow(5 + idx);
    row.getCell(1).value = r.key;
    row.getCell(2).value = r.label ?? '';
    row.getCell(3).value = Number(r.value.toFixed(md.fractionDigits));
    row.getCell(3).alignment = { horizontal: 'right' };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
