/**
 * Fix Portland Maps IDs for WI/ building-code addresses.
 *
 * "WI/" addresses are secondary building addresses on a taxlot that has
 * different primary street addresses. We look up the taxlot's primary
 * address via the ArcGIS Address layer and geocode that instead.
 *
 * Run: DATABASE_URL="..." npx tsx scripts/enrich-portlandmaps-wi.ts
 * Dry: DRY_RUN=1 DATABASE_URL="..." npx tsx scripts/enrich-portlandmaps-wi.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN  = process.env.DRY_RUN === "1";
const BATCH    = 10;
const DELAY_MS = 300;

const ADDRESS_LAYER =
  "https://www.portlandmaps.com/od/rest/services/COP_OpenData_Property/MapServer/47/query";
const GEOCODER =
  "https://www.portlandmaps.com/arcgis/rest/services/Public/Address_Geocoding_PDX/GeocodeServer/findAddressCandidates";

async function getPrimaryAddresses(stateId: string): Promise<string[]> {
  const url = `${ADDRESS_LAYER}?where=STATE_ID%3D%27${encodeURIComponent(stateId)}%27&outFields=ADD_FULL&orderByFields=ADDRESS_ID+ASC&f=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const json = await res.json() as { features?: Array<{ attributes: { ADD_FULL: string } }> };
  return (json.features ?? []).map((f) => f.attributes.ADD_FULL).filter(Boolean);
}

type GeoCandidate = { score: number; attributes: { PROPERTY_ID?: string; STATE_ID?: string; Match_addr?: string } };

async function geocode(address: string): Promise<{ propertyId: string; stateId: string; matchAddr: string } | null> {
  const url = `${GEOCODER}?SingleLine=${encodeURIComponent(address)}&outFields=PROPERTY_ID,STATE_ID,Match_addr&f=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const json = await res.json() as { candidates?: GeoCandidate[] };
  const best = json.candidates?.find((c) => c.score >= 80 && c.attributes.PROPERTY_ID);
  if (!best) return null;
  return {
    propertyId: best.attributes.PROPERTY_ID!,
    stateId:    best.attributes.STATE_ID ?? "",
    matchAddr:  best.attributes.Match_addr ?? address,
  };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`\n🏚️  Portland Maps ID enrichment — WI/ addresses${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  // Load all WI/ spaces that still lack a portlandMapsId
  const spaces = await prisma.space.findMany({
    where: { status: "active" },
    select: { id: true, address: true, rawAttributes: true },
  });

  const wiSpaces = spaces.filter((s) => /[A-Z]{1,3}\//.test(s.address));
  const toProcess = wiSpaces.filter((s) => {
    try { return !JSON.parse(s.rawAttributes ?? "{}").portlandMapsId; }
    catch { return true; }
  });

  console.log(`WI/ spaces total:    ${wiSpaces.length}`);
  console.log(`Still need ID:       ${toProcess.length}`);
  console.log();

  let updated = 0, failed = 0;

  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);

    await Promise.all(batch.map(async (s) => {
      const raw = JSON.parse(s.rawAttributes ?? "{}");
      const stateId = raw.stateId as string | undefined;

      if (!stateId) { failed++; return; }

      // Step 1: get primary addresses on this taxlot
      const primaryAddrs = await getPrimaryAddresses(stateId);

      // Step 2: geocode each primary address; prefer one whose STATE_ID matches
      let bestId: string | null = null;
      let bestAddr: string | null = null;

      for (const addr of primaryAddrs) {
        const match = await geocode(addr);
        if (!match) continue;
        if (match.stateId === stateId) {
          // Perfect — same taxlot
          bestId   = match.propertyId;
          bestAddr = match.matchAddr;
          break;
        }
        // Keep as fallback even if state_id differs (different unit, same lot)
        if (!bestId) { bestId = match.propertyId; bestAddr = match.matchAddr; }
      }

      if (!bestId) { failed++; return; }

      raw.portlandMapsId = bestId;
      raw.portlandMapsMatchAddr = bestAddr;
      raw.portlandMapsViaAltAddr = true; // flag: linked via taxlot primary address

      if (!DRY_RUN) {
        await prisma.space.update({
          where: { id: s.id },
          data: { rawAttributes: JSON.stringify(raw) },
        });
      }
      updated++;
    }));

    process.stdout.write(
      `\r  ${Math.min(i + BATCH, toProcess.length)} / ${toProcess.length}  ` +
      `updated=${updated}  failed=${failed}   `
    );
    if (i + BATCH < toProcess.length) await sleep(DELAY_MS);
  }

  console.log("\n");
  console.log(`✓ Updated: ${updated}`);
  console.log(`✗ Failed:  ${failed} (no taxlot addresses found)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
