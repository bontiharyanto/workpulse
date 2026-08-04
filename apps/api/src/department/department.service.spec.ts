import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DeepMockProxy } from 'jest-mock-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';

import { DepartmentService } from './department.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';


const hr: AuthenticatedUser = {
  id: 'user-hr',
  email: 'hr@a.test',
  companyId: 'company-1',
  departmentId: null,
  role: 'HR_MANAGER',
};

function makeRow(overrides: Partial<{ id: string; name: string; parentId: string | null }> = {}) {
  return {
    id: overrides.id ?? 'dep-1',
    companyId: 'company-1',
    name: overrides.name ?? 'Engineering',
    parentId: overrides.parentId ?? null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    parent: null as null | { id: string; name: string },
    _count: { users: 0, children: 0 },
  };
}

function setup(): { service: DepartmentService; prisma: DeepMockProxy<PrismaService> } {
  const prisma = mockDeep<PrismaService>();
  mockReset(prisma);
  return { service: new DepartmentService(prisma), prisma };
}

function stubTransaction(prisma: DeepMockProxy<PrismaService>): void {
  type TxCallback = (tx: PrismaService) => Promise<unknown>;
  prisma.$transaction.mockImplementation(((cb: TxCallback | unknown) => {
    if (typeof cb === 'function') return (cb as TxCallback)(prisma);
    return Promise.resolve(cb);
  }) as never);
}

describe('DepartmentService.list', () => {
  it('returns tenant-scoped rows sorted by name with user counts', async () => {
    const { service, prisma } = setup();
    prisma.department.findMany.mockResolvedValue([
      { ...makeRow({ id: 'a', name: 'Alpha' }), _count: { users: 3 } },
      { ...makeRow({ id: 'b', name: 'Beta' }), _count: { users: 0 } },
    ] as never);

    const result = await service.list(hr);

    expect(prisma.department.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'a', name: 'Alpha', userCount: 3 });
  });
});

describe('DepartmentService.create', () => {
  it('creates a department and writes an audit log inside a transaction', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    prisma.department.create.mockResolvedValue({
      id: 'new-dep',
      companyId: 'company-1',
      name: 'Sales',
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as never);
    prisma.department.findFirst.mockResolvedValue({
      ...makeRow({ id: 'new-dep', name: 'Sales' }),
    } as never);

    const dto = await service.create(hr, { name: '  Sales  ' });

    expect(prisma.department.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ companyId: 'company-1', name: 'Sales', parentId: null }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DEPARTMENT_CREATED', entityId: 'new-dep' }),
      }),
    );
    expect(dto.name).toBe('Sales');
  });

  it('rejects a parent that belongs to another company', async () => {
    const { service, prisma } = setup();
    prisma.department.findFirst.mockResolvedValue(null as never);

    await expect(
      service.create(hr, { name: 'Sales', parentId: 'other-parent' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps unique-constraint (P2002) violations to CONFLICT DEPARTMENT_NAME_TAKEN', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    prisma.department.create.mockRejectedValue({ code: 'P2002' } as never);

    await expect(service.create(hr, { name: 'DuplicateName' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('DepartmentService.update', () => {
  it('rejects setting parent to self', async () => {
    const { service, prisma } = setup();
    prisma.department.findFirst.mockResolvedValueOnce(makeRow({ id: 'dep-1' }) as never);

    await expect(service.update(hr, 'dep-1', { parentId: 'dep-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('detects and rejects parent cycles', async () => {
    const { service, prisma } = setup();
    // findFirst call order:
    //  1) existing lookup for id=dep-1
    //  2) assertParentInCompany → parent=dep-2
    //  3) assertNoCycle walk: findFirst id=dep-2 → parentId=dep-1 (cycle!)
    prisma.department.findFirst
      .mockResolvedValueOnce(makeRow({ id: 'dep-1' }) as never)
      .mockResolvedValueOnce({ id: 'dep-2' } as never)
      .mockResolvedValueOnce({ parentId: 'dep-1' } as never);

    await expect(service.update(hr, 'dep-1', { parentId: 'dep-2' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound when department is outside actor company', async () => {
    const { service, prisma } = setup();
    prisma.department.findFirst.mockResolvedValue(null as never);

    await expect(service.update(hr, 'dep-1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('DepartmentService.remove', () => {
  it('rejects when the department still has active users', async () => {
    const { service, prisma } = setup();
    prisma.department.findFirst.mockResolvedValue({
      ...makeRow({ id: 'dep-1' }),
      _count: { users: 4, children: 0 },
    } as never);

    await expect(service.remove(hr, 'dep-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when the department still has children', async () => {
    const { service, prisma } = setup();
    prisma.department.findFirst.mockResolvedValue({
      ...makeRow({ id: 'dep-1' }),
      _count: { users: 0, children: 2 },
    } as never);

    await expect(service.remove(hr, 'dep-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-deletes and writes audit log when department is empty', async () => {
    const { service, prisma } = setup();
    stubTransaction(prisma);
    prisma.department.findFirst.mockResolvedValue({
      ...makeRow({ id: 'dep-1' }),
      _count: { users: 0, children: 0 },
    } as never);
    prisma.department.update.mockResolvedValue({
      ...makeRow({ id: 'dep-1' }),
      deletedAt: new Date(),
    } as never);

    await service.remove(hr, 'dep-1');

    expect(prisma.department.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dep-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'DEPARTMENT_DELETED', entityId: 'dep-1' }),
      }),
    );
  });
});
