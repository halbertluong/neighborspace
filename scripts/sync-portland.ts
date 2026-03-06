/**
 * Portland commercial spaces — nightly sync script.
 *
 * SOURCE: Portland Maps Open Data ArcGIS REST API (no API key required)
 *   Buildings:     MapServer/184   — one record per physical building
 *   Zoning:        MapServer/16    — zone polygons (used as spatial filter)
 *   Neighborhoods: MapServer/3     — neighborhood name at a point
 *
 * WHY ZONE-POLYGON-BASED APPROACH (not BLDG_USE filter)
 * ─────────────────────────────────────────────────────────────────────────────
 * Portland's building dataset classifies buildings by PRIMARY use. Mixed-use
 * buildings with ground-floor storefronts and upper-floor apartments appear as
 * "Multi Family Residential" or "Single Family Residential" — NOT as
 * "Commercial Retail". Filtering by BLDG_USE misses entire commercial corridors
 * like N Killingsworth, N Lombard, and N Interstate Ave.
 *
 * The fix: use the ZONING layer as the primary filter. We fetch all polygons
 * zoned for commercial use (CM1, CM2, CM3, CX, CS, CG, CR, EX, CI1, CI2),
 * then query the buildings layer for every building that falls within those
 * polygons — regardless of how the building is classified. The zone code is
 * already known from the polygon, eliminating one enrichment API call.
 *
 * UNIQUE IDENTITY STRATEGY
 * ─────────────────────────────────────────────────────────────────────────────
 * Portland's BLDG_ID (e.g. "1N1E28DC-1000-B1") is the stable unique key.
 * Format: <STATE_ID>-B<BLDG_NUMB>
 *   - STATE_ID  = tax lot identifier (one per parcel)
 *   - BLDG_NUMB = building number on that parcel (1, 2, 3 …)
 *
 * A parcel with two separate structures gets two records:
 *   1N1E28DC-1000-B1  (front building)
 *   1N1E28DC-1000-B2  (rear building / rear unit)
 *
 * Stored as sourceId = "portland-arcgis:<BLDG_ID>".
 *
 * WHAT THIS SCRIPT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Fetches all commercial zone polygons (CM1/CM2/CM3/CX/CS/CG/CR/EX/CI).
 * 2. Queries buildings within each zone polygon — captures mixed-use buildings
 *    that were invisible to the old BLDG_USE filter.
 * 3. Migrates existing un-tagged spaces by matching address → backfills sourceId.
 * 4. Upserts new/changed buildings. Zone code comes from the polygon (free).
 *    Only neighborhood requires a spatial lookup for new buildings.
 * 5. Retires spaces no longer present in the source:
 *      - No community activity → hard-deleted
 *      - Has community activity → soft-retired (status = "retired")
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   npx tsx scripts/sync-portland.ts                 # full sync
 *   DRY_RUN=1 npx tsx scripts/sync-portland.ts       # preview, no DB writes
 *   CONCURRENCY=20 npx tsx scripts/sync-portland.ts  # tune parallelism
 *
 * SCHEDULING (cron — runs at 2 am daily)
 *   0 2 * * * cd /path/to/app && npx tsx scripts/sync-portland.ts >> logs/sync.log 2>&1
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DRY_RUN     = process.env.DRY_RUN === "1";
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 12;
const SOURCE_TAG  = "portland-arcgis";

// ---------------------------------------------------------------------------
// ArcGIS endpoints (public, no API key)
// ---------------------------------------------------------------------------
const BUILDINGS_URL =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/184/query";
const ZONING_URL =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_ZoningCode/MapServer/16/query";
const NEIGHBORHOODS_URL =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3/query";

// Commercial zone codes to include.
// CM = Commercial Mixed-Use, CX = Central Commercial, CS = Auto-Oriented,
// CG = General Commercial, CR = Commercial Residential, EX = Employment,
// CI = Campus Institutional (often mixed-use commercial blocks)
const COMMERCIAL_ZONES = ["CM1", "CM2", "CM3", "CX", "CS", "CG", "CR", "EX", "CI1", "CI2"];

// Human-readable previous use label — derived from BLDG_USE when available,
// otherwise inferred from zone for purely mixed-use buildings.
const USE_LABEL: Record<string, string> = {
  "Commercial Retail":    "Retail",
  "Commercial Restaurant":"Restaurant",
  "Commercial Grocery":   "Grocery / market",
  "Commercial Hotel":     "Hotel / lodging",
  "Commercial Office":    "Office",
  "Institutional":        "Institutional",
  "Institutional Religious": "Religious / community",
  "Industrial":           "Industrial",
  "Parking":              "Parking structure",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RawFeature = {
  attributes: Record<string, string | number | null>;
  geometry?:  { rings?: number[][][] };
};

type BuildingRecord = {
  bldgId:      string;
  sourceId:    string;
  address:     string;
  lat:         number;
  lng:         number;
  sqft:        number | null;
  previousUse: string | null;
  yearBuilt:   number | null;
  numStories:  number | null;
  structType:  string | null;
  structCond:  string | null;
  propKey:     number | null;
  stateId:     string;
  bldgNumb:    number;
  rawBldgUse:  string;
  zoningCode:  string;   // known from the zone polygon — no extra lookup needed
};

type EnrichedRecord = BuildingRecord & {
  neighborhood: string | null;
};

// ---------------------------------------------------------------------------
// ArcGIS fetch helpers
// ---------------------------------------------------------------------------

async function arcgisQuery(
  url:     string,
  params:  Record<string, string>,
  offset = 0,
  limit  = 1000
): Promise<{ features: RawFeature[]; exceeded: boolean }> {
  const body = new URLSearchParams(params);
  body.set("resultOffset",      String(offset));
  body.set("resultRecordCount", String(limit));
  body.set("f", "json");

  // Use POST to handle large geometry payloads (polygon queries exceed GET URL limits)
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const data = await res.json() as {
    features?:             RawFeature[];
    exceededTransferLimit?: boolean;
    error?:                { code: number; message: string };
  };
  if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
  return { features: data.features ?? [], exceeded: data.exceededTransferLimit ?? false };
}

/** Fetch all pages until exhausted. */
async function fetchAllPages(
  url:    string,
  params: Record<string, string>
): Promise<RawFeature[]> {
  const all: RawFeature[] = [];
  let offset = 0;
  for (;;) {
    const { features, exceeded } = await arcgisQuery(url, params, offset, 1000);
    all.push(...features);
    if (!exceeded || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

/** Fetch all commercial zone polygons (with geometry in WGS84). */
async function fetchCommercialZones(): Promise<Array<{ zone: string; geometry: { rings: number[][][] } }>> {
  const where = COMMERCIAL_ZONES.map((z) => `ZONE='${z}'`).join(" OR ");
  const all: Array<{ zone: string; geometry: { rings: number[][][] } }> = [];
  let offset = 0;

  for (;;) {
    const { features, exceeded } = await arcgisQuery(
      ZONING_URL,
      {
        where,
        outFields:      "ZONE",
        returnGeometry: "true",
        outSR:          "4326",
      },
      offset, 1000
    );
    for (const f of features) {
      if (f.geometry?.rings) {
        all.push({ zone: f.attributes["ZONE"] as string, geometry: f.geometry as { rings: number[][][] } });
      }
    }
    if (!exceeded || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

/** Query all buildings within a given zone polygon geometry. */
async function fetchBuildingsInZone(
  zoneGeom: { rings: number[][][] }
): Promise<RawFeature[]> {
  const all: RawFeature[] = [];
  let offset = 0;
  for (;;) {
    const { features, exceeded } = await arcgisQuery(
      BUILDINGS_URL,
      {
        geometry:       JSON.stringify(zoneGeom),
        geometryType:   "esriGeometryPolygon",
        inSR:           "4326",
        spatialRel:     "esriSpatialRelIntersects",
        where:          "BLDG_STAT='Existing'",
        outFields:      "BLDG_ID,BLDG_ADDR,BLDG_USE,BLDG_SQFT,YEAR_BUILT,NUM_STORY,STRUC_TYPE,STRUC_COND,LAT_CTR,LONG_CTR,PROPKEY,STATE_ID,BLDG_NUMB",
        returnGeometry: "false",
      },
      offset, 1000
    );
    all.push(...features);
    if (!exceeded || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

async function lookupNeighborhood(lat: number, lng: number): Promise<string | null> {
  try {
    const { features } = await arcgisQuery(NEIGHBORHOODS_URL, {
      geometry:       `${lng},${lat}`,
      geometryType:   "esriGeometryPoint",
      inSR:           "4326",
      spatialRel:     "esriSpatialRelIntersects",
      outFields:      "NAME",
      returnGeometry: "false",
    }, 0, 1);
    const n = features[0]?.attributes?.NAME as string | null;
    return n ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  } catch { return null; }
}

/** Bounded parallelism. */
async function pLimit<T>(
  tasks:       (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      onProgress?.(++done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Parse raw ArcGIS feature → BuildingRecord
// ---------------------------------------------------------------------------
function parseFeature(f: RawFeature, zoningCode: string): BuildingRecord | null {
  const a = f.attributes;

  const bldgId  = String(a["BLDG_ID"] ?? "").trim();
  const address = String(a["BLDG_ADDR"] ?? "").trim();
  const lat     = a["LAT_CTR"]  as number | null;
  const lng     = a["LONG_CTR"] as number | null;

  if (!bldgId || !address || lat == null || lng == null) return null;
  // Portland bounding box sanity check
  if (lat < 45.4 || lat > 45.7 || lng < -122.9 || lng > -122.4) return null;

  const bldgUse    = String(a["BLDG_USE"] ?? "");
  const sqftRaw    = a["BLDG_SQFT"]   as number | null;
  const yearRaw    = a["YEAR_BUILT"]  as number | null;
  const storiesRaw = a["NUM_STORY"]   as number | null;

  return {
    bldgId,
    sourceId:    `${SOURCE_TAG}:${bldgId}`,
    address,
    lat, lng,
    sqft:        sqftRaw   && sqftRaw   > 0    ? sqftRaw    : null,
    previousUse: (USE_LABEL[bldgUse] ?? (bldgUse.includes("Commercial") ? bldgUse.replace("Commercial ", "") : null)) || null,
    yearBuilt:   yearRaw   && yearRaw   > 1800 ? yearRaw    : null,
    numStories:  storiesRaw && storiesRaw > 0  ? storiesRaw : null,
    structType:  (a["STRUC_TYPE"] as string | null) || null,
    structCond:  (a["STRUC_COND"] as string | null) || null,
    propKey:     (a["PROPKEY"]    as number | null)  || null,
    stateId:     String(a["STATE_ID"]  ?? "").trim(),
    bldgNumb:    (a["BLDG_NUMB"] as number) ?? 1,
    rawBldgUse:  bldgUse,
    zoningCode,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = new Date();
  console.log(`\n🔄  Portland nightly sync — ${startedAt.toISOString()}`);
  console.log(`    Strategy:    zone-polygon spatial query (captures mixed-use buildings)`);
  console.log(`    Zones:       ${COMMERCIAL_ZONES.join(", ")}`);
  console.log(`    Concurrency: ${CONCURRENCY}   Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  // ── 1. Fetch all commercial zone polygons ─────────────────────────────────
  console.log("🗺️  Fetching commercial zone polygons...");
  const zones = await fetchCommercialZones();
  const zoneCountByType: Record<string, number> = {};
  for (const z of zones) zoneCountByType[z.zone] = (zoneCountByType[z.zone] ?? 0) + 1;
  console.log(`   ${zones.length} zone polygons: ${Object.entries(zoneCountByType).map(([k,v]) => `${k}×${v}`).join(", ")}\n`);

  // ── 2. Query buildings within each zone polygon ───────────────────────────
  console.log("🏗️  Querying buildings within each zone polygon...");
  const byBldgId = new Map<string, BuildingRecord>();
  let zonesDone = 0;

  await pLimit(
    zones.map((z) => async () => {
      const raw = await fetchBuildingsInZone(z.geometry);
      for (const f of raw) {
        const rec = parseFeature(f, z.zone);
        if (!rec) continue;
        // First zone encountered wins (buildings near zone boundaries)
        if (!byBldgId.has(rec.bldgId)) byBldgId.set(rec.bldgId, rec);
      }
      zonesDone++;
      if (zonesDone % 50 === 0 || zonesDone === zones.length) {
        process.stdout.write(`   ${zonesDone}/${zones.length} zones processed, ${byBldgId.size} unique buildings so far\r`);
      }
    }),
    CONCURRENCY
  );
  console.log(`\n   Total unique buildings (by BLDG_ID): ${byBldgId.size}\n`);

  const unique = Array.from(byBldgId.values());

  // ── 3. Migrate un-tagged spaces (backfill sourceId) ───────────────────────
  const untagged = await prisma.space.findMany({
    where:  { sourceId: null },
    select: { id: true, address: true },
  });

  if (untagged.length > 0) {
    console.log(`🔗  Migrating ${untagged.length} existing spaces to sourceId tracking...`);
    const addrToSourceId = new Map(unique.map((r) => [r.address, r.sourceId]));
    let migrated = 0, dupes = 0;

    for (const space of untagged) {
      const sid = addrToSourceId.get(space.address);
      if (!sid) continue;

      const conflict = await prisma.space.findUnique({ where: { sourceId: sid } });
      if (conflict) {
        dupes++;
        if (!DRY_RUN) {
          const activity = await prisma.space.findUnique({
            where:  { id: space.id },
            select: { _count: { select: { ideas: true, themes: true, pledges: true } } },
          });
          const hasActivity = Object.values(activity?._count ?? {}).reduce((a, b) => a + b, 0) > 0;
          if (!hasActivity) await prisma.space.delete({ where: { id: space.id } });
        }
        continue;
      }

      if (!DRY_RUN) await prisma.space.update({ where: { id: space.id }, data: { sourceId: sid } });
      migrated++;
    }
    console.log(`   Migrated: ${migrated}  Duplicate-resolved: ${dupes}\n`);
  }

  // ── 4. Neighborhood enrichment (only new / coord-changed buildings) ────────
  const existingBySourceId = new Map(
    (await prisma.space.findMany({
      where:  { sourceId: { startsWith: SOURCE_TAG + ":" } },
      select: { id: true, sourceId: true, lat: true, lng: true, neighborhood: true },
    })).map((s) => [s.sourceId!, s])
  );

  const needNeighborhood = unique.filter((r) => {
    const ex = existingBySourceId.get(r.sourceId);
    if (!ex) return true;
    const moved = Math.abs(ex.lat - r.lat) > 0.0001 || Math.abs(ex.lng - r.lng) > 0.0001;
    return moved || !ex.neighborhood || ex.neighborhood === "Portland, OR";
  });

  const neighborhoodMap = new Map<string, string | null>();

  // Pre-populate from DB for buildings that don't need a fresh lookup
  for (const r of unique) {
    const ex = existingBySourceId.get(r.sourceId);
    if (ex && !needNeighborhood.includes(r)) {
      neighborhoodMap.set(r.bldgId, ex.neighborhood);
    }
  }

  if (needNeighborhood.length > 0) {
    console.log(`📍 Looking up neighborhoods for ${needNeighborhood.length} buildings...`);
    let lastPct = -1;
    await pLimit(
      needNeighborhood.map((r) => async () => {
        neighborhoodMap.set(r.bldgId, await lookupNeighborhood(r.lat, r.lng));
      }),
      CONCURRENCY,
      (done, total) => {
        const pct = Math.floor((done / total) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          process.stdout.write(`   ${pct}% (${done}/${total})\r`);
          lastPct = pct;
        }
      }
    );
    console.log(`\n   Done.\n`);
  } else {
    console.log("   All neighborhood data current.\n");
  }

  // ── 5. Upsert all buildings ───────────────────────────────────────────────
  const now = new Date();
  let created = 0, updated = 0;

  console.log(`💾 Upserting ${unique.length} buildings...`);
  for (const r of unique) {
    const neighborhood = neighborhoodMap.get(r.bldgId) ?? null;

    const spaceData = {
      name:          r.address,
      address:       r.address,
      neighborhood:  neighborhood ?? "Portland, OR",
      city:          "Portland, OR",
      lat:           r.lat,
      lng:           r.lng,
      squareFeet:    r.sqft,
      zoningCode:    r.zoningCode,
      previousUse:   r.previousUse,
      rawAttributes: JSON.stringify({
        bldgId:     r.bldgId,
        stateId:    r.stateId,
        bldgNumb:   r.bldgNumb,
        propKey:    r.propKey,
        yearBuilt:  r.yearBuilt,
        numStories: r.numStories,
        structType: r.structType,
        structCond: r.structCond,
        rawBldgUse: r.rawBldgUse,
        source:     SOURCE_TAG,
      }),
      status:    "active",
      syncedAt:  now,
    };

    if (DRY_RUN) {
      if (existingBySourceId.has(r.sourceId)) updated++; else created++;
      continue;
    }

    const existed = existingBySourceId.has(r.sourceId);
    await prisma.space.upsert({
      where:  { sourceId: r.sourceId },
      create: { ...spaceData, sourceId: r.sourceId },
      update: spaceData,
    });
    if (existed) updated++; else created++;
  }

  // ── 6. Retire stale records ───────────────────────────────────────────────
  const currentSourceIds = new Set(unique.map((r) => r.sourceId));

  const stale = await prisma.space.findMany({
    where: {
      sourceId: { startsWith: SOURCE_TAG + ":" },
      status:   "active",
      syncedAt: { lt: now },
    },
    include: { _count: { select: { ideas: true, themes: true, pledges: true } } },
  });

  const actuallyStale = stale.filter((s) => !currentSourceIds.has(s.sourceId!));
  let hardDeleted = 0, softRetired = 0;

  for (const space of actuallyStale) {
    const hasActivity = space._count.ideas + space._count.themes + space._count.pledges > 0;
    if (DRY_RUN) {
      console.log(`  [DRY] ${hasActivity ? "RETIRE" : "DELETE"} stale: ${space.address}`);
      hasActivity ? softRetired++ : hardDeleted++;
      continue;
    }
    if (hasActivity) {
      await prisma.space.update({ where: { id: space.id }, data: { status: "retired" } });
      softRetired++;
    } else {
      await prisma.space.delete({ where: { id: space.id } });
      hardDeleted++;
    }
  }

  // ── 7. Summary ────────────────────────────────────────────────────────────
  const totalActive  = DRY_RUN ? "?" : await prisma.space.count({ where: { status: "active" } });
  const totalRetired = DRY_RUN ? "?" : await prisma.space.count({ where: { status: "retired" } });
  const duration     = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);

  console.log("\n✅  Sync complete.");
  console.log(`    Duration:         ${duration}s`);
  console.log(`    Created:          ${created}`);
  console.log(`    Updated:          ${updated}`);
  console.log(`    Hard-deleted:     ${hardDeleted}  (stale, no community data)`);
  console.log(`    Soft-retired:     ${softRetired}  (stale, has ideas/themes/pledges)`);
  console.log(`    Active in DB:     ${totalActive}`);
  console.log(`    Retired in DB:    ${totalRetired}`);
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌  Sync failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
