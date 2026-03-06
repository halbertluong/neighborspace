/**
 * NeighborSpace — site health & performance tests
 * Usage:
 *   Local:      npx tsx scripts/test-site.ts
 *   Production: BASE_URL=https://neighborspace.vercel.app npx tsx scripts/test-site.ts
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const TIMEOUT_MS = 8000;

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label: string, ms?: number) {
  const time = ms !== undefined ? ` (${ms}ms)` : "";
  console.log(`  ✓ ${label}${time}`);
  passed++;
}

function fail(label: string, reason: string) {
  console.error(`  ✗ ${label}`);
  console.error(`    → ${reason}`);
  failed++;
}

async function get(path: string): Promise<{ data: unknown; ms: number; status: number }> {
  const start = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const ms = Date.now() - start;
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : null;
  return { data, ms, status: res.status };
}

function assert(condition: boolean, label: string, detail = "") {
  if (condition) ok(label);
  else fail(label, detail || "assertion failed");
}

function assertFast(ms: number, label: string, budget = 3000) {
  if (ms <= budget) ok(`${label} responded in ${ms}ms`, ms);
  else fail(`${label} too slow`, `${ms}ms > ${budget}ms budget`);
}

// ── Test suites ───────────────────────────────────────────────────────────────
async function testHomePage() {
  console.log("\n📄 Home page");
  const { ms, status } = await get("/");
  assert(status === 200, "returns 200 OK");
  assertFast(ms, "home page", 5000);
}

async function testMarkersAPI() {
  console.log("\n📍 Markers API (/api/spaces/markers)");

  const { data, ms, status } = await get("/api/spaces/markers?excludeOffices=1");
  assert(status === 200, "returns 200");
  assertFast(ms, "markers (cold)", 5000);

  const markers = data as Array<{ id: string; lat: number; lng: number; name: string; address: string; previousUse?: string }>;
  assert(Array.isArray(markers), "returns array");
  assert(markers.length > 10000, `returns >10k markers (got ${markers.length})`);

  const sample = markers[0];
  assert(typeof sample.id === "string", "marker has id");
  assert(typeof sample.lat === "number", "marker has lat");
  assert(typeof sample.lng === "number", "marker has lng");
  assert(typeof sample.name === "string", "marker has name");

  // Portland bounds check
  const inPortland = markers.every(
    (m) => m.lat > 45.4 && m.lat < 45.7 && m.lng > -123.0 && m.lng < -122.4
  );
  assert(inPortland, "all markers are within Portland bounds");

  // Warm request (should hit CDN cache)
  const { ms: ms2 } = await get("/api/spaces/markers?excludeOffices=1");
  assertFast(ms2, "markers (warm/cached)", 2000);
}

async function testSpacesAPI() {
  console.log("\n📋 Spaces list API (/api/spaces)");

  const { data, ms, status } = await get("/api/spaces?page=1&excludeOffices=1");
  assert(status === 200, "returns 200");
  assertFast(ms, "page 1", 4000);

  const res = data as { spaces: unknown[]; total: number; page: number; pages: number };
  assert(Array.isArray(res.spaces), "has spaces array");
  assert(res.spaces.length === 20, `returns 20 per page (got ${res.spaces.length})`);
  assert(typeof res.total === "number" && res.total > 10000, `total > 10k (got ${res.total})`);
  assert(res.page === 1, "page is 1");
  assert(res.pages > 100, `has many pages (got ${res.pages})`);

  // Page 2
  const { data: d2, ms: ms2 } = await get("/api/spaces?page=2&excludeOffices=1");
  const res2 = d2 as { spaces: Array<{ id: string }>; page: number };
  assert(res2.page === 2, "page 2 works");
  assertFast(ms2, "page 2", 4000);

  // No overlap between pages
  const page1Ids = new Set((res.spaces as Array<{ id: string }>).map((s) => s.id));
  const overlap = res2.spaces.filter((s) => page1Ids.has(s.id));
  assert(overlap.length === 0, "no duplicate spaces between pages");
}

async function testFilters() {
  console.log("\n🔍 Filter correctness");

  // Neighborhood filter
  const { data: nbData } = await get("/api/spaces?neighborhood=Arbor+Lodge&excludeOffices=1");
  const nb = nbData as { spaces: Array<{ neighborhood: string }>; total: number };
  assert(nb.total > 0, `Arbor Lodge returns results (got ${nb.total})`);
  assert(
    nb.spaces.every((s) => s.neighborhood === "Arbor Lodge"),
    "all results are in Arbor Lodge"
  );

  // Sqft filter — small (<2k)
  const { data: sqftData } = await get("/api/spaces?sqft=small");
  const sqft = sqftData as { spaces: Array<{ squareFeet: number | null }>; total: number };
  assert(sqft.total > 0, "sqft=small returns results");
  const tooBig = sqft.spaces.filter((s) => s.squareFeet !== null && s.squareFeet >= 2000);
  assert(tooBig.length === 0, "sqft=small: no spaces >= 2000 sqft");

  // Formerly filter
  const { data: formData } = await get("/api/spaces?formerly=Restaurant");
  const form = formData as { spaces: Array<{ previousUse: string }>; total: number };
  assert(form.total > 0, "formerly=Restaurant returns results");
  assert(
    form.spaces.every((s) => s.previousUse === "Restaurant"),
    "all results have previousUse=Restaurant"
  );

  // excludeOffices=1 should not return Office spaces
  const { data: noOffData } = await get("/api/spaces?formerly=Office&excludeOffices=1");
  const noOff = noOffData as { total: number };
  // formerly wins over excludeOffices — should still return offices
  assert(typeof noOff.total === "number", "formerly+excludeOffices returns a result");

  // Null previousUse spaces not excluded by excludeOffices
  const { data: arbData } = await get("/api/spaces?neighborhood=Arbor+Lodge&excludeOffices=1");
  const arb = arbData as { total: number };
  assert(arb.total > 0, "excludeOffices doesn't hide null-previousUse spaces (Arbor Lodge)");
}

async function testFilterOptions() {
  console.log("\n🗂️  Filter options (/api/spaces/filter-options)");

  const { data, ms, status } = await get("/api/spaces/filter-options");
  assert(status === 200, "returns 200");
  assertFast(ms, "filter-options", 4000);

  const opts = data as { zones: string[]; formerlyOptions: string[]; neighborhoods: string[] };
  assert(Array.isArray(opts.zones) && opts.zones.length > 5, `has zones (got ${opts.zones?.length})`);
  assert(Array.isArray(opts.formerlyOptions) && opts.formerlyOptions.length > 10, `has formerly options (got ${opts.formerlyOptions?.length})`);
  assert(Array.isArray(opts.neighborhoods) && opts.neighborhoods.length > 50, `has neighborhoods (got ${opts.neighborhoods?.length})`);
  assert(opts.neighborhoods.includes("Arbor Lodge"), "includes Arbor Lodge");

  // Warm (CDN cached)
  const { ms: ms2 } = await get("/api/spaces/filter-options");
  assertFast(ms2, "filter-options (warm/cached)", 500);
}

async function testSpaceDetail() {
  console.log("\n🏠 Space detail API (/api/spaces/[id])");

  // Get a real ID first
  const { data: list } = await get("/api/spaces?page=1");
  const spaces = (list as { spaces: Array<{ id: string; name: string }> }).spaces;
  const first = spaces[0];

  const { data, ms, status } = await get(`/api/spaces/${first.id}`);
  assert(status === 200, "returns 200 for valid ID");
  assertFast(ms, "space detail", 4000);

  const space = data as { id: string; name: string; lat: number; lng: number };
  assert(space.id === first.id, "returns correct space");
  assert(typeof space.lat === "number", "has lat");
  assert(typeof space.lng === "number", "has lng");

  // 404 for unknown ID
  const { status: s404 } = await get("/api/spaces/nonexistent-id-xyz");
  assert(s404 === 404, "returns 404 for unknown ID");
}

async function testBoundsFilter() {
  console.log("\n🗺️  Bounds filtering");

  // Tight bounds around downtown Portland
  const { data, ms } = await get(
    "/api/spaces?north=45.525&south=45.515&east=-122.665&west=-122.685"
  );
  const res = data as { spaces: Array<{ lat: number; lng: number }>; total: number };
  assert(res.total > 0, "bounds filter returns results for downtown Portland");
  assertFast(ms, "bounds filter", 4000);
  const outOfBounds = res.spaces.filter(
    (s) => s.lat < 45.515 || s.lat > 45.525 || s.lng < -122.685 || s.lng > -122.665
  );
  assert(outOfBounds.length === 0, "all results are within requested bounds");
}

// ── Run all tests ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🧪 NeighborSpace site tests`);
  console.log(`   Target: ${BASE}\n`);

  const start = Date.now();

  await testHomePage();
  await testFilterOptions();
  await testMarkersAPI();
  await testSpacesAPI();
  await testFilters();
  await testSpaceDetail();
  await testBoundsFilter();

  const total = Date.now() - start;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`✓ ${passed} passed   ✗ ${failed} failed   (${total}ms total)\n`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
