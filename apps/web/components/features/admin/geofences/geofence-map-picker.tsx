'use client';

/**
 * Interactive map picker for `Geofence` create/edit.
 *
 * # Track 3 rewrite (ADR-0042)
 *
 * Replaced the previous Leaflet + OpenStreetMap raster + Nominatim
 * direct-call implementation with **MapLibre GL JS** talking to the
 * app's own **`/maps/*`** endpoints. The public props of this
 * component are unchanged so `geofence-form.tsx` needed no update.
 *
 * The design rationale (why self-host, why MapLibre, why proxy the
 * geocoder) lives in `docs/ADR/ADR-0042-self-hosted-map-tiles.md`.
 *
 * # Client-only rendering
 *
 * MapLibre touches `window` at import time. The parent form wraps
 * this file in `next/dynamic({ ssr: false })`, so we can assume a
 * browser environment here — `useEffect` guards are unnecessary.
 *
 * # Security note
 *
 * The picker only mutates the parent form's state via `onChange`.
 * The server still validates the coordinates + radius via Zod +
 * NestJS class-validator and enforces the geofence check itself
 * server-side (see `attendance.service.ts`). The map is a UX
 * enhancement — it is NEVER trusted for authorization.
 */

import 'maplibre-gl/dist/maplibre-gl.css';

import { circle } from '@turf/circle';
import { Loader2, LocateFixed, Search } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import type {
  ErrorEvent,
  LngLat,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
} from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, mapsApi, type GeocodeSearchResult } from '@/lib/api-client';

const DEFAULT_ZOOM = 15;
const GEOFENCE_SOURCE_ID = 'geofence-radius';
const GEOFENCE_LAYER_ID = 'geofence-radius-fill';
const GEOFENCE_OUTLINE_LAYER_ID = 'geofence-radius-outline';

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const valueRef = useRef<Value>(value);
  const onChangeRef = useRef(onChange);
  // Keep both callbacks + latest value in refs so the map init
  // effect runs exactly once. Otherwise React would tear the
  // MapLibre instance down and up every render.
  valueRef.current = value;
  onChangeRef.current = onChange;

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<GeocodeSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  const applyValue = useCallback((next: Value) => {
    onChangeRef.current(next);
  }, []);

  const buildGeofenceGeoJSON = useCallback((v: Value) => {
    // `@turf/circle` needs radius in km. 64 segments is a good
    // balance between visual smoothness and CPU at pan / zoom.
    return circle([v.longitude, v.latitude], v.radiusMeters / 1000, {
      steps: 64,
      units: 'kilometers',
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const initial = valueRef.current;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapsApi.styleUrl(),
      center: [initial.longitude, initial.latitude],
      zoom: DEFAULT_ZOOM,
      // Attribution is baked into the style JSON's `attribution`
      // field; the built-in control is fine on top of that.
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('error', (evt: ErrorEvent) => {
      // Surface upstream issues in the UI rather than swallowing
      // silently — the most common cause is `MAPS_ENABLED=false`
      // in a fresh deploy that hasn't had the bootstrap runbook
      // run yet.
      const msg =
        evt.error && 'message' in evt.error
          ? (evt.error as Error).message
          : 'Peta gagal dimuat.';
      // Ignore the noisy per-tile "AbortError" that fires when the
      // user pans quickly — only surface the top-level style
      // failure.
      if (msg.includes('AbortError')) return;
      setMapLoadError(msg);
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      'top-right',
    );

    map.on('load', () => {
      // Add the geofence circle as a proper GeoJSON source so it
      // reprojects correctly at any zoom (as opposed to a
      // pixel-radius overlay that would drift at the equator vs.
      // the poles).
      map.addSource(GEOFENCE_SOURCE_ID, {
        type: 'geojson',
        data: buildGeofenceGeoJSON(initial),
      });
      map.addLayer({
        id: GEOFENCE_LAYER_ID,
        type: 'fill',
        source: GEOFENCE_SOURCE_ID,
        paint: {
          'fill-color': '#0ea5e9',
          'fill-opacity': 0.15,
        },
      });
      map.addLayer({
        id: GEOFENCE_OUTLINE_LAYER_ID,
        type: 'line',
        source: GEOFENCE_SOURCE_ID,
        paint: {
          'line-color': '#0284c7',
          'line-width': 2,
        },
      });
    });

    // Draggable marker at the current centre. Kept as a Marker
    // (not a symbol layer) so it can be picked up with a mouse
    // drag without wrangling MapLibre's own drag-handling.
    const marker = new maplibregl.Marker({ draggable: true, color: '#0284c7' })
      .setLngLat([initial.longitude, initial.latitude])
      .addTo(map);
    markerRef.current = marker;

    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      applyValue({
        ...valueRef.current,
        latitude: Number(ll.lat.toFixed(7)),
        longitude: Number(ll.lng.toFixed(7)),
      });
    });

    // Click anywhere on the map = move the pin there.
    map.on('click', (evt: MapMouseEvent) => {
      const ll: LngLat = evt.lngLat;
      applyValue({
        ...valueRef.current,
        latitude: Number(ll.lat.toFixed(7)),
        longitude: Number(ll.lng.toFixed(7)),
      });
    });

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Deliberately empty deps — init once. `applyValue` + the
    // GeoJSON helper are stable via `useCallback`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker + geofence circle in sync when the parent
  // updates `value` (from search, "use my location", radius
  // input, etc.). Cheap: setLngLat + setData don't rerender the
  // whole map.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([value.longitude, value.latitude]);
    if (map.isStyleLoaded()) {
      const src = map.getSource(GEOFENCE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(buildGeofenceGeoJSON(value));
    }
  }, [value, buildGeofenceGeoJSON]);

  // Re-centre the map when the parent-supplied centre changes by
  // more than a nudge (avoids jitter loops when the user drags
  // the marker themselves).
  const lastCenteredRef = useRef<[number, number]>([value.longitude, value.latitude]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const [lastLng, lastLat] = lastCenteredRef.current;
    if (
      Math.abs(lastLng - value.longitude) > 1e-6 ||
      Math.abs(lastLat - value.latitude) > 1e-6
    ) {
      lastCenteredRef.current = [value.longitude, value.latitude];
      map.easeTo({ center: [value.longitude, value.latitude], duration: 400 });
    }
  }, [value.longitude, value.latitude]);

  const handleUseMyLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateError('Browser tidak mendukung geolokasi.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyValue({
          ...valueRef.current,
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
  }, [applyValue]);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    // Must NOT use a nested <form> — parent GeofenceForm wraps
    // this component in a <form>; nested forms are invalid HTML.
    if (q.length < 3) {
      setSearchError('Ketik minimal 3 karakter untuk mencari alamat.');
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    try {
      const { results } = await mapsApi.geocode({ query: q, limit: 5, countryCode: 'id' });
      setSearchResults(results);
      if (results.length === 0) setSearchError('Tidak ada hasil untuk kueri ini.');
    } catch (err) {
      if (err instanceof ApiError) {
        setSearchError(
          err.code === 'GEOCODE_RATE_LIMITED'
            ? 'Terlalu banyak pencarian. Tunggu sebentar lalu coba lagi.'
            : err.code === 'MAPS_DISABLED'
              ? 'Layanan pencarian belum aktif. Hubungi admin.'
              : err.message,
        );
      } else {
        setSearchError(err instanceof Error ? err.message : 'Gagal mencari alamat.');
      }
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  const handleSearchPick = useCallback(
    (r: GeocodeSearchResult) => {
      applyValue({
        ...valueRef.current,
        latitude: Number(r.latitude.toFixed(7)),
        longitude: Number(r.longitude.toFixed(7)),
      });
      setSearchResults([]);
      setSearchQuery(r.displayName);
    },
    [applyValue],
  );

  const helperRows = useMemo(
    () => [
      { label: 'Lat', value: value.latitude.toFixed(6) },
      { label: 'Lng', value: value.longitude.toFixed(6) },
      { label: 'Radius', value: `${value.radiusMeters} m` },
    ],
    [value.latitude, value.longitude, value.radiusMeters],
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
                <li key={`${r.latitude}-${r.longitude}-${r.displayName}`}>
                  <button
                    type="button"
                    onClick={() => handleSearchPick(r)}
                    className="hover:bg-accent w-full px-3 py-2 text-left"
                  >
                    <span className="line-clamp-1 font-medium">
                      {r.displayName.split(',').slice(0, 2).join(', ')}
                    </span>
                    <span className="text-muted-foreground line-clamp-1 text-xs">
                      {r.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {locateError ? <p className="text-destructive text-xs">{locateError}</p> : null}
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-md border" style={{ height: `${heightPx}px` }}>
        <div ref={containerRef} className="h-full w-full" />
        {mapLoadError ? (
          <div className="bg-muted/70 absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center text-sm">
            <p className="text-destructive font-medium">Peta belum tersedia</p>
            <p className="text-muted-foreground text-xs">
              {mapLoadError}. Hubungi admin — lihat runbook{' '}
              <code className="rounded bg-black/10 px-1">docs/OPS/MAP-BOOTSTRAP.md</code>.
            </p>
          </div>
        ) : null}
      </div>

      <div className="text-muted-foreground grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
        {helperRows.map((r) => (
          <div key={r.label}>
            <span className="text-foreground font-medium">{r.label}:</span>{' '}
            <span className="tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
