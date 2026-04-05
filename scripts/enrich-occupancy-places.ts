/**
 * Occupancy enrichment via Google Places + Yelp Fusion APIs
 *
 * Designed to run daily. Each run processes up to BATCH_LIMIT spaces
 * (default 490 to stay within Yelp's 500 req/day free tier), always
 * picking the least-recently-checked spaces first so the full dataset
 * rotates evenly over time.
 *
 * Only upgrades spaces to "occupied" — never downgrades.
 * Stamps `yelp_checked_at` on every processed space so the next run
 * picks up where this one left off.
 *
 * Sources (any combination, based on available env vars):
 *   1. OpenStreetMap Overpass  — always runs, free, no key needed
 *   2. Google Places Nearby    — requires GOOGLE_MAPS_API_KEY
 *   3. Yelp Fusion Search      — requires YELP_API_KEY + YELP_ENABLE=1
 *
 * Run:
 *   DATABASE_URL="..." GOOGLE_MAPS_API_KEY="..." YELP_API_KEY="..." YELP_ENABLE=1 \
 *     npx tsx scripts/enrich-occupancy-places.ts
 *
 * Dry run (no DB writes):
 *   DRY_RUN=1 DATABASE_URL="..." ... npx tsx scripts/enrich-occupancy-places.ts
 *
 * Limit batch size:
 *   BATCH_LIMIT=100 DATABASE_URL="..." ... npx tsx scripts/enrich-occupancy-places.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const YELP_KEY = process.env.YELP_API_KEY ?? "";
const YELP_ENABLE = process.env.YELP_ENABLE === "1";

// Max spaces to process this run — default 490 to stay under Yelp's 500/day cap
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT ?? "490", 10);

// How close (meters) a business must be to count as occupying the space
const MATCH_RADIUS_M = 40;

// Concurrent API calls per mini-batch (Google allows ~10 req/s on free tier)
const CONCURRENCY = 8;

// Portland bounding box for OSM fallback
const BBOX = "45.43,-122.84,45.65,-122.47";

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

// ── Google Places Nearby Search ───────────────────────────────────────────────

type GooglePlace = { name: string; vicinity: string };

async function checkGooglePlaces(lat: number, lng: number): Promise<GooglePlace | null> {
  if (!GOOGLE_KEY) return null;
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}&radius=${MATCH_RADIUS_M}&key=${GOOGLE_KEY}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  type GoogleResponse = {
    status: string;
    results: Array<{ name: string; vicinity: string }>;
  };
  const json = (await res.json()) as GoogleResponse;
  if (json.status !== "OK" || json.results.length === 0) return null;

  const hit = json.results[0];
  return { name: hit.name, vicinity: hit.vicinity };
}

// ── Yelp Fusion Business Search ───────────────────────────────────────────────

type YelpBusiness = { name: string; location: { address1: string } };

async function checkYelp(lat: number, lng: number): Promise<YelpBusiness | null> {
  if (!YELP_KEY || !YELP_ENABLE) return null;
  const url =
    `https://api.yelp.com/v3/businesses/search` +
    `?latitude=${lat}&longitude=${lng}&radius=${MATCH_RADIUS_M}&limit=1&sort_by=distance`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${YELP_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  type YelpResponse = {
    businesses: Array<{ name: string; location: { address1: string }; distance: number }>;
  };
  const json = (await res.json()) as YelpResponse;
  if (!json.businesses || json.businesses.length === 0) return null;

  const biz = json.businesses[0];
  // Yelp radius filter isn't exact — double-check distance
  if (biz.distance > MATCH_RADIUS_M) return null;

  return { name: biz.name, location: biz.location };
}

// ── OpenStreetMap Overpass (bulk fetch, free) ─────────────────────────────────

type OsmPoint = { lat: number; lng: number };

async function fetchOsmBusinesses(): Promise<OsmPoint[]> {
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

  console.log("  Fetching OSM businesses (Overpass API)...");
  try {
    const res = await fetch("https://overpass.openstreetmap.fr/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      console.warn(`  Overpass API returned ${res.status} — skipping OSM check`);
      return [];
    }

    type OverpassResponse = {
      elements: Array<{
        type: string;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
      }>;
    };

    const json = (await res.json()) as OverpassResponse;
    const points: OsmPoint[] = [];
    for (const el of json.elements) {
      if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
        points.push({ lat: el.lat, lng: el.lon });
      } else if (el.type === "way" && el.center) {
        points.push({ lat: el.center.lat, lng: el.center.lon });
      }
    }
    console.log(`  ✓ ${points.length.toLocaleString()} OSM business points`);
    return points;
  } catch {
    console.warn("  Overpass API unreachable — skipping OSM check");
    return [];
  }
}

function checkOsm(points: OsmPoint[], lat: number, lng: number): boolean {
  for (const p of points) {
    if (haversine(lat, lng, p.lat, p.lng) <= MATCH_RADIUS_M) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Cross-reference enrichment${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Match radius:  ${MATCH_RADIUS_M}m`);
  console.log(`   Batch limit:   ${BATCH_LIMIT} spaces`);
  console.log(`   Google Places: ${GOOGLE_KEY ? "✓ enabled" : "✗ no key"}`);
  console.log(`   Yelp Fusion:   ${YELP_KEY && YELP_ENABLE ? "✓ enabled" : YELP_KEY ? "⚠ key set but YELP_ENABLE=1 not set" : "✗ disabled"}`);
  console.log(`   OSM Overpass:  ✓ always enabled\n`);

  // Count total likely_vacant spaces for context
  const totalVacant = await prisma.space.count({
    where: { status: "active", occupancyStatus: "likely_vacant" },
  });

  // Load the least-recently-checked likely_vacant spaces first (NULLS FIRST = never checked)
  // This ensures even rotation — each daily run picks up where the last left off.
  const spaces = await prisma.space.findMany({
    where: { status: "active", occupancyStatus: "likely_vacant" },
    select: { id: true, lat: true, lng: true, address: true, neighborhood: true, yelpCheckedAt: true },
    orderBy: { yelpCheckedAt: "asc" },
    take: BATCH_LIMIT,
  });

  const neverChecked = spaces.filter((s) => s.yelpCheckedAt === null).length;
  const oldestDate = spaces.find((s) => s.yelpCheckedAt !== null)?.yelpCheckedAt;

  console.log(`Total "likely_vacant" spaces: ${totalVacant.toLocaleString()}`);
  console.log(`This batch:  ${spaces.length.toLocaleString()} spaces`);
  console.log(`  • Never checked:   ${neverChecked}`);
  if (oldestDate) {
    console.log(`  • Oldest checked:  ${oldestDate.toISOString().slice(0, 10)}`);
  }
  if (totalVacant > BATCH_LIMIT) {
    const daysRemaining = Math.ceil(totalVacant / BATCH_LIMIT);
    console.log(`  • Full cycle time: ~${daysRemaining} days at ${BATCH_LIMIT}/day\n`);
  } else {
    console.log(`  • Full dataset fits in one run\n`);
  }

  if (spaces.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Pre-fetch OSM data (one bulk request covers all spaces)
  const osmPoints = await fetchOsmBusinesses();

  const toMarkOccupied: Array<{ id: string; address: string; source: string; bizName: string }> = [];
  const checkedIds: string[] = [];
  let googleChecked = 0;
  let yelpChecked = 0;
  let errorCount = 0;
  let processed = 0;

  for (let batchStart = 0; batchStart < spaces.length; batchStart += CONCURRENCY) {
    const batch = spaces.slice(batchStart, batchStart + CONCURRENCY);

    await Promise.all(batch.map(async (space) => {
      let foundBy: string | null = null;
      let bizName = "";

      // 1. OSM check (in-memory, instant)
      if (checkOsm(osmPoints, space.lat, space.lng)) {
        foundBy = "OSM";
        bizName = "(OSM match)";
      }

      // 2. Google Places
      if (!foundBy && GOOGLE_KEY) {
        try {
          const hit = await checkGooglePlaces(space.lat, space.lng);
          googleChecked++;
          if (hit) { foundBy = "Google Places"; bizName = hit.name; }
        } catch {
          errorCount++;
        }
      }

      // 3. Yelp
      if (!foundBy && YELP_KEY && YELP_ENABLE && yelpChecked < BATCH_LIMIT) {
        try {
          const hit = await checkYelp(space.lat, space.lng);
          yelpChecked++;
          if (hit) { foundBy = "Yelp"; bizName = hit.name; }
        } catch {
          errorCount++;
        }
      }

      processed++;
      checkedIds.push(space.id);

      if (foundBy) {
        console.log(`  OCCUPIED  ${space.address} — "${bizName}" (via ${foundBy})`);
        toMarkOccupied.push({ id: space.id, address: space.address, source: foundBy, bizName });
      }
    }));

    if (batchStart + CONCURRENCY < spaces.length) await sleep(100);

    process.stdout.write(`\r  Progress: ${processed}/${spaces.length} (${toMarkOccupied.length} occupied)   `);
  }

  console.log(`\n\n── Results ─────────────────────────────────────────────────────`);
  console.log(`  Spaces checked:         ${spaces.length.toLocaleString()}`);
  console.log(`  Google queries:         ${googleChecked.toLocaleString()}`);
  console.log(`  Yelp queries:           ${yelpChecked.toLocaleString()}`);
  console.log(`  API errors:             ${errorCount.toLocaleString()}`);
  console.log(`  Found occupied:         ${toMarkOccupied.length.toLocaleString()}`);
  console.log(`  Remaining likely_vacant: ${(totalVacant - toMarkOccupied.length).toLocaleString()}`);

  if (DRY_RUN) {
    console.log("\n🚫 Dry run — no DB writes. Spaces that would be marked occupied:");
    for (const s of toMarkOccupied) {
      console.log(`   ${s.address}  [${s.source}] "${s.bizName}"`);
    }
    return;
  }

  const now = new Date();
  const WRITE_BATCH = 100;

  // Stamp yelpCheckedAt on all processed spaces (even those not found occupied)
  // This ensures next run picks up fresh spaces instead of re-checking these.
  console.log(`\nStamping ${checkedIds.length} spaces with yelpCheckedAt = now...`);
  for (let i = 0; i < checkedIds.length; i += WRITE_BATCH) {
    const ids = checkedIds.slice(i, i + WRITE_BATCH);
    await prisma.space.updateMany({
      where: { id: { in: ids } },
      data: { yelpCheckedAt: now },
    });
    process.stdout.write(`\r  ${Math.min(i + WRITE_BATCH, checkedIds.length)} / ${checkedIds.length}`);
  }

  // Mark occupied spaces
  if (toMarkOccupied.length > 0) {
    console.log(`\nMarking ${toMarkOccupied.length} spaces as "occupied"...`);
    for (let i = 0; i < toMarkOccupied.length; i += WRITE_BATCH) {
      const batch = toMarkOccupied.slice(i, i + WRITE_BATCH);
      await prisma.$transaction(
        batch.map((u) =>
          prisma.space.update({
            where: { id: u.id },
            data: { occupancyStatus: "occupied" },
          })
        )
      );
      process.stdout.write(`\r  ${Math.min(i + WRITE_BATCH, toMarkOccupied.length)} / ${toMarkOccupied.length}`);
    }
  }

  console.log(`\n\n✅ Done — ${toMarkOccupied.length} spaces upgraded to "occupied", ${checkedIds.length} stamps written`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
