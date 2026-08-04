// IMPORTANT: keep this at the very top so Sentry's OpenTelemetry
// instrumentation can wrap Node internals BEFORE any other module
// (http, express, prisma, …) is required. Moving this line breaks
// automatic breadcrumbs & tracing.
import './instrument';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Preserve the raw request body on `req.rawBody` so signature-check
    // paths (Fase 32e webhook E2E receiver; potential future inbound
    // vendor callbacks) can HMAC-verify against the exact bytes.
    // Nest's default JSON parser still runs — this is additive.
    rawBody: true,
  });

  // Swap Nest's default `Logger` for pino. All `Logger` instances constructed
  // via `new Logger('foo')` will now emit structured JSON with request context.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const port = config.get<number>('API_PORT') ?? 4000;
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const hstsPreload = config.get<string>('HSTS_PRELOAD') === 'true';
  const cspExtras = (config.get<string>('API_CSP_EXTRA_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Required for correct req.ip behind reverse proxies / load balancers.
  app.set('trust proxy', 1);

  /*
   * Tightened Helmet policy (Fase 30c).
   *
   * The API primarily serves JSON and — in non-prod — the Swagger UI.
   * Swagger self-hosts every asset from `/api/docs/*`, so a strict
   * `default-src 'self'` is sufficient. We do NOT need `unsafe-inline`
   * for scripts anywhere (Swagger UI's bundle is external). Style is
   * kept flexible because Swagger inlines a small style block on boot.
   *
   * The `contentSecurityPolicy` block below is a merge with Helmet's
   * safe defaults, so any directive we omit retains Helmet's baked-in
   * value.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'font-src': ["'self'", 'https:', 'data:'],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'img-src': ["'self'", 'data:', ...cspExtras],
          'object-src': ["'none'"],
          // Swagger UI ships its own JS; both the vendor bundle and a
          // small initialiser live under `/api/docs`. No inline scripts.
          'script-src': ["'self'", ...cspExtras],
          'style-src': ["'self'", "'unsafe-inline'"],
          'connect-src': ["'self'", ...cspExtras],
          // No upgrade-insecure-requests in dev — HTTP requests to the
          // API would otherwise be rejected by the browser when the FE
          // proxies through https-elsewhere.
          ...(isProduction ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      // `crossOriginEmbedderPolicy: false` keeps Swagger UI usable
      // (its fonts + workers do not send `Cross-Origin-Resource-Policy`).
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProduction
        ? {
            maxAge: hstsPreload ? 63_072_000 : 15_552_000,
            includeSubDomains: true,
            preload: hstsPreload,
          }
        : false,
      xFrameOptions: { action: 'deny' },
      xContentTypeOptions: true,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());

  if (!isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('Workpulse API')
      .setDescription('Enterprise Attendance System — REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(port);
  app.get(Logger).log(`workpulse-api listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

void bootstrap();
