# ADR-0040 — Geofence map picker (OSM) & Tier-2 attendance signals

**Status:** Accepted — 2026-08-06
**Revised:** 2026-08-07 (+ Section 5 fuzzy radius)
**Deciders:** Platform, HR Product
**Supersedes:** —
**Superseded by:** —

## Context

The geofencing MVP shipped with a solid security core (server-side
Haversine, tenant-scoped, audit-logged) but an operational surface
that was, frankly, painful:

- **HR admin UI** — no map. Admins had to open Google Maps in a
  separate tab, right-click the target building, copy the lat/lng
  into three number inputs, and eyeball a radius. No visual radius
  preview, no address search, no "use my location" button.
- **Signal fidelity** — the DTO captured `accuracyMeters` but it
  was only stored, never used to gate the clock-in. A device
  claiming `accuracyMeters: 5000` still passed as long as its
  (garbage) coordinate landed in the circle.
- **Indoor fallback** — none. Buildings with weak indoor GPS
  (SCBD basements, Jakarta CBD stacked towers) rely on Wi-Fi
  for indoor positioning, and HR asked for a way to say
  "if on office Wi-Fi, accept".

We evaluated several map providers and gave HR a decision:

| Option                             | Cost                    | API key | Verdict                                                   |
| ---------------------------------- | ----------------------- | ------- | --------------------------------------------------------- |
| Google Maps                        | Free credit → paid tier | Yes     | Rejected: vendor lock-in, credit-card requirement in prod |
| Mapbox                             | 50k free loads/mo       | Yes     | Deferred: overkill for an admin-only page                 |
| MapLibre + OpenFreeMap             | Free                    | No      | Deferred: WebGL, needs CSP relaxation for workers         |
| **Leaflet + OpenStreetMap raster** | **Free**                | **No**  | **Accepted**                                              |

## Decision

### 1. Interactive map picker (Tier 1)

Replace the three-number-input geofence form with an interactive
Leaflet map (`react-leaflet` v4). The map:

- Renders OSM raster tiles from `https://{a,b,c}.tile.openstreetmap.org`.
- Draggable Marker for the centre; click-anywhere to move the pin.
- Live Circle overlay showing the current radius.
- Optional address search via **Nominatim** (`https://nominatim.openstreetmap.org/search`)
  biased to Indonesia and rate-limited by debounce.
- "Use my location" button (browser Geolocation API).
- Attribution `© OpenStreetMap contributors` shown in-card as
  required by the ODbL license.

CSP was updated to add `https://*.tile.openstreetmap.org` to
`img-src` and `https://nominatim.openstreetmap.org` to
`connect-src`. See `apps/web/middleware.ts`.

### 2. Jakarta-CBD templates (Tier 1)

Curated preset buttons for common Jakarta CBD locations (Sudirman,
SCBD, Kuningan, Thamrin, Menteng). Clicking a template pre-fills
lat/lng/radius (and name, on CREATE only). Data lives at
`apps/web/components/features/admin/geofences/geofence-templates.ts`.

### 3. GPS accuracy budget (Tier 2)

Add `Geofence.maxAccuracyMeters: Int?` to Prisma. When set, the
server rejects clock-in/out with `403 WEAK_GPS_ACCURACY` if the
client-reported `accuracyMeters > threshold`. `null` = no check
(legacy behaviour preserved).

Sane range enforced at the DTO layer: 10–500 m. Below 10 is
aspirational for consumer devices; above 500 implies the device is
essentially geolocating by IP and should not be trusted.

### 4. Wi-Fi SSID allowlist (Tier 2)

Add `Geofence.allowedSsids: String[]` to Prisma. Add optional
`wifiSsid?: string` to `ClockInDto` / `ClockOutDto`.

When both are set and match, the geofence distance check is
**bypassed**. The check order is:

1. Accuracy budget (if configured).
2. Wi-Fi SSID fallback (if configured & client provides matching SSID).
3. Haversine distance check.

Order 1-before-2 is deliberate: a device with weak accuracy cannot
piggyback on a leaked SSID.

We still compute `distanceMeters` in every branch so
`AttendanceEvent.distanceMeters` — the denormalised distance from
ADR-0011 — carries a meaningful value for the Geofence Health
dashboard (deferred, see Consequences).

### 5. Fuzzy radius (Tier 2, revision 2026-08-07)

**Problem observed post-launch:** in Jakarta CBD towers, indoor GPS
routinely drifts 30–200 m. The strict `distance <= radius` check
introduced in section 1 rejects legitimate clock-ins from users who
are demonstrably in the office — screenshots showed users lit up on
the map inside the fence yet `distanceMeters` reported 180 m against
a 100 m radius. Widening every geofence to 300+ m to compensate
weakens the whole system for outdoor / rural sites where 50 m radii
work fine.

**Decision:** Extend the strict check to a "fuzzy radius" bounded by
device-reported GPS uncertainty, with an admin-set cap:

```
effectiveRadius = radiusMeters + min(accuracyMeters, maxLeewayMeters)
```

Add `Geofence.maxLeewayMeters: Int NOT NULL DEFAULT 50` (range
0–500). Existing rows migrate to `50` (industry-standard indoor
tolerance in Jakarta CBD). Set `0` to restore the strict
pre-2026-08-07 behaviour on a per-geofence basis.

**Why bounded by `accuracyMeters` and not a fixed slack?** A device
honestly reporting `accuracyMeters ≈ 5 m` should still face the
strict check — someone with a clean GPS fix outside the radius is
outside. Only devices experiencing real uncertainty get the slack.
This is the industry-standard approach used by Deputy, Homebase,
and When I Work.

**Why the `maxLeewayMeters` cap?** Without it, a spoofed
`accuracyMeters: 5000` would let anyone walk in from 5 km. The cap
puts a hard ceiling on the exploit surface. Combined with
`maxAccuracyMeters` (section 3) which rejects the request outright
at high uncertainty, the two form a defence-in-depth pair:

- `maxAccuracyMeters` — "we don't trust your fix at all"
- `maxLeewayMeters` — "we trust your fix but with a ceiling on how
  much slack it can buy"

**Check ordering (updated):**

1. Accuracy budget (`WEAK_GPS_ACCURACY` if exceeded — early reject).
2. Wi-Fi SSID fallback (if configured & matching — bypass distance).
3. Fuzzy distance check (`OUTSIDE_GEOFENCE` if `distance > radius + leeway`).

**Persisted state:** we deliberately do NOT add a `via` column to
`AttendanceEvent`. HR can reconstruct whether leeway was used by
comparing the already-stored `AttendanceEvent.distanceMeters` to the
geofence's `radiusMeters`. Adding a column would double schema churn
for a value derivable from data already at hand.

**Rollback path:** set `Geofence.maxLeewayMeters = 0` on any tenant
that dislikes the new behaviour. No code deploy needed.

## Alternatives considered

- **Polygon geofences (PostGIS)** — deferred to Tier 3. Circle
  fences cover 95% of Indonesian office layouts and PostGIS adds
  operational complexity (spatial index, migration order).
- **Google Maps** — rejected on vendor-lock + credit-card + cost.
  Nothing stops a customer from swapping the TileLayer and CSP
  origins if they have a key.
- **Server-driven address search proxy** — considered to avoid CSP
  connect-src widening. Rejected for MVP because Nominatim's public
  policy allows client-side use with attribution, and a proxy would
  require rate-limiting we don't have infra for. Revisit if Nominatim
  usage grows.

## Consequences

**Positive**

- HR can pin a geofence in ~10 seconds instead of ~5 minutes.
- Zero secret to rotate — no API key management, ever.
- Server posture strengthened: `WEAK_GPS_ACCURACY` closes a real
  attack vector (spoof a fine coordinate with garbage accuracy).
- Indoor buildings now have a legitimate escape hatch.

**Negative**

- CSP now trusts two external origins for the admin page. Both
  are OSM-run, both are widely used, but they are external.
- Leaflet ships ~40 KB gzip and CSS assets. The picker is
  dynamic-imported (`ssr: false`) so it only loads when the form
  opens.
- Nominatim public server is rate-limited (1 req/sec). Heavy
  admin-side search may hit `429`. Debounced in the picker.

**Deferred**

- Multi-fence per shift (many-to-many `ShiftGeofence`). Requires
  Prisma migration + attendance service refactor + shift admin UI
  changes. Tracked separately.
- Geofence Health dashboard (`p95(distanceMeters)` per fence).
  Uses existing `AttendanceEvent.distanceMeters` — small scope
  but a new page. Deferred to a follow-up PR.
- Kiosk mode, mock-location detection, dwell-time (Tier 3).

## References

- `apps/api/prisma/migrations/20260806084142_add_geofence_accuracy_and_ssid/migration.sql`
- `apps/api/prisma/migrations/20260807070640_add_geofence_max_leeway/migration.sql`
- `apps/web/components/features/admin/geofences/geofence-map-picker.tsx`
- `apps/api/src/attendance/attendance.service.ts` (`assertLocationAllowed`)
- ADR-0011 (denormalised `AttendanceEvent.distanceMeters`)
- OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
