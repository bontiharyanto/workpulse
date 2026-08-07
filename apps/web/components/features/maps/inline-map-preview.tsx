'use client';

/**
 * Small inline MapLibre preview — a static map centred on a
 * single coordinate with a marker, no controls. Used on read-only
 * detail pages (e.g. `LocationRequestSupervisorDetail`) to render
 * a spatial context inline instead of linking out to a third-party
 * map.
 *
 * See ADR-0042 §Frontend for the migration off Leaflet + OSM raster
 * tiles. This component is intentionally kept small — it does NOT
 * accept any interactivity props (drag, click, radius). Use
 * `GeofenceMapPicker` when you need editing.
 *
 * # Rendering strategy
 *
 * MapLibre touches `window` on import; callers must wrap this in
 * `next/dynamic({ ssr: false })` to keep it out of server bundles.
 */

import 'maplibre-gl/dist/maplibre-gl.css';

import * as maplibregl from 'maplibre-gl';
import type { ErrorEvent, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState, type JSX } from 'react';

import { mapsApi } from '@/lib/api-client';

interface Props {
  latitude: number;
  longitude: number;
  /**
   * Height in px. Default 220 — Google-Maps-card sized. Anything
   * shorter and the tiles feel cramped; anything taller starts to
   * dominate the detail page.
   */
  heightPx?: number;
  /** Zoom level. 15 = building-scale in most Indonesian cities. */
  zoom?: number;
  /**
   * Optional accessible label announced to screen readers.
   * Defaults to a coordinate-derived string.
   */
  ariaLabel?: string;
}

export function InlineMapPreview({
  latitude,
  longitude,
  heightPx = 220,
  zoom = 15,
  ariaLabel,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapsApi.styleUrl(),
      center: [longitude, latitude],
      zoom,
      interactive: false, // pure preview — no pan / zoom
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('error', (evt: ErrorEvent) => {
      const msg =
        evt.error && 'message' in evt.error
          ? (evt.error as Error).message
          : 'Peta gagal dimuat.';
      if (msg.includes('AbortError')) return;
      setLoadError(msg);
    });

    const marker = new maplibregl.Marker({ color: '#0284c7' })
      .setLngLat([longitude, latitude])
      .addTo(map);

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
    };
    // Re-init on coord / zoom change is cheap and simpler than
    // keeping a stale marker in sync.
  }, [latitude, longitude, zoom]);

  const label =
    ariaLabel ??
    `Peta lokasi pada koordinat ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  return (
    <div
      className="relative overflow-hidden rounded-md border"
      style={{ height: `${heightPx}px` }}
      aria-label={label}
      role="img"
    >
      <div ref={containerRef} className="h-full w-full" />
      {loadError ? (
        <div className="bg-muted/80 absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center text-xs">
          <p className="text-destructive font-medium">Peta tidak tersedia</p>
          <p className="text-muted-foreground">
            Hubungi admin — runbook{' '}
            <code className="rounded bg-black/10 px-1">docs/OPS/MAP-BOOTSTRAP.md</code>.
          </p>
        </div>
      ) : null}
    </div>
  );
}
