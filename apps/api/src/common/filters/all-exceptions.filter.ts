import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';

/**
 * Fallback filter — catches any non-HttpException and returns a sanitized 500.
 * Never leaks raw error messages / stack traces to clients. Forwards the raw
 * exception to Sentry so we can page on real 500-class incidents; HTTP
 * exceptions are re-thrown so `HttpExceptionFilter` handles them (and skips
 * Sentry — see `instrument.ts` `beforeSend`).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    Sentry.captureException(exception);

    this.logger.error({
      message: 'Unhandled exception',
      path: request.url,
      error:
        exception instanceof Error
          ? { name: exception.name, message: exception.message, stack: exception.stack }
          : exception,
    });

    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again later.',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
