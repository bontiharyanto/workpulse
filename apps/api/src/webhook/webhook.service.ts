import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, WebhookEventType } from '@prisma/client';

import { decodeEncryptionKey, decryptString, encryptString } from '../auth/mfa/domain/crypto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { validateUrl } from './domain/url-guard';

export interface CreateEndpointInput {
  url: string;
  description?: string | null;
  events: WebhookEventType[];
}

export interface UpdateEndpointInput {
  url?: string;
  description?: string | null;
  events?: WebhookEventType[];
  active?: boolean;
}

export interface EndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventType[];
  active: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; fullName: string; email: string };
}

export interface EndpointWithSecret extends EndpointRow {
  /** Plaintext secret — only returned at creation and after rotation. */
  secret: string;
}

/**
 * Fase 32e — CRUD for `WebhookEndpoint` rows and helpers the
 * dispatcher / worker need (decryption, list-active-for-event).
 *
 * Access model: only `HR_MANAGER` and `SUPER_ADMIN` of the target
 * tenant may touch these rows. Employees never see them.
 *
 * Secret handling mirrors MFA:
 *   - Generated with `randomBytes(32).toString('base64')`.
 *   - Stored AES-256-GCM-encrypted using `MFA_SECRET_ENCRYPTION_KEY`
 *     (same key, same wire format — reduces the number of secrets an
 *     operator has to rotate).
 *   - Plaintext returned ONCE at creation + on rotate. Never again.
 */
@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name);
  private encryptionKey: Buffer | null = null;
  private blockPrivateIps = true;
  private httpsRequired = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('MFA_SECRET_ENCRYPTION_KEY');
    this.encryptionKey = raw ? decodeEncryptionKey(raw) : null;
    this.blockPrivateIps = this.config.get<string>('WEBHOOK_BLOCK_PRIVATE_IPS', 'true') !== 'false';
    // Force HTTPS in production only. Dev / test benches connect to a
    // local receiver over http://localhost so we can't require https.
    this.httpsRequired = this.config.get<string>('NODE_ENV', 'development') === 'production';
    if (
      this.config.get<string>('NODE_ENV', 'development') === 'production' &&
      !this.encryptionKey
    ) {
      throw new Error('MFA_SECRET_ENCRYPTION_KEY is required in production for webhook secrets');
    }
  }

  async create(actor: AuthenticatedUser, input: CreateEndpointInput): Promise<EndpointWithSecret> {
    this.assertRole(actor);
    await this.validateOrThrow(input.url);
    if (!input.events || input.events.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EVENTS_EMPTY',
        message: 'Pilih minimal satu event untuk endpoint webhook.',
      });
    }
    const secret = randomBytes(32).toString('base64');
    const key = this.requireKey();
    const secretCipher = encryptString(secret, key);
    const row = await this.prisma.webhookEndpoint.create({
      data: {
        companyId: actor.companyId,
        createdById: actor.id,
        url: input.url.trim(),
        description: input.description?.trim() || null,
        secretCipher,
        events: input.events,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'WEBHOOK_ENDPOINT_CREATED',
        entityType: 'WebhookEndpoint',
        entityId: row.id,
        afterJson: {
          url: row.url,
          events: input.events,
        } as Prisma.InputJsonValue,
      },
    });
    return { ...toRow(row), secret };
  }

  async list(actor: AuthenticatedUser): Promise<EndpointRow[]> {
    this.assertRole(actor);
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { companyId: actor.companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    return rows.map(toRow);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateEndpointInput,
  ): Promise<EndpointRow> {
    this.assertRole(actor);
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!existing) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    if (input.url && input.url !== existing.url) {
      await this.validateOrThrow(input.url);
    }
    if (input.events && input.events.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EVENTS_EMPTY',
        message: 'Pilih minimal satu event untuk endpoint webhook.',
      });
    }
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: {
        url: input.url?.trim() ?? undefined,
        description:
          input.description === undefined ? undefined : input.description?.trim() || null,
        events: input.events ?? undefined,
        active: input.active ?? undefined,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'WEBHOOK_ENDPOINT_UPDATED',
        entityType: 'WebhookEndpoint',
        entityId: id,
        afterJson: {
          url: updated.url,
          events: updated.events,
          active: updated.active,
        } as Prisma.InputJsonValue,
      },
    });
    return toRow(updated);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    this.assertRole(actor);
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!existing) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookEndpoint.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          companyId: actor.companyId,
          actorId: actor.id,
          action: 'WEBHOOK_ENDPOINT_DELETED',
          entityType: 'WebhookEndpoint',
          entityId: id,
        },
      });
    });
  }

  async rotateSecret(actor: AuthenticatedUser, id: string): Promise<EndpointWithSecret> {
    this.assertRole(actor);
    const existing = await this.prisma.webhookEndpoint.findFirst({
      where: { id, companyId: actor.companyId },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!existing) throw new NotFoundException('WEBHOOK_NOT_FOUND');
    const key = this.requireKey();
    const secret = randomBytes(32).toString('base64');
    const secretCipher = encryptString(secret, key);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id },
      data: { secretCipher },
      include: {
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: {
        companyId: actor.companyId,
        actorId: actor.id,
        action: 'WEBHOOK_ENDPOINT_SECRET_ROTATED',
        entityType: 'WebhookEndpoint',
        entityId: id,
      },
    });
    return { ...toRow(updated), secret };
  }

  /**
   * Called by the worker — decrypt the stored secret for HMAC signing.
   * Never leak the plaintext beyond the worker's memory (do not put
   * this on a controller).
   */
  decryptSecret(secretCipher: string): string {
    const key = this.requireKey();
    return decryptString(secretCipher, key);
  }

  private requireKey(): Buffer {
    if (!this.encryptionKey) {
      this.logger.error(
        'MFA_SECRET_ENCRYPTION_KEY missing — cannot perform webhook crypto operations',
      );
      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'Webhook belum dikonfigurasi (encryption key hilang).',
      });
    }
    return this.encryptionKey;
  }

  private async validateOrThrow(url: string): Promise<void> {
    const result = await validateUrl(url, {
      httpsRequired: this.httpsRequired,
      blockPrivateIps: this.blockPrivateIps,
    });
    if (!result.ok) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'WEBHOOK_URL_REJECTED',
        message: this.urlErrorCopy(result.issues),
        issues: result.issues,
      });
    }
  }

  private urlErrorCopy(issues: string[]): string {
    if (issues.includes('MALFORMED_URL')) return 'URL tidak valid.';
    if (issues.includes('INVALID_SCHEME')) return 'Skema URL harus http atau https.';
    if (issues.includes('HTTPS_REQUIRED')) return 'Di production, URL wajib https.';
    if (issues.includes('CREDENTIALS_IN_URL'))
      return 'URL tidak boleh berisi kredensial (user:pass@host).';
    if (issues.includes('PRIVATE_IP')) return 'URL resolve ke IP internal / private — dilarang.';
    if (issues.includes('BLOCKED_HOST')) return 'Host tersebut diblokir.';
    if (issues.includes('DNS_LOOKUP_FAILED')) return 'Host tidak dapat di-resolve DNS.';
    return 'URL webhook ditolak.';
  }

  private assertRole(actor: AuthenticatedUser): void {
    if (actor.role !== 'HR_MANAGER' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('FORBIDDEN');
    }
  }
}

type EndpointDb = Prisma.WebhookEndpointGetPayload<{
  include: {
    createdBy: { select: { id: true; fullName: true; email: true } };
  };
}>;

function toRow(row: EndpointDb): EndpointRow {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    active: row.active,
    consecutiveFailures: row.consecutiveFailures,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
  };
}
