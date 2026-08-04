import type { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { Params } from 'nestjs-pino';
import type { LoggerOptions } from 'pino';

import type { AuthenticatedUser } from '../common/types/authenticated-user';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.token',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.refreshToken',
];

type PinoReq = IncomingMessage & {
  id?: string;
  user?: AuthenticatedUser;
  ip?: string;
};

/**
 * Builds pino config from validated env. Two output modes:
 *   • development: pretty-printed via pino-pretty (readable)
 *   • production: single-line JSON (log aggregator friendly)
 *
 * Every log line automatically carries: `requestId`, `method`, `url`, and —
 * once JwtAuthGuard has populated `req.user` — `userId`, `companyId`, `role`.
 * Sensitive fields (JWT/cookie headers, password fields) are redacted at
 * serialization time.
 */
export function buildLoggerParams(config: ConfigService): Params {
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
  const level = config.get<string>('LOG_LEVEL') ?? (nodeEnv === 'production' ? 'info' : 'debug');
  const pretty = config.get<string>('LOG_PRETTY') === 'true' || nodeEnv === 'development';

  const options: LoggerOptions = {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    base: {
      service: 'workpulse-api',
      env: nodeEnv,
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };

  return {
    pinoHttp: {
      ...options,
      transport: pretty
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              singleLine: true,
              ignore: 'pid,hostname,service,env',
            },
          }
        : undefined,
      genReqId(req: IncomingMessage, res: ServerResponse): string {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header.length > 0 ? header : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps(req: IncomingMessage) {
        const r = req as PinoReq;
        if (!r.user) return {};
        return {
          userId: r.user.id,
          companyId: r.user.companyId,
          role: r.user.role,
        };
      },
      customLogLevel(_req: IncomingMessage, res: ServerResponse, err?: Error) {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage(req: IncomingMessage, res: ServerResponse) {
        return `${req.method ?? 'REQ'} ${req.url ?? '/'} ${res.statusCode}`;
      },
      customErrorMessage(req: IncomingMessage, res: ServerResponse, err: Error) {
        return `${req.method ?? 'REQ'} ${req.url ?? '/'} ${res.statusCode} ${err.message}`;
      },
      // Route errors that pino sees to Sentry as breadcrumbs — the real
      // exception filter also captures, this is defence in depth.
      serializers: {
        err(err: Error) {
          Sentry.addBreadcrumb({
            category: 'http.error',
            message: err.message,
            level: 'error',
          });
          return {
            type: err.name,
            message: err.message,
            stack: err.stack,
          };
        },
      },
    },
  };
}
