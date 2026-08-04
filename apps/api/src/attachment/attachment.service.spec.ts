import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import { AttachmentService } from './attachment.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { StorageProvider } from '../storage/storage.provider';

const actor: AuthenticatedUser = {
  id: 'u-1',
  email: 'u@x.test',
  companyId: 'co-1',
  departmentId: null,
  role: 'EMPLOYEE',
};

function makeStorage(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    enabled: true,
    presignPut: jest.fn(async () => ({
      uploadUrl: 'https://s3/put',
      requiredHeaders: { 'Content-Type': 'application/pdf', 'Content-Length': '123' },
      expiresIn: 300,
    })),
    presignGet: jest.fn(async () => ({ url: 'https://s3/get', expiresIn: 3600 })),
    putObject: jest.fn(async () => undefined),
    deleteObject: jest.fn(async () => undefined),
    healthCheck: jest.fn(async () => ({ ok: true as const, latencyMs: 1 })),
    ...overrides,
  };
}

describe('AttachmentService.presignPut', () => {
  it('rejects a disallowed content-type', async () => {
    const svc = new AttachmentService(makeStorage());
    await expect(
      svc.presignPut(actor, {
        purpose: 'leave-attachment',
        contentType: 'text/html',
        sizeBytes: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file exceeding MAX_UPLOAD_BYTES', async () => {
    const svc = new AttachmentService(makeStorage());
    await expect(
      svc.presignPut(actor, {
        purpose: 'leave-attachment',
        contentType: 'application/pdf',
        sizeBytes: 999_999_999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when storage is not enabled', async () => {
    const svc = new AttachmentService(makeStorage({ enabled: false }));
    await expect(
      svc.presignPut(actor, {
        purpose: 'leave-attachment',
        contentType: 'application/pdf',
        sizeBytes: 100,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('builds a key scoped to the actor and calls presignPut', async () => {
    const storage = makeStorage();
    const svc = new AttachmentService(storage);
    const res = await svc.presignPut(actor, {
      purpose: 'leave-attachment',
      contentType: 'application/pdf',
      sizeBytes: 12_345,
    });
    expect(res.fileKey).toMatch(
      /^attachments\/leave-attachment\/co-1\/u-1\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/u,
    );
    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'application/pdf',
        contentLength: 12_345,
      }),
    );
    expect(res.uploadUrl).toBe('https://s3/put');
  });
});
