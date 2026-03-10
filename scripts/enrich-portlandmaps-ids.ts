/**
 * Enrich spaces with Portland Maps PROPERTY_ID via the public geocoding API.
 *
 * For each space, calls:
 *   portlandmaps.com/arcgis/rest/services/Public/Address_Geocoding_PDX/GeocodeServer/findAddressCandidates
 * which returns PROPERTY_ID (e.g. "R301368") — the ID needed to link directly to
 *   portlandmaps.com/detail/property/{slug}/{PROPERTY_ID}_did/
 *
 * Stores the result in rawAttributes.portlandMapsId
 *
 * Run: DATABASE_URL="..." npx tsx scripts/enrich-portlandmaps-ids.ts
 * Dry: DRY_RUN=1 DATABASE_URL="..." npx tsx scripts/enrich-portlandmaps-ids.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN  = process.env.DRY_RUN === "1";
const BATCH    = 20;  // concurrent geocoder requests
const DELAY_MS = 200; // ms between batches (be polite)

const GEOCODER =
  "https://www.portlandmaps.com/arcgis/rest/services/Public/Address_Geocoding_PDX/GeocodeServer/findAddressCandidates";

type GeocandiDate = {
  score: number;
  attributes: { PROPERTY_ID?: string; Match_addr?: string };
};

async function geocode(address: string): Promise<{ propertyId: string; matchAddr: string } | null> {
  try {
    const url = `${GEOCODER}?SingleLine=${encodeURIComponent(address)}&outFields=PROPERTY_ID,Match_addr&f=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = await res.json() as { candidates?: GeocandiDate[] };
    const best = json.candidates?.find((c) => c.score >= 80 && c.attributes.PROPERTY_ID);
    if (!best) return null;
    return {
      propertyId: best.attributes.PROPERTY_ID!,
      matchAddr:  best.attributes.Match_addr ?? address,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processBatch(
  spaces: Array<{ id: string; address: string; rawAttributes: string | null }>
): Promise<{ updated: number; skipped: number; failed: number }> {
  const results = await Promise.all(
    spaces.map(async (s) => {
      // Skip if already has portlandMapsId
      const raw = s.rawAttributes ? JSON.parse(s.rawAttributes) : {};
      if (raw.portlandMapsId) return "skipped" as const;

      const match = await geocode(s.address);
      if (!match) return "failed" as const;

      raw.portlandMapsId = match.propertyId;
      raw.portlandMapsMatchAddr = match.matchAddr;

      if (!DRY_RUN) {
        await prisma.space.update({
          where: { id: s.id },
          data: { rawAttributes: JSON.stringify(raw) },
        });
      }
      return "updated" as const;
    })
  );

  return {
    updated: results.filter((r) => r === "updated").length,
    skipped: results.filter((r) => r === "skipped").length,
    failed:  results.filter((r) => r === "failed").length,
  };
}

async function main() {
  console.log(`\n📍 Portland Maps ID enrichment${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const spaces = await prisma.space.findMany({
    where: { status: "active" },
    select: { id: true, address: true, rawAttributes: true },
  });

  const alreadyDone = spaces.filter((s) => {
    try { return s.rawAttributes && JSON.parse(s.rawAttributes).portlandMapsId; }
    catch { return false; }
  }).length;

  console.log(`Total spaces:      ${spaces.length.toLocaleString()}`);
  console.log(`Already enriched:  ${alreadyDone.toLocaleString()}`);
  console.log(`To process:        ${(spaces.length - alreadyDone).toLocaleString()}`);
  console.log();

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed  = 0;

  for (let i = 0; i < spaces.length; i += BATCH) {
    const batch = spaces.slice(i, i + BATCH);
    const { updated, skipped, failed } = await processBatch(batch);
    totalUpdated += updated;
    totalSkipped += skipped;
    totalFailed  += failed;

    const done = Math.min(i + BATCH, spaces.length);
    process.stdout.write(
      `\r  ${done.toLocaleString()} / ${spaces.length.toLocaleString()}  ` +
      `updated=${totalUpdated}  skipped=${totalSkipped}  failed=${totalFailed}   `
    );

    if (i + BATCH < spaces.length) await sleep(DELAY_MS);
  }

  console.log("\n");
  console.log(`✓ Updated: ${totalUpdated.toLocaleString()}`);
  console.log(`⊘ Skipped: ${totalSkipped.toLocaleString()} (already had ID)`);
  console.log(`✗ Failed:  ${totalFailed.toLocaleString()} (no geocoder match)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
