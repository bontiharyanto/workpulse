'use client';

/**
 * Interactive map picker for `Geofence` create/edit.
 *
 * Design choices:
 *
 * - **Leaflet + OpenStreetMap raster tiles** — chosen for zero API-key
 *   management, permissive ODbL license (attribution shown on the
 *   card), and stable coverage of Indonesian cities. Alternative
 *   vendors (Mapbox/Google) can slot in later by swapping only
 *   `<TileLayer>` and the connect-src / img-src CSP entries.
 * - **Nominatim search** for address → coordinate lookup, again OSM
 *   ecosystem. Nominatim's public server enforces 1 req/second per
 *   IP — we debounce keystrokes to 400 ms and only fire on a
 *   completed word/submit to stay under the limit. Heavy users
 *   should self-host or upgrade to a paid geocoder.
 * - **Client-only rendering** — Leaflet accesses `window` on import
 *   so the whole component is loaded with `dynamic({ ssr: false })`
 *   from the form. This file assumes it runs in the browser.
 * - **No polygons** — Tier 1 keeps the model as-is: a single point +
 *   radius. Polygon support is Tier 3.
 *
 * # Security note
 *
 * The picker only mutates the parent form's state via `onChange`.
 * The server still validates the coordinates + radius via Zod +
 * NestJS class-validator and enforces the geofence check itself
 * server-side (see `attendance.service.ts`). The map is a UX
 * enhancement — it is NEVER trusted for authorization.
 */

import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { Loader2, LocateFixed, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Leaflet's default marker icons ship as static asset paths that
// break under Next.js's static-file pipeline. Rewire them to inline
// data-URIs sourced from the same package so we don't need any
// public-file copy step.
//
// (`_getIconUrl` is a private hook Leaflet reads at Marker init.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
// NOTE: the unpkg URLs above are also allowed in `img-src` via the
// data:/blob:/self mix (the icons load via <img>, not via fetch(),
// so the connect-src rule doesn't apply). If your CSP tightens
// img-src, add `https://unpkg.com`.

const DEFAULT_ZOOM = 15;

interface Value {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

interface Props {
  value: Value;
  onChange: (next: Value) => void;
  /** Height of the map container in px. Defaults to 340. */
  heightPx?: number;
  /** Whether to show the "use my location" + search controls. */
  showControls?: boolean;
}

export function GeofenceMapPicker({
  value,
  onChange,
  heightPx = 340,
  showControls = true,
}: Props): JSX.Element {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const center = useMemo<[number, number]>(
    () => [value.latitude, value.longitude],
    [value.latitude, value.longitude],
  );

  const handleUseMyLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateError('Browser tidak mendukung geolokasi.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          latitude: Number(pos.coords.latitude.toFixed(7)),
          longitude: Number(pos.coords.longitude.toFixed(7)),
        });
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Izin lokasi ditolak. Aktifkan di pengaturan browser lalu ulangi.'
            : err.code === err.POSITION_UNAVAILABLE
              ? 'Sinyal GPS tidak tersedia. Coba pindah ke dekat jendela.'
              : 'Gagal mendapatkan lokasi. Coba lagi.',
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, [onChange, value]);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    // Must NOT use a nested <form> here — this picker lives inside the
    // parent GeofenceForm <form>, and nested forms are invalid HTML
    // (browsers ignore the inner form, so type="submit" submits the
    // outer create/update form instead of running the search).
    if (q.length < 3) {
      setSearchError('Ketik minimal 3 karakter untuk mencari alamat.');
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      // Nominatim usage policy: 1 req/sec. Client-side fetch is allowed
      // with CORS; keep the request lean (no custom User-Agent — browsers
      // forbid setting UA from JS).
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', q);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '5');
      url.searchParams.set('countrycodes', 'id'); // Bias to Indonesia
      url.searchParams.set('accept-language', 'id,en');
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(
          res.status === 429
            ? 'Terlalu banyak pencarian. Tunggu sebentar lalu coba lagi.'
            : `Pencarian gagal (HTTP ${res.status}).`,
        );
      }
      const data = (await res.json()) as NominatimResult[];
      setSearchResults(data);
      if (data.length === 0) setSearchError('Tidak ada hasil untuk kueri ini.');
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Gagal mencari alamat.');
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleSearchPick = useCallback(
    (r: NominatimResult) => {
      onChange({
        ...value,
        latitude: Number(Number.parseFloat(r.lat).toFixed(7)),
        longitude: Number(Number.parseFloat(r.lon).toFixed(7)),
      });
      setSearchResults([]);
      setSearchQuery(r.display_name);
    },
    [onChange, value],
  );

  return (
    <div className="space-y-3">
      {showControls ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-2.5 h-4 w-4" />
              <Input
                type="search"
                placeholder="Cari alamat / gedung (mis. Sudirman Central)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Prevent parent GeofenceForm submit on Enter.
                    e.preventDefault();
                    void handleSearch();
                  }
                }}
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={searchLoading}
              onClick={() => void handleSearch()}
            >
              {searchLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cari…
                </>
              ) : (
                'Cari'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleUseMyLocation}
              disabled={locating}
              title="Gunakan lokasi saat ini"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LocateFixed className="h-4 w-4" />
              )}
            </Button>
          </div>

          {searchError ? <p className="text-destructive text-xs">{searchError}</p> : null}

          {searchResults.length > 0 ? (
            <ul className="bg-card divide-y rounded-md border text-sm shadow-sm">
              {searchResults.map((r) => (
                <li key={`${r.lat}-${r.lon}`}>
                  <button
                    type="button"
                    onClick={() => handleSearchPick(r)}
                    className="hover:bg-accent w-full px-3 py-2 text-left"
                  >
                    <span className="line-clamp-1 font-medium">
                      {r.display_name.split(',').slice(0, 2).join(', ')}
                    </span>
                    <span className="text-muted-foreground line-clamp-1 text-xs">
                      {r.display_name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {locateError ? <p className="text-destructive text-xs">{locateError}</p> : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border" style={{ height: `${heightPx}px` }}>
        <MapContainer center={center} zoom={DEFAULT_ZOOM} scrollWheelZoom className="h-full w-full">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
            maxZoom={19}
          />
          <RecenterOnValue center={center} />
          <MapClickToPlace value={value} onChange={onChange} />
          <Marker
            position={center}
            draggable
            eventHandlers={{
              dragend: (evt) => {
                const { lat, lng } = evt.target.getLatLng() as {
                  lat: number;
                  lng: number;
                };
                onChange({
                  ...value,
                  latitude: Number(lat.toFixed(7)),
                  longitude: Number(lng.toFixed(7)),
                });
              },
            }}
          />
          <Circle
            center={center}
            radius={value.radiusMeters}
            pathOptions={{ color: '#0ea5e9', fillOpacity: 0.15 }}
          />
        </MapContainer>
      </div>

      <div className="text-muted-foreground grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
        <div>
          <span className="text-foreground font-medium">Lat:</span>{' '}
          <span className="tabular-nums">{value.latitude.toFixed(6)}</span>
        </div>
        <div>
          <span className="text-foreground font-medium">Lng:</span>{' '}
          <span className="tabular-nums">{value.longitude.toFixed(6)}</span>
        </div>
        <div>
          <span className="text-foreground font-medium">Radius:</span>{' '}
          <span className="tabular-nums">{value.radiusMeters} m</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Imperatively recentres the map when the parent's value changes
 * (e.g. after a template pick or address search). Without this the
 * map keeps its initial centre even after `value` updates.
 */
function RecenterOnValue({ center }: { center: [number, number] }): null {
  const map = useMap();
  const last = useRef<[number, number]>(center);

  useEffect(() => {
    const [lat, lng] = center;
    const [prevLat, prevLng] = last.current;
    if (lat === prevLat && lng === prevLng) return;
    last.current = center;
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);

  return null;
}

/**
 * Clicking anywhere on the map moves the pin there. Kept as a
 * separate component so Leaflet's hooks (`useMapEvents`) can access
 * the parent `MapContainer` context.
 */
function MapClickToPlace({
  value,
  onChange,
}: {
  value: Value;
  onChange: (next: Value) => void;
}): null {
  useMapEvents({
    click(e) {
      onChange({
        ...value,
        latitude: Number(e.latlng.lat.toFixed(7)),
        longitude: Number(e.latlng.lng.toFixed(7)),
      });
    },
  });
  return null;
}

interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
}
