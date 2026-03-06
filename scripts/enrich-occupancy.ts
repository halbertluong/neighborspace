/**
 * Occupancy enrichment via OpenStreetMap Overpass API
 *
 * Strategy: Fetch all known businesses (shops, amenities, offices) in Portland
 * from OSM. For each of our spaces, check if an OSM business exists within
 * MATCH_RADIUS_M meters. If yes → "occupied". If no → "likely_vacant".
 *
 * Run: DATABASE_URL="..." npx tsx scripts/enrich-occupancy.ts
 * Dry: DRY_RUN=1 DATABASE_URL="..." npx tsx scripts/enrich-occupancy.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const MATCH_RADIUS_M = 30; // meters — space and OSM node must be this close

// Portland bounding box: south, west, north, east
const BBOX = "45.43,-122.84,45.65,-122.47";

// ── Haversine distance (meters) ───────────────────────────────────────────────
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

// ── Grid spatial index for fast nearest-neighbour lookup ─────────────────────
// Cell size ~100m (~0.001 degrees lat/lng at Portland's latitude)
const CELL_SIZE = 0.001;

type OsmPoint = { lat: number; lng: number };

function cellKey(lat: number, lng: number): string {
  return `${Math.floor(lat / CELL_SIZE)},${Math.floor(lng / CELL_SIZE)}`;
}

function buildGrid(points: OsmPoint[]): Map<string, OsmPoint[]> {
  const grid = new Map<string, OsmPoint[]>();
  for (const p of points) {
    const key = cellKey(p.lat, p.lng);
    const cell = grid.get(key);
    if (cell) cell.push(p);
    else grid.set(key, [p]);
  }
  return grid;
}

function hasBusinessNearby(
  grid: Map<string, OsmPoint[]>,
  lat: number,
  lng: number,
  radiusM: number
): boolean {
  // Check the cell and its 8 neighbours
  const cellLat = Math.floor(lat / CELL_SIZE);
  const cellLng = Math.floor(lng / CELL_SIZE);
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const key = `${cellLat + dLat},${cellLng + dLng}`;
      const points = grid.get(key);
      if (!points) continue;
      for (const p of points) {
        if (haversine(lat, lng, p.lat, p.lng) <= radiusM) return true;
      }
    }
  }
  return false;
}

// ── Overpass API ──────────────────────────────────────────────────────────────
type OverpassElement = {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
};

type OverpassResponse = { elements: OverpassElement[] };

async function fetchOsmBusinesses(): Promise<OsmPoint[]> {
  // Query nodes and ways with commercial tags in Portland bbox
  // We pull shops, amenities (restaurants, cafes, banks, etc.), offices,
  // and craft/tourism tags to get a comprehensive business picture.
  const query = `
[out:json][timeout:90];
(
  node["shop"](${BBOX});
  node["amenity"~"restaurant|cafe|bar|fast_food|bank|pharmacy|clinic|doctors|dentist|gym|cinema|theatre|nightclub|food_court|marketplace|pub|ice_cream|biergarten|lounge|hookah_lounge|bbq|food_court|butcher|seafood|juice_bar|winery|taproom"](${BBOX});
  node["office"](${BBOX});
  node["leisure"~"fitness_centre|sports_centre|dance|yoga"](${BBOX});
  node["craft"](${BBOX});
  node["tourism"~"hotel|motel|hostel|guest_house"](${BBOX});
  way["shop"](${BBOX});
  way["amenity"~"restaurant|cafe|bar|fast_food|bank|pharmacy|clinic|doctors|dentist|gym|cinema|theatre|nightclub|food_court|marketplace|pub|ice_cream|biergarten|lounge|hookah_lounge|bbq|food_court|butcher|seafood|juice_bar|winery|taproom"](${BBOX});
  way["office"](${BBOX});
);
out center;
  `.trim();

  // Use French mirror — more reliable than the main instance
  const url = "https://overpass.openstreetmap.fr/api/interpreter";
  console.log("Fetching OSM businesses from Overpass API...");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`Overpass API returned ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as OverpassResponse;
  const points: OsmPoint[] = [];

  for (const el of json.elements) {
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      points.push({ lat: el.lat, lng: el.lon });
    } else if (el.type === "way" && el.center) {
      points.push({ lat: el.center.lat, lng: el.center.lon });
    }
  }

  return points;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏪 Occupancy enrichment${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Match radius: ${MATCH_RADIUS_M}m\n`);

  // 1. Fetch OSM businesses
  const osmPoints = await fetchOsmBusinesses();
  console.log(`✓ Fetched ${osmPoints.length.toLocaleString()} OSM business points`);

  if (osmPoints.length === 0) {
    console.error("No OSM points returned — check network or Overpass query");
    process.exit(1);
  }

  // 2. Build spatial index
  const grid = buildGrid(osmPoints);
  console.log(`✓ Built spatial grid (${grid.size.toLocaleString()} cells)`);

  // 3. Load all active spaces
  const spaces = await prisma.space.findMany({
    where: { status: "active" },
    select: { id: true, lat: true, lng: true, address: true },
  });
  console.log(`✓ Loaded ${spaces.length.toLocaleString()} active spaces\n`);

  // 4. Classify each space
  let occupied = 0;
  let likelyVacant = 0;
  const batchSize = 500;
  const updates: { id: string; occupancyStatus: string }[] = [];

  for (const space of spaces) {
    const status = hasBusinessNearby(grid, space.lat, space.lng, MATCH_RADIUS_M)
      ? "occupied"
      : "likely_vacant";
    if (status === "occupied") occupied++;
    else likelyVacant++;
    updates.push({ id: space.id, occupancyStatus: status });
  }

  console.log(`  occupied:      ${occupied.toLocaleString()}`);
  console.log(`  likely_vacant: ${likelyVacant.toLocaleString()}`);
  console.log(`  total:         ${spaces.length.toLocaleString()}`);

  if (DRY_RUN) {
    console.log("\n🚫 Dry run — no DB writes");
    return;
  }

  // 5. Write to DB in batches
  console.log(`\nWriting to DB in batches of ${batchSize}...`);
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.space.update({
          where: { id: u.id },
          data: { occupancyStatus: u.occupancyStatus },
        })
      )
    );
    process.stdout.write(`\r  ${Math.min(i + batchSize, updates.length)} / ${updates.length}`);
  }
  console.log("\n✓ Done");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
