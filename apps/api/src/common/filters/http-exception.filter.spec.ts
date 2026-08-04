import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request } from 'express';

import { HttpExceptionFilter } from './http-exception.filter';

interface CapturedResponse {
  status: jest.Mock<CapturedResponse, [number]>;
  json: jest.Mock<CapturedResponse, [unknown]>;
  payload: unknown;
  statusCode: number;
}

function makeHost(url = '/api/v1/test'): {
  host: ArgumentsHost;
  res: CapturedResponse;
} {
  const res: CapturedResponse = {
    status: jest.fn().mockImplementation(function (this: CapturedResponse, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn().mockImplementation(function (this: CapturedResponse, body: unknown) {
      this.payload = body;
      return this;
    }),
    payload: undefined,
    statusCode: 0,
  };
  res.status = res.status.bind(res) as CapturedResponse['status'];
  res.json = res.json.bind(res) as CapturedResponse['json'];

  const req = { url } as Request;
  const host = {
    switchToHttp: () => ({
      getResponse: <T>() => res as unknown as T,
      getRequest: <T>() => req as unknown as T,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('promotes an explicit `code` field over the shortcut "message-as-code" convention', () => {
    const { host, res } = makeHost();
    const exc = new HttpException(
      { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Ganti password dulu.' },
      HttpStatus.FORBIDDEN,
    );

    filter.catch(exc, host);

    expect(res.statusCode).toBe(HttpStatus.FORBIDDEN);
    const body = res.payload as { code: string; message: string };
    expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(body.message).toBe('Ganti password dulu.');
  });

  it('forwards domain-specific extras like `cutoffDate` verbatim', () => {
    const { host, res } = makeHost();
    const exc = new ConflictException({
      code: 'PAYROLL_LOCKED',
      message: 'PAYROLL_LOCKED',
      cutoffDate: '2026-06-30',
    });

    filter.catch(exc, host);

    const body = res.payload as {
      code: string;
      cutoffDate: string;
      statusCode: number;
    };
    expect(body.code).toBe('PAYROLL_LOCKED');
    expect(body.cutoffDate).toBe('2026-06-30');
    expect(body.statusCode).toBe(HttpStatus.CONFLICT);
  });

  it('does NOT let extras override reserved keys like `statusCode` or `path`', () => {
    const { host, res } = makeHost('/api/v1/canonical');
    const exc = new HttpException(
      {
        code: 'BAD_THING',
        message: 'nope',
        statusCode: 999,
        path: '/attacker/spoof',
        cutoffDate: '2026-01-01',
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exc, host);

    const body = res.payload as {
      statusCode: number;
      path: string;
      cutoffDate: string;
    };
    expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.path).toBe('/api/v1/canonical');
    expect(body.cutoffDate).toBe('2026-01-01');
  });

  it('shortcuts "message-as-code" when caller supplies only a plain string message', () => {
    const { host, res } = makeHost();
    const exc = new HttpException({ message: 'INVALID_CREDENTIALS' }, HttpStatus.UNAUTHORIZED);

    filter.catch(exc, host);

    const body = res.payload as { code: string; message: string };
    expect(body.code).toBe('INVALID_CREDENTIALS');
    expect(body.message).toBe('INVALID_CREDENTIALS');
  });

  it('emits VALIDATION_FAILED with an array message from class-validator', () => {
    const { host, res } = makeHost();
    const exc = new HttpException(
      { message: ['email must be an email', 'password too short'] },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exc, host);

    const body = res.payload as { code: string; details: unknown };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual(['email must be an email', 'password too short']);
  });
});
