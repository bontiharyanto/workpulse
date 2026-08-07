import { Module } from '@nestjs/common';

import { GeocodeService } from './geocode.service';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

/**
 * Self-hosted map tiles + geocoding proxy. See ADR-0042.
 *
 * The module is intentionally self-contained: it depends only on
 * `ConfigService` (env vars) and the S3 credentials already threaded
 * through the rest of the app. No DB access — tiles + glyphs +
 * sprites are static reference data.
 */
@Module({
  controllers: [MapsController],
  providers: [MapsService, GeocodeService],
  exports: [MapsService, GeocodeService],
})
export class MapsModule {}
