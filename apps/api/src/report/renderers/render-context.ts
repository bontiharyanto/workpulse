import type { Writable } from 'node:stream';

/**
 * Common context passed to every renderer. Header info lives on the report
 * (company name, printed-at, filter range) — renderers are otherwise stateless.
 */
export interface ReportHeader {
  companyName: string;
  title: string;
  subtitle: string;
  generatedAt: Date;
  generatedByEmail: string;
  timezone: string;
}

export interface RendererStream {
  /** Node writable target — usually `res` (Express response). */
  target: Writable;
  header: ReportHeader;
}
