/**
 * Occupancy enrichment via Google Places + Yelp Fusion APIs
 *
 * Only processes spaces currently marked "likely_vacant" and upgrades them
 * to "occupied" when an active business is found nearby. Never downgrades.
 *
 * Sources (any combination, based on available keys):
 *   1. Google Places Nearby Search  — requires GOOGLE_MAPS_API_KEY
 *   2. Yelp Fusion Business Search  — requires YELP_API_KEY
 *      Note: Yelp free tier is 500 req/day — use YELP_ENABLE=1 to opt in
 *   3. OpenStreetMap Overpass       — always runs, free, no key needed
 *
 * Run:
 *   DATABASE_URL="..." GOOGLE_MAPS_API_KEY="..." npx tsx scripts/enrich-occupancy-places.ts
 *
 * With Yelp:
 *   DATABASE_URL="..." GOOGLE_MAPS_API_KEY="..." YELP_API_KEY="..." YELP_ENABLE=1 npx tsx scripts/enrich-occupancy-places.ts
 *
 * Dry run (no DB writes):
 *   DRY_RUN=1 DATABASE_URL="..." GOOGLE_MAPS_API_KEY="..." npx tsx scripts/enrich-occupancy-places.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const YELP_KEY = process.env.YELP_API_KEY ?? "";
const YELP_ENABLE = process.env.YELP_ENABLE === "1";

// How close (meters) a business must be to count as occupying the space
const MATCH_RADIUS_M = 40;

// Delay between API calls to respect rate limits (ms)
const GOOGLE_DELAY_MS = 150; // ~6 req/s → well under 600/min limit
const YELP_DELAY_MS = 500;   // 500 req/day → be conservative

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

// ── OpenStreetMap Overpass (fallback, free) ───────────────────────────────────

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
}

function checkOsm(points: OsmPoint[], lat: number, lng: number): boolean {
  // Simple linear scan — fine for per-space lookup after bulk fetch
  for (const p of points) {
    if (haversine(lat, lng, p.lat, p.lng) <= MATCH_RADIUS_M) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Cross-reference enrichment${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Match radius: ${MATCH_RADIUS_M}m`);
  console.log(`   Google Places: ${GOOGLE_KEY ? "✓ enabled" : "✗ no key (set GOOGLE_MAPS_API_KEY)"}`);
  console.log(`   Yelp Fusion:   ${YELP_KEY && YELP_ENABLE ? "✓ enabled" : YELP_KEY ? "⚠ key set but YELP_ENABLE=1 not set" : "✗ no key (set YELP_API_KEY + YELP_ENABLE=1)"}`);
  console.log(`   OSM Overpass:  ✓ always enabled\n`);

  if (!GOOGLE_KEY) {
    console.warn("⚠  No GOOGLE_MAPS_API_KEY — results will rely on OSM only (same as existing script).");
    console.warn("   Set GOOGLE_MAPS_API_KEY for much better coverage.\n");
  }

  // Load only likely_vacant spaces — we never downgrade occupied → vacant
  const spaces = await prisma.space.findMany({
    where: { status: "active", occupancyStatus: "likely_vacant" },
    select: { id: true, lat: true, lng: true, address: true, neighborhood: true },
    orderBy: { address: "asc" },
  });

  console.log(`Found ${spaces.length.toLocaleString()} "likely_vacant" spaces to check\n`);

  if (spaces.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // Pre-fetch OSM data (one bulk request, much faster than per-space queries)
  const osmPoints = await fetchOsmBusinesses();

  // Process each space
  const toMarkOccupied: Array<{ id: string; address: string; source: string; bizName: string }> = [];
  let googleChecked = 0;
  let yelpChecked = 0;
  let errorCount = 0;

  for (let i = 0; i < spaces.length; i++) {
    const space = spaces[i];
    const progress = `[${i + 1}/${spaces.length}]`;

    let foundBy: string | null = null;
    let bizName = "";

    // 1. OSM check (instant — data already fetched)
    if (checkOsm(osmPoints, space.lat, space.lng)) {
      foundBy = "OSM";
      bizName = "(OSM match)";
    }

    // 2. Google Places (if not already found)
    if (!foundBy && GOOGLE_KEY) {
      try {
        await sleep(GOOGLE_DELAY_MS);
        const hit = await checkGooglePlaces(space.lat, space.lng);
        googleChecked++;
        if (hit) {
          foundBy = "Google Places";
          bizName = hit.name;
        }
      } catch (e) {
        errorCount++;
        console.warn(`  ${progress} Google error for ${space.address}: ${(e as Error).message}`);
      }
    }

    // 3. Yelp (if not already found and enabled)
    if (!foundBy && YELP_KEY && YELP_ENABLE) {
      try {
        await sleep(YELP_DELAY_MS);
        const hit = await checkYelp(space.lat, space.lng);
        yelpChecked++;
        if (hit) {
          foundBy = "Yelp";
          bizName = hit.name;
        }
      } catch (e) {
        errorCount++;
        console.warn(`  ${progress} Yelp error for ${space.address}: ${(e as Error).message}`);
      }
    }

    if (foundBy) {
      console.log(`  ${progress} OCCUPIED  ${space.address} — "${bizName}" (via ${foundBy})`);
      toMarkOccupied.push({ id: space.id, address: space.address, source: foundBy, bizName });
    } else {
      // Only log every 50 to avoid flooding the console
      if (i % 50 === 0 || i === spaces.length - 1) {
        process.stdout.write(`\r  ${progress} scanning... (${toMarkOccupied.length} occupied so far)    `);
      }
    }
  }

  console.log(`\n\n── Results ─────────────────────────────────────────────────────`);
  console.log(`  Spaces checked:         ${spaces.length.toLocaleString()}`);
  console.log(`  Google queries made:    ${googleChecked.toLocaleString()}`);
  console.log(`  Yelp queries made:      ${yelpChecked.toLocaleString()}`);
  console.log(`  API errors:             ${errorCount.toLocaleString()}`);
  console.log(`  Found occupied:         ${toMarkOccupied.length.toLocaleString()}`);
  console.log(`  Remaining likely_vacant: ${(spaces.length - toMarkOccupied.length).toLocaleString()}`);

  if (toMarkOccupied.length === 0) {
    console.log("\nNo new occupied spaces found — database unchanged.");
    return;
  }

  if (DRY_RUN) {
    console.log("\n🚫 Dry run — no DB writes. Spaces that would be marked occupied:");
    for (const s of toMarkOccupied) {
      console.log(`   ${s.address}  [${s.source}] "${s.bizName}"`);
    }
    return;
  }

  // Write updates in batches of 100
  console.log(`\nWriting ${toMarkOccupied.length} updates to DB...`);
  const BATCH = 100;
  for (let i = 0; i < toMarkOccupied.length; i += BATCH) {
    const batch = toMarkOccupied.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((u) =>
        prisma.space.update({
          where: { id: u.id },
          data: { occupancyStatus: "occupied" },
        })
      )
    );
    process.stdout.write(`\r  ${Math.min(i + BATCH, toMarkOccupied.length)} / ${toMarkOccupied.length}`);
  }

  console.log(`\n\n✅ Done — ${toMarkOccupied.length} spaces updated from "likely_vacant" → "occupied"`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
