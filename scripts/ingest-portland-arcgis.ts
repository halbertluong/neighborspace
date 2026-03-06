/**
 * Portland vacant commercial spaces — ArcGIS ingestion script.
 *
 * Pulls live data from Portland's open data portal (no API key required):
 *   Buildings:     https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/184
 *   Zoning:        https://www.portlandmaps.com/od/rest/services/COP_OpenData_ZoningCode/MapServer/16
 *   Neighborhoods: https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3
 *
 * What this script does:
 *   1. Fetches existing commercial buildings (retail, restaurant, grocery, office, hotel).
 *   2. For each building, looks up its zoning code and neighborhood via spatial query.
 *   3. Upserts rows into the local database via Prisma.
 *
 * Note on "vacancy": Portland's building dataset doesn't have a vacancy flag.
 *   This script imports all existing commercial buildings as candidate spaces.
 *   Admins can remove entries that are actively occupied, or the community
 *   can flag them. A future enhancement can cross-reference business license
 *   data to infer vacancies automatically.
 *
 * Usage:
 *   npm run ingest:portland-arcgis              # ingest up to 200 records (default)
 *   LIMIT=500 npm run ingest:portland-arcgis    # ingest up to 500 records
 *   DRY_RUN=1 npm run ingest:portland-arcgis    # preview without writing to DB
 *   SKIP_ENRICHMENT=1 npm run ingest:portland-arcgis  # skip zoning/neighborhood lookups (faster)
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const RECORD_LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : 200;
const SKIP_ENRICHMENT = process.env.SKIP_ENRICHMENT === "1";

// ---------------------------------------------------------------------------
// ArcGIS REST endpoints (all public, no key required)
// ---------------------------------------------------------------------------
const BUILDINGS_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/184/query";
const ZONING_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_ZoningCode/MapServer/16/query";
const NEIGHBORHOODS_ENDPOINT =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Boundary/MapServer/3/query";

// Building use types we want (commercial/institutional that could become community spaces)
const WANTED_USES = [
  "Commercial Retail",
  "Commercial Restaurant",
  "Commercial Grocery",
  "Commercial Hotel",
  "Commercial Office",
  "Institutional",
];

// Map BLDG_USE → human-readable "previous use" label
const USE_LABEL: Record<string, string> = {
  "Commercial Retail": "Retail",
  "Commercial Restaurant": "Restaurant",
  "Commercial Grocery": "Grocery / market",
  "Commercial Hotel": "Hotel / lodging",
  "Commercial Office": "Office",
  "Institutional": "Institutional",
  "Institutional Religious": "Religious / community",
  "Industrial": "Industrial",
  "Parking": "Parking structure",
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
  pageSize = 500
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

/** Fetch all pages up to maxRecords. */
async function fetchAll(
  endpoint: string,
  params: Record<string, string>,
  maxRecords: number
): Promise<ArcGISFeature[]> {
  const all: ArcGISFeature[] = [];
  let offset = 0;
  while (all.length < maxRecords) {
    const remaining = maxRecords - all.length;
    const { features, exceededTransferLimit } = await arcgisQuery(
      endpoint,
      params,
      offset,
      Math.min(500, remaining)
    );
    all.push(...features);
    if (!exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

/** Lookup the zoning code at a given lat/lng via point-in-polygon query. */
async function lookupZoning(lat: number, lng: number): Promise<string | null> {
  try {
    const { features } = await arcgisQuery(
      ZONING_ENDPOINT,
      {
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "ZONE",
        returnGeometry: "false",
      },
      0,
      1
    );
    return (features[0]?.attributes?.ZONE as string) ?? null;
  } catch {
    return null;
  }
}

/** Lookup the neighborhood name at a given lat/lng via point-in-polygon query. */
async function lookupNeighborhood(lat: number, lng: number): Promise<string | null> {
  try {
    const { features } = await arcgisQuery(
      NEIGHBORHOODS_ENDPOINT,
      {
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "NAME",
        returnGeometry: "false",
      },
      0,
      1
    );
    const name = features[0]?.attributes?.NAME as string | null;
    return name ? toTitleCase(name) : null;
  } catch {
    return null;
  }
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🏙️  Portland ArcGIS commercial buildings ingestion");
  console.log(`   Limit:        ${RECORD_LIMIT} records`);
  console.log(`   Mode:         ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE"}`);
  console.log(`   Enrichment:   ${SKIP_ENRICHMENT ? "skipped (fast)" : "enabled (zoning + neighborhood lookups)"}`);
  console.log("");

  // Build WHERE clause for commercial uses
  const whereClause =
    WANTED_USES.map((u) => `BLDG_USE='${u}'`).join(" OR ");

  console.log("📡 Fetching commercial buildings from Portland open data...");
  const buildings = await fetchAll(
    BUILDINGS_ENDPOINT,
    {
      where: `(${whereClause}) AND BLDG_STAT='Existing'`,
      outFields: "BLDG_ADDR,BLDG_NAME,BLDG_USE,BLDG_SQFT,YEAR_BUILT,LAT_CTR,LONG_CTR",
      returnGeometry: "false",
      orderByFields: "BLDG_SQFT DESC",
    },
    RECORD_LIMIT
  );

  console.log(`   Fetched ${buildings.length} buildings.`);
  if (buildings.length === 0) {
    console.log("   No buildings returned. Check the endpoint or query.");
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const seen = new Set<string>();

  for (let i = 0; i < buildings.length; i++) {
    const attrs = buildings[i].attributes;

    const address = String(attrs["BLDG_ADDR"] ?? "").trim();
    const lat = attrs["LAT_CTR"] as number | null;
    const lng = attrs["LONG_CTR"] as number | null;

    if (!address || lat == null || lng == null) { skipped++; continue; }

    // Portland rough bounding box check
    if (lat < 45.4 || lat > 45.7 || lng < -122.9 || lng > -122.4) { skipped++; continue; }

    const dedupeKey = `${address}::Portland, OR`;
    if (seen.has(dedupeKey)) { skipped++; continue; }
    seen.add(dedupeKey);

    const bldgUse = String(attrs["BLDG_USE"] ?? "");
    const sqft = typeof attrs["BLDG_SQFT"] === "number" && attrs["BLDG_SQFT"] > 0
      ? attrs["BLDG_SQFT"] as number
      : null;
    const yearBuilt = typeof attrs["YEAR_BUILT"] === "number" && attrs["YEAR_BUILT"] > 1800
      ? attrs["YEAR_BUILT"] as number
      : null;
    const previousUse = (USE_LABEL[bldgUse] ?? bldgUse) || null;

    // Enrich with zoning + neighborhood (one spatial query each)
    let zoningCode: string | null = null;
    let neighborhood: string | null = null;

    if (!SKIP_ENRICHMENT) {
      process.stdout.write(`   [${i + 1}/${buildings.length}] ${address} — looking up zoning/neighborhood...`);
      [zoningCode, neighborhood] = await Promise.all([
        lookupZoning(lat, lng),
        lookupNeighborhood(lat, lng),
      ]);
      process.stdout.write(` ${zoningCode ?? "?"} / ${neighborhood ?? "?"}\n`);
    }

    const rawAttributes = JSON.stringify({
      yearBuilt,
      bldgUse,
      source: "portland-arcgis",
    });

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
      rawAttributes,
    };

    if (DRY_RUN) {
      console.log(
        `  [DRY] ${address} | ${sqft ?? "?"}sqft | ${zoningCode ?? "?"} | ${neighborhood ?? "?"} | ${previousUse ?? "?"}`
      );
      created++;
      continue;
    }

    const existing = await prisma.space.findFirst({
      where: { address, city: "Portland, OR" },
    });

    if (existing) {
      await prisma.space.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.space.create({ data });
      created++;
    }
  }

  console.log("");
  console.log("✅ Done.");
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  if (!DRY_RUN) {
    console.log(`   Total spaces in DB: ${await prisma.space.count()}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌ Error:", e);
    prisma.$disconnect();
    process.exit(1);
  });
