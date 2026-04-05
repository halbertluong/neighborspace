/**
 * Bulk occupancy enrichment from free public datasets — no API keys required.
 *
 * Sources:
 *   1. Portland Business Licenses (PortlandMaps ArcGIS REST API)
 *      City-authoritative active license registry, updated daily.
 *      If a space has an active business license nearby → occupied.
 *
 *   2. Overture Maps places (GeoJSON file downloaded by workflow)
 *      60M+ global places from Microsoft, Meta, Amazon, TomTom.
 *      Set OVERTURE_FILE=/path/to/portland_places.geojson
 *
 *   3. OpenStreetMap Overpass (always attempted, free)
 *
 * Run from GitHub Actions (see bulk-occupancy-refresh.yml).
 *
 * Env vars:
 *   DATABASE_URL       — required
 *   OVERTURE_FILE      — path to Overture Maps GeoJSON (optional)
 *   DRY_RUN=1          — print changes without writing to DB
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "fs";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const OVERTURE_FILE = process.env.OVERTURE_FILE ?? "/tmp/portland_places.geojson";
const MATCH_RADIUS_M = 40;
const BBOX = "45.43,-122.84,45.65,-122.47";

// ── Geo utils ─────────────────────────────────────────────────────────────────

type Point = { lat: number; lng: number };

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function anyNearby(points: Point[], lat: number, lng: number): boolean {
  for (const p of points) {
    if (haversine(lat, lng, p.lat, p.lng) <= MATCH_RADIUS_M) return true;
  }
  return false;
}

// ── Portland Business Licenses (ArcGIS REST) ──────────────────────────────────
// PortlandMaps hosts the city's authoritative business license data.
// We paginate through all active licenses and collect their coordinates.

type ArcGISFeature = {
  attributes: Record<string, unknown>;
  geometry?: { x: number; y: number } | null;
};

async function fetchPortlandLicenses(): Promise<Point[]> {
  // Try multiple known Portland ArcGIS service URLs
  const candidates = [
    "https://www.portlandmaps.com/arcgis/rest/services/Public/BL_All/MapServer/0",
    "https://www.portlandmaps.com/arcgis/rest/services/Public/COP_Main/MapServer/24",
    "https://services.arcgis.com/quVN97tn06YNGj9s/arcgis/rest/services/Business_Licenses/FeatureServer/0",
  ];

  for (const baseUrl of candidates) {
    console.log(`  Trying: ${baseUrl}`);
    const points = await tryArcGISService(baseUrl);
    if (points !== null) {
      console.log(`  ✓ Portland Business Licenses: ${points.length.toLocaleString()} active records`);
      return points;
    }
  }

  // Fallback: CivicApps API (older but may still be active)
  console.log("  Trying CivicApps API fallback...");
  try {
    const res = await fetch(
      "http://api.civicapps.org/business-licenses?Count=100000",
      { signal: AbortSignal.timeout(30_000) }
    );
    if (res.ok) {
      type CivicRecord = { Latitude?: number; Longitude?: number; latitude?: number; longitude?: number };
      const json = await res.json() as { businessLicenses?: CivicRecord[] } | CivicRecord[];
      const records = Array.isArray(json) ? json : (json as { businessLicenses?: CivicRecord[] }).businessLicenses ?? [];
      const points: Point[] = [];
      for (const r of records) {
        const lat = r.Latitude ?? r.latitude;
        const lng = r.Longitude ?? r.longitude;
        if (lat && lng) points.push({ lat, lng });
      }
      if (points.length > 0) {
        console.log(`  ✓ CivicApps fallback: ${points.length.toLocaleString()} records`);
        return points;
      }
    }
  } catch {
    // ignore
  }

  console.warn("  ✗ Portland Business Licenses unavailable — skipping");
  return [];
}

async function tryArcGISService(baseUrl: string): Promise<Point[] | null> {
  // First check if the service responds
  try {
    const infoRes = await fetch(`${baseUrl}?f=json`, { signal: AbortSignal.timeout(15_000) });
    if (!infoRes.ok) return null;
    const info = await infoRes.json() as { error?: unknown };
    if (info.error) return null;
  } catch {
    return null;
  }

  // Paginate through all records
  const points: Point[] = [];
  const PAGE = 2000;
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "OBJECTID",
      returnGeometry: "true",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/query?${params}`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) break;
    } catch {
      break;
    }

    type ArcGISResponse = { features?: ArcGISFeature[]; error?: unknown; exceededTransferLimit?: boolean };
    const json = await res.json() as ArcGISResponse;
    if (json.error || !json.features) break;

    for (const f of json.features) {
      const g = f.geometry;
      if (g && typeof g.x === "number" && typeof g.y === "number" && g.x !== 0 && g.y !== 0) {
        // ArcGIS in WGS84: x = longitude, y = latitude
        points.push({ lat: g.y, lng: g.x });
      }
    }

    if (json.features.length < PAGE) break;
    offset += PAGE;
    process.stdout.write(`\r    Fetched ${points.length.toLocaleString()} licenses...`);
  }

  if (points.length === 0) return null;
  process.stdout.write("\n");
  return points;
}

// ── Overture Maps (pre-downloaded GeoJSON) ────────────────────────────────────

type OvertureFeature = {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: Record<string, unknown>;
};

function loadOverturePoints(): Point[] {
  if (!existsSync(OVERTURE_FILE)) {
    console.warn(`  ✗ Overture Maps file not found at ${OVERTURE_FILE} — skipping`);
    return [];
  }

  try {
    const raw = readFileSync(OVERTURE_FILE, "utf8");
    const points: Point[] = [];

    // Handle both FeatureCollection and line-delimited GeoJSON
    if (raw.trimStart().startsWith("{")) {
      type FC = { type: string; features: OvertureFeature[] };
      const fc = JSON.parse(raw) as FC;
      if (fc.type === "FeatureCollection") {
        for (const f of fc.features) {
          if (f.geometry?.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            points.push({ lat, lng });
          }
        }
      }
    } else {
      // Line-delimited GeoJSON (geojsonseq)
      for (const line of raw.split("\n")) {
        const trimmed = line.replace(/^\x1e/, "").trim();
        if (!trimmed) continue;
        try {
          const f = JSON.parse(trimmed) as OvertureFeature;
          if (f.geometry?.type === "Point") {
            const [lng, lat] = f.geometry.coordinates;
            points.push({ lat, lng });
          }
        } catch { /* skip malformed lines */ }
      }
    }

    console.log(`  ✓ Overture Maps: ${points.length.toLocaleString()} places loaded`);
    return points;
  } catch (e) {
    console.warn(`  ✗ Failed to parse Overture Maps file: ${e}`);
    return [];
  }
}

// ── OpenStreetMap Overpass ────────────────────────────────────────────────────

async function fetchOsmPoints(): Promise<Point[]> {
  const query = `
[out:json][timeout:90];
(
  node["shop"](${BBOX});
  node["amenity"~"restaurant|cafe|bar|fast_food|bank|pharmacy|clinic|doctors|dentist|gym|cinema|theatre|nightclub|pub|ice_cream|winery|taproom|beauty|nail_salon|hair_salon|laundry|car_wash|dry_cleaning|studio"](${BBOX});
  node["office"](${BBOX});
  node["leisure"~"fitness_centre|sports_centre|dance|yoga"](${BBOX});
  node["craft"](${BBOX});
  node["tourism"~"hotel|motel|hostel|guest_house"](${BBOX});
  way["shop"](${BBOX});
  way["amenity"~"restaurant|cafe|bar|fast_food|bank|pharmacy|clinic|doctors|dentist|gym|cinema|theatre|nightclub|pub|ice_cream|winery|taproom"](${BBOX});
  way["office"](${BBOX});
);
out center;
  `.trim();

  try {
    const res = await fetch("https://overpass.openstreetmap.fr/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) { console.warn(`  ✗ OSM Overpass returned ${res.status}`); return []; }

    type OverpassEl = { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number } };
    const json = await res.json() as { elements: OverpassEl[] };
    const points: Point[] = [];
    for (const el of json.elements) {
      if (el.type === "node" && el.lat !== undefined) points.push({ lat: el.lat, lng: el.lon! });
      else if (el.type === "way" && el.center) points.push({ lat: el.center.lat, lng: el.center.lon });
    }
    console.log(`  ✓ OSM Overpass: ${points.length.toLocaleString()} business points`);
    return points;
  } catch {
    console.warn("  ✗ OSM Overpass unreachable — skipping");
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏙️  Bulk occupancy enrichment from public datasets${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Match radius: ${MATCH_RADIUS_M}m\n`);

  console.log("Loading data sources...");
  const [licensePoints, osmPoints] = await Promise.all([
    fetchPortlandLicenses(),
    fetchOsmPoints(),
  ]);
  const overturePoints = loadOverturePoints();

  const totalSourcePoints = licensePoints.length + osmPoints.length + overturePoints.length;
  console.log(`\nTotal reference points: ${totalSourcePoints.toLocaleString()}`);

  if (totalSourcePoints === 0) {
    console.error("No data sources loaded — aborting.");
    process.exit(1);
  }

  // Load all likely_vacant spaces
  const spaces = await prisma.space.findMany({
    where: { status: "active", occupancyStatus: "likely_vacant" },
    select: { id: true, lat: true, lng: true, address: true },
  });

  console.log(`\nChecking ${spaces.length.toLocaleString()} "likely_vacant" spaces...\n`);

  const toMarkOccupied: Array<{ id: string; address: string; source: string }> = [];

  for (const space of spaces) {
    let foundBy: string | null = null;

    if (licensePoints.length > 0 && anyNearby(licensePoints, space.lat, space.lng)) {
      foundBy = "Portland Business License";
    } else if (overturePoints.length > 0 && anyNearby(overturePoints, space.lat, space.lng)) {
      foundBy = "Overture Maps";
    } else if (osmPoints.length > 0 && anyNearby(osmPoints, space.lat, space.lng)) {
      foundBy = "OpenStreetMap";
    }

    if (foundBy) {
      console.log(`  OCCUPIED  ${space.address} (via ${foundBy})`);
      toMarkOccupied.push({ id: space.id, address: space.address, source: foundBy });
    }
  }

  // Tally by source
  const bySrc: Record<string, number> = {};
  for (const s of toMarkOccupied) bySrc[s.source] = (bySrc[s.source] ?? 0) + 1;

  console.log(`\n── Results ─────────────────────────────────────────────────────`);
  console.log(`  Spaces checked:   ${spaces.length.toLocaleString()}`);
  console.log(`  Found occupied:   ${toMarkOccupied.length.toLocaleString()}`);
  for (const [src, n] of Object.entries(bySrc)) console.log(`    • ${src}: ${n}`);
  console.log(`  Still vacant:     ${(spaces.length - toMarkOccupied.length).toLocaleString()}`);

  if (toMarkOccupied.length === 0) {
    console.log("\nNo updates needed.");
    return;
  }

  if (DRY_RUN) {
    console.log("\n🚫 Dry run — no DB writes.");
    return;
  }

  console.log(`\nWriting ${toMarkOccupied.length} updates...`);
  const BATCH = 100;
  for (let i = 0; i < toMarkOccupied.length; i += BATCH) {
    const batch = toMarkOccupied.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) => prisma.space.update({ where: { id: u.id }, data: { occupancyStatus: "occupied" } }))
    );
    process.stdout.write(`\r  ${Math.min(i + BATCH, toMarkOccupied.length)} / ${toMarkOccupied.length}`);
  }

  console.log(`\n\n✅ Done — ${toMarkOccupied.length} spaces updated to "occupied"`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
