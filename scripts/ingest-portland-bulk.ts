/**
 * Portland commercial buildings — fast bulk ingestion with parallel enrichment.
 *
 * Fetches all 2,929 commercial buildings from Portland's open data, enriches
 * them with zoning + neighborhood in parallel batches, and upserts to the DB.
 *
 * Usage:
 *   npx tsx scripts/ingest-portland-bulk.ts               # ingest up to 1000 (default)
 *   LIMIT=500 npx tsx scripts/ingest-portland-bulk.ts     # specific limit
 *   DRY_RUN=1 npx tsx scripts/ingest-portland-bulk.ts     # preview without writing
 *   CONCURRENCY=20 npx tsx scripts/ingest-portland-bulk.ts # tune parallel requests
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const RECORD_LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 1000;
const CONCURRENCY = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY) : 10;

// ---------------------------------------------------------------------------
// ArcGIS REST endpoints (all public, no key required)
// ---------------------------------------------------------------------------
const BUILDINGS_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/184/query";
const ZONING_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_ZoningCode/MapServer/16/query";
const NEIGHBORHOODS_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3/query";

const WANTED_USES = [
  "Commercial Retail",
  "Commercial Restaurant",
  "Commercial Grocery",
  "Commercial Hotel",
  "Commercial Office",
];

const USE_LABEL: Record<string, string> = {
  "Commercial Retail": "Retail",
  "Commercial Restaurant": "Restaurant",
  "Commercial Grocery": "Grocery / market",
  "Commercial Hotel": "Hotel / lodging",
  "Commercial Office": "Office",
};

type ArcGISFeature = {
  attributes: Record<string, string | number | null>;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function arcgisQuery(
  endpoint: string,
  params: Record<string, string>,
  offset = 0,
  pageSize = 1000
): Promise<{ features: ArcGISFeature[]; exceededTransferLimit: boolean }> {
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(pageSize));
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  const data = (await res.json()) as {
    features?: ArcGISFeature[];
    exceededTransferLimit?: boolean;
    error?: { code: number; message: string };
  };
  if (data.error) throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
  return {
    features: data.features ?? [],
    exceededTransferLimit: data.exceededTransferLimit ?? false,
  };
}

async function fetchAllBuildings(maxRecords: number): Promise<ArcGISFeature[]> {
  const whereClause = WANTED_USES.map((u) => `BLDG_USE='${u}'`).join(" OR ");
  const all: ArcGISFeature[] = [];
  let offset = 0;
  while (all.length < maxRecords) {
    const remaining = maxRecords - all.length;
    const { features, exceededTransferLimit } = await arcgisQuery(
      BUILDINGS_ENDPOINT,
      {
        where: `(${whereClause}) AND BLDG_STAT='Existing'`,
        outFields: "BLDG_ADDR,BLDG_USE,BLDG_SQFT,YEAR_BUILT,LAT_CTR,LONG_CTR",
        returnGeometry: "false",
        orderByFields: "BLDG_SQFT DESC",
      },
      offset,
      Math.min(1000, remaining)
    );
    all.push(...features);
    if (!exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

async function lookupZoning(lat: number, lng: number): Promise<string | null> {
  try {
    const { features } = await arcgisQuery(ZONING_ENDPOINT, {
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "ZONE",
      returnGeometry: "false",
    }, 0, 1);
    return (features[0]?.attributes?.ZONE as string) ?? null;
  } catch { return null; }
}

async function lookupNeighborhood(lat: number, lng: number): Promise<string | null> {
  try {
    const { features } = await arcgisQuery(NEIGHBORHOODS_ENDPOINT, {
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "NAME",
      returnGeometry: "false",
    }, 0, 1);
    const name = features[0]?.attributes?.NAME as string | null;
    return name ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  } catch { return null; }
}

/** Run tasks in parallel with a concurrency limit. */
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  let done = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
      done++;
      onProgress?.(done, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🏙️  Portland bulk commercial buildings ingestion");
  console.log(`   Limit:       ${RECORD_LIMIT} records`);
  console.log(`   Concurrency: ${CONCURRENCY} parallel enrichment requests`);
  console.log(`   Mode:        ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  console.log("📡 Fetching commercial buildings...");
  const buildings = await fetchAllBuildings(RECORD_LIMIT);
  console.log(`   Got ${buildings.length} buildings.\n`);

  // Dedupe by address, filter invalid coords
  const seen = new Set<string>();
  const valid = buildings.filter((b) => {
    const addr = String(b.attributes["BLDG_ADDR"] ?? "").trim();
    const lat = b.attributes["LAT_CTR"] as number | null;
    const lng = b.attributes["LONG_CTR"] as number | null;
    if (!addr || lat == null || lng == null) return false;
    if (lat < 45.4 || lat > 45.7 || lng < -122.9 || lng > -122.4) return false;
    const key = `${addr}::Portland`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`   After deduplication: ${valid.length} unique buildings.\n`);

  // Check which addresses already exist in DB
  const existingAddresses = new Set(
    (await prisma.space.findMany({ select: { address: true } })).map((s) => s.address)
  );
  const toProcess = valid.filter((b) => {
    const addr = String(b.attributes["BLDG_ADDR"] ?? "").trim();
    return !existingAddresses.has(addr);
  });
  console.log(`   Already in DB: ${existingAddresses.size}`);
  console.log(`   New to ingest: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log("✅ Nothing new to ingest.");
    return;
  }

  // Parallel enrichment
  console.log(`🔍 Enriching ${toProcess.length} buildings with zoning + neighborhood...`);
  let lastPct = -1;
  const enriched = await pLimit(
    toProcess.map((b) => async () => {
      const lat = b.attributes["LAT_CTR"] as number;
      const lng = b.attributes["LONG_CTR"] as number;
      const [zoningCode, neighborhood] = await Promise.all([
        lookupZoning(lat, lng),
        lookupNeighborhood(lat, lng),
      ]);
      return { b, zoningCode, neighborhood };
    }),
    CONCURRENCY,
    (done, total) => {
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        process.stdout.write(`   ${pct}% (${done}/${total})\r`);
        lastPct = pct;
      }
    }
  );
  console.log(`\n   Enrichment complete.\n`);

  // Write to DB
  let created = 0, skipped = 0;

  for (const { b, zoningCode, neighborhood } of enriched) {
    const attrs = b.attributes;
    const address = String(attrs["BLDG_ADDR"] ?? "").trim();
    const lat = attrs["LAT_CTR"] as number;
    const lng = attrs["LONG_CTR"] as number;
    const bldgUse = String(attrs["BLDG_USE"] ?? "");
    const sqft = typeof attrs["BLDG_SQFT"] === "number" && attrs["BLDG_SQFT"] > 0
      ? (attrs["BLDG_SQFT"] as number) : null;
    const yearBuilt = typeof attrs["YEAR_BUILT"] === "number" && attrs["YEAR_BUILT"] > 1800
      ? (attrs["YEAR_BUILT"] as number) : null;
    const previousUse = (USE_LABEL[bldgUse] ?? bldgUse) || null;

    const data = {
      name: address,
      address,
      neighborhood: neighborhood ?? "Portland, OR",
      city: "Portland, OR",
      lat,
      lng,
      squareFeet: sqft,
      zoningCode,
      previousUse,
      rawAttributes: JSON.stringify({ yearBuilt, bldgUse, source: "portland-arcgis-bulk" }),
    };

    if (DRY_RUN) {
      console.log(`  [DRY] ${address} | ${sqft ?? "?"}sqft | ${zoningCode ?? "?"} | ${neighborhood ?? "?"}`);
      created++;
      continue;
    }

    try {
      await prisma.space.create({ data });
      created++;
    } catch {
      skipped++;
    }
  }

  console.log("✅ Done.");
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total spaces in DB: ${await prisma.space.count()}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌ Error:", e);
    prisma.$disconnect();
    process.exit(1);
  });
