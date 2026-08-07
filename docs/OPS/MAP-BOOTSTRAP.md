# Ops Runbook — Self-hosted Map Bootstrap

**Scope:** Seeding the `workpulse-maptiles` bucket so the
`/maps/*` endpoints introduced in ADR-0042 can serve real data.
**Frequency:** Once per fresh deploy, then re-run monthly (or
whenever ops publishes a new archive) to refresh the map.
**Owner:** Ops lead.
**Prerequisites:** MinIO reachable, `mc` (MinIO client) installed,
~2 GB free disk on the runner host.

Skipping this runbook leaves the bucket empty. In that state, the
API accepts requests but returns 404 `MAPS_ARCHIVE_MISSING` for
every tile; the frontend renders a "map unavailable" placeholder
and the geofence picker falls back to lat/lng-only editing.

---

## 1. What you're seeding

Three kinds of files live in the bucket:

| Prefix                     | Contents                                    | Refresh cadence           | Size (Indonesia) |
| -------------------------- | ------------------------------------------- | ------------------------- | ---------------- |
| `<pmtiles key>` (root)     | Vector tiles for the country (one file)     | Monthly (Protomaps daily) | ~450 MB          |
| `glyphs/<fontstack>/*.pbf` | Rasterised font ranges MapLibre pulls at render | On font swap (rare)  | ~50 MB           |
| `sprites/default*.{png,json}` | UI icon spritesheet                      | On UI redesign (rare)     | ~1 MB            |

The API is oblivious to the specific content — as long as an
object at `MAPS_PMTILES_KEY` deserialises as PMTiles, everything
downstream works. So the exact archive you use is a decision
made once and then rarely revisited.

---

## 2. Recommended source: Protomaps daily build

Protomaps publishes daily PMTiles archives per country extract.
They're generated from OpenStreetMap under ODbL — attribution is
already wired into the API's default style JSON.

```bash
# Pick a build date (yesterday's UTC date usually works)
DATE=$(date -u -d "yesterday" +%Y%m%d)

# Download the Indonesia extract into a temp dir
mkdir -p /tmp/workpulse-maps
curl -L --fail \
  -o /tmp/workpulse-maps/indonesia.pmtiles \
  "https://build.protomaps.com/${DATE}-indonesia.pmtiles"

# Sanity check — file should be ~400-500 MB and begin with the
# PMTiles magic number `PMTiles` (7 bytes).
ls -lh /tmp/workpulse-maps/indonesia.pmtiles
head -c 7 /tmp/workpulse-maps/indonesia.pmtiles && echo
```

**Alternatives if Protomaps is unreachable:**

- **Self-generate with `tippecanoe`.** Requires an OSM PBF extract
  (from Geofabrik) and a machine with 16+ GB RAM. Overkill unless
  you have compliance reasons not to trust a third-party build.
- **Buy from Stadia Maps / MapTiler.** Both offer PMTiles for a
  monthly fee. Payload identical, sign an NDA/contract, then use
  the same upload steps below.

---

## 3. Glyphs + sprites (one-time)

MapLibre needs at least one font stack. The default style ships
with `Noto Sans Regular` — grab the PBF ranges from the official
MapLibre demo tiles:

```bash
mkdir -p /tmp/workpulse-maps/glyphs
cd /tmp/workpulse-maps/glyphs

# 256 glyph ranges cover the Basic Multilingual Plane.
FONT_STACK="Noto%20Sans%20Regular"
mkdir -p "Noto Sans Regular"
for start in $(seq 0 256 65280); do
  end=$((start + 255))
  curl -L --fail --silent \
    -o "Noto Sans Regular/${start}-${end}.pbf" \
    "https://demotiles.maplibre.org/font/${FONT_STACK}/${start}-${end}.pbf"
done
```

Sprites can be borrowed from the OSM Bright sprite set — they're
CC-BY licensed and match the default style's iconography:

```bash
mkdir -p /tmp/workpulse-maps/sprites
cd /tmp/workpulse-maps/sprites
for f in default.png default.json default@2x.png default@2x.json; do
  curl -L --fail --silent \
    -o "$f" \
    "https://demotiles.maplibre.org/style/${f}"
done
```

You can substitute a house-branded spritesheet later; the API
serves whatever object is at `sprites/default*` verbatim.

---

## 4. Upload to MinIO

Set up an `mc` alias pointing at your MinIO endpoint. In local
dev this is `http://minio:9000` from inside docker or
`http://localhost:${MINIO_S3_HOST_PORT:-9000}` from the host.

```bash
mc alias set workpulse \
  http://minio:9000 \
  workpulse workpulse-secret

# Bucket already exists (bootstrapped by docker-compose `minio-init`
# service), but running `mc mb --ignore-existing` is safe.
mc mb --ignore-existing workpulse/workpulse-maptiles

# Upload the PMTiles archive — this is the big one, ~450 MB
mc cp /tmp/workpulse-maps/indonesia.pmtiles \
  workpulse/workpulse-maptiles/indonesia.pmtiles

# Upload glyphs (recursive)
mc mirror /tmp/workpulse-maps/glyphs \
  workpulse/workpulse-maptiles/glyphs

# Upload sprites
mc cp /tmp/workpulse-maps/sprites/default.png \
  workpulse/workpulse-maptiles/sprites/default.png
mc cp /tmp/workpulse-maps/sprites/default.json \
  workpulse/workpulse-maptiles/sprites/default.json
mc cp /tmp/workpulse-maps/sprites/default@2x.png \
  workpulse/workpulse-maptiles/sprites/default@2x.png
mc cp /tmp/workpulse-maps/sprites/default@2x.json \
  workpulse/workpulse-maptiles/sprites/default@2x.json
```

**Never** run `mc anonymous set public` on this bucket. The API
reads via IAM credentials the same way it reads attachments; a
public bucket would let any internet visitor download the archive
directly.

---

## 5. Flip the switch

```bash
# In .env / .env.production
MAPS_ENABLED=true
```

Restart the API (or send SIGHUP if your process supervisor
supports config reloads without a full restart — for the current
dockerised deploy, do a rolling restart).

Verify:

```bash
# Tile that always exists — the whole-world z0 tile
curl -sS -o /tmp/tile.mvt -w '%{http_code}\n' \
  https://api.example.com/api/v1/maps/tiles/0/0/0.mvt
# Expected: 200 with a ~50 KB gzip body

# Style JSON round-trip
curl -sS https://api.example.com/api/v1/maps/style.json | \
  jq '.version, .sources.protomaps.tiles[0]'
# Expected: 8, "<PUBLIC_API_URL>/api/v1/maps/tiles/{z}/{x}/{y}.mvt"

# Geocode probe (requires a bearer token)
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.example.com/api/v1/maps/geocode?q=Jakarta"
# Expected: {"results":[{...}]}
```

Then open the geofence editor in the admin UI — you should see a
real map tile render, not the "map unavailable" placeholder card.

---

## 6. Refresh procedure (monthly)

To swap in a fresher archive without downtime:

```bash
# 1. Upload the new archive under a NEW key
NEW_KEY="indonesia.$(date -u +%Y%m%d).pmtiles"
mc cp /tmp/workpulse-maps/new-indonesia.pmtiles \
  workpulse/workpulse-maptiles/${NEW_KEY}

# 2. Verify a first-byte fetch works
mc stat workpulse/workpulse-maptiles/${NEW_KEY}

# 3. Repoint MAPS_PMTILES_KEY in .env.production to the new key
sed -i "s|^MAPS_PMTILES_KEY=.*|MAPS_PMTILES_KEY=${NEW_KEY}|" \
  /opt/workpulse/.env.production

# 4. Rolling restart — old requests finish against the old key
#    (still present in the bucket), new requests use the new key.
./scripts/deploy.sh --rolling

# 5. After confirming metrics for 24h, delete the old archive
mc rm workpulse/workpulse-maptiles/indonesia.<OLD_DATE>.pmtiles
```

---

## 7. Rollback

Symptom: geofence editor renders a broken map after a refresh.
Fix: repoint `MAPS_PMTILES_KEY` back to the previous archive key.

```bash
sed -i "s|^MAPS_PMTILES_KEY=.*|MAPS_PMTILES_KEY=indonesia.<KNOWN_GOOD_DATE>.pmtiles|" \
  /opt/workpulse/.env.production
./scripts/deploy.sh --rolling
```

If the previous archive has already been deleted from the bucket,
re-download from Protomaps (they retain 30 days of daily builds)
or restore from your MinIO snapshot.

---

## 8. Troubleshooting

| Symptom                                            | Likely cause                                                    | Fix                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Every tile 404 `MAPS_ARCHIVE_MISSING`              | Bucket empty or `MAPS_PMTILES_KEY` wrong                        | Re-run §4                                                                               |
| All /maps/* 503 `MAPS_DISABLED`                    | `MAPS_ENABLED=false`                                            | Flip to `true` + restart                                                                |
| Random 503 `MAPS_UPSTREAM_UNAVAILABLE`             | MinIO down / network flake                                      | Check MinIO health, `mc admin info workpulse`                                            |
| Tile 200 but MapLibre renders blank                | PMTiles archive corrupt (partial upload?)                       | Re-download from Protomaps, re-upload                                                    |
| Geocode 429 `GEOCODE_RATE_LIMITED` under load      | Upstream Nominatim throttling — many tenants share the 1 QPS    | Raise `MAPS_GEOCODE_QPS` only if switching to a self-hosted geocoder                     |
| Geocode 502 `GEOCODE_UPSTREAM_ERROR`               | Nominatim response format changed                                | Check `status.openstreetmap.org` — usually transient                                     |
| Sprite/glyph 404                                   | Missing font stack / sprite variant                              | Confirm exact object exists via `mc ls workpulse/workpulse-maptiles/glyphs/`             |
