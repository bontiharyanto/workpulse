/**
 * Curated Jakarta-CBD geofence templates.
 *
 * These are OSM-derived coordinates for the centroid of each
 * landmark; the radius is a conservative default that comfortably
 * covers the actual footprint of the building or complex without
 * spilling too far onto adjacent streets. HR is expected to fine-
 * tune both centre and radius after picking a template.
 *
 * If you add a template, keep the schema:
 * - `id`: kebab-case slug, unique.
 * - `label`: shown in the picker button.
 * - `description`: 1-sentence context so admins pick the right one.
 * - `latitude` / `longitude`: 6 decimal places (≈10 cm precision).
 * - `radiusMeters`: sane default; must fit Prisma model's [5, 5000].
 *
 * We deliberately DO NOT surface every tower separately — the goal
 * is coarse pre-fill that saves 5 minutes of copy-paste, not an
 * exhaustive directory.
 */
export interface GeofenceTemplate {
  id: string;
  label: string;
  description: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export const GEOFENCE_TEMPLATES_JAKARTA_CBD: readonly GeofenceTemplate[] = [
  {
    id: 'sudirman-central',
    label: 'Sudirman (Kawasan CBD)',
    description: 'Sepanjang Jl. Jenderal Sudirman, dari Dukuh Atas ke Semanggi.',
    latitude: -6.2247,
    longitude: 106.8095,
    radiusMeters: 500,
  },
  {
    id: 'scbd',
    label: 'SCBD Senayan',
    description: 'Sudirman Central Business District — lot 1 sampai lot 28.',
    latitude: -6.2258,
    longitude: 106.8129,
    radiusMeters: 400,
  },
  {
    id: 'kuningan',
    label: 'Kuningan (Mega Kuningan)',
    description: 'Mega Kuningan + Rasuna Said, mencakup Ambassador, Menara Kuningan.',
    latitude: -6.2287,
    longitude: 106.8319,
    radiusMeters: 500,
  },
  {
    id: 'thamrin',
    label: 'Thamrin (Bundaran HI)',
    description: 'Bundaran HI ke Sarinah — Thamrin lantai kantor.',
    latitude: -6.1936,
    longitude: 106.823,
    radiusMeters: 400,
  },
  {
    id: 'menteng',
    label: 'Menteng',
    description: 'Kawasan kantor Menteng — Cikini + Diponegoro + Tugu Tani.',
    latitude: -6.1965,
    longitude: 106.8353,
    radiusMeters: 500,
  },
];
