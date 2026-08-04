import type { RopaActivityVersion } from '@prisma/client';

/**
 * Fase 31d — Shared shape between the ROPA renderers and the export
 * service. Kept separate so the FE-facing DTO can grow without breaking
 * the renderer contracts.
 */

export interface RopaExportHeader {
  companyName: string;
  generatedAt: Date;
  generatedByEmail: string;
}

/** Denorm row: PUBLISHED version + activity slug used as a stable ID. */
export type RopaExportRow = RopaActivityVersion & {
  slug: string;
};
