import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
  [extra: string]: unknown;
}

// Reserved response keys that the filter itself produces. Anything else on
// the exception payload (e.g. `cutoffDate` on a `PAYROLL_LOCKED` conflict,
// `retryAfter`, `field`, `attemptsRemaining`, …) is forwarded verbatim so
// callers keep their domain-specific error metadata.
const RESERVED_KEYS = new Set([
  'statusCode',
  'code',
  'message',
  'details',
  'error',
  'path',
  'timestamp',
]);

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const raw = exception.getResponse();

    let code = exception.name.replace(/Exception$/, '').toUpperCase();
    let message = exception.message;
    let details: unknown = undefined;
    const extras: Record<string, unknown> = {};

    if (typeof raw === 'object' && raw !== null) {
      const r = raw as Record<string, unknown>;
      if (typeof r.message === 'string') {
        code = r.message;
        message = r.message;
      } else if (Array.isArray(r.message)) {
        code = 'VALIDATION_FAILED';
        message = 'Payload failed validation';
        details = r.message;
      }
      // Callers can throw `new HttpException({ code, message, ... })` to
      // separate the stable machine-readable code from the human-readable
      // message. When both are present, `code` wins over the shortcut
      // "message-as-code" convention above.
      if (typeof r.code === 'string' && r.code.length > 0) {
        code = r.code;
      }
      if (typeof r.message === 'string' && typeof r.code === 'string') {
        message = r.message;
      }
      for (const key of Object.keys(r)) {
        if (!RESERVED_KEYS.has(key)) {
          extras[key] = r[key];
        }
      }
    }

    const payload: ErrorPayload = {
      statusCode: status,
      code,
      message,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...extras,
    };

    if (status >= 500) {
      this.logger.error({ ...payload, stack: exception.stack });
    } else {
      this.logger.warn(payload);
    }

    response.status(status).json(payload);
  }
}
