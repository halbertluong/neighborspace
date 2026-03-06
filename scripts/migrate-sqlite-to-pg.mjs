/**
 * One-time migration: copy all spaces from local SQLite → Neon Postgres
 * Run with: DATABASE_URL="..." node scripts/migrate-sqlite-to-pg.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

const BATCH = 500;

const sqlite = new DatabaseSync("prisma/dev.db");
const prisma = new PrismaClient();

const rows = sqlite.prepare(`
  SELECT id, source_id, name, address, neighborhood, city,
         lat, lng, square_feet, zoning_code, previous_use,
         image_url, raw_attributes, status, synced_at,
         created_at, updated_at
  FROM Space WHERE status = 'active'
`).all();

console.log(`Migrating ${rows.length} spaces to Neon…`);

let created = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await prisma.$transaction(
    batch.map((r) =>
      prisma.space.upsert({
        where: { id: r.id },
        update: {},
        create: {
          id:            r.id,
          sourceId:      r.source_id ?? undefined,
          name:          r.name,
          address:       r.address,
          neighborhood:  r.neighborhood ?? "",
          city:          r.city ?? "Portland, OR",
          lat:           r.lat,
          lng:           r.lng,
          squareFeet:    r.square_feet ?? undefined,
          zoningCode:    r.zoning_code ?? undefined,
          previousUse:   r.previous_use ?? undefined,
          imageUrl:      r.image_url ?? undefined,
          rawAttributes: r.raw_attributes ?? undefined,
          status:        r.status ?? "active",
          syncedAt:      r.synced_at ? new Date(r.synced_at) : undefined,
          createdAt:     r.created_at ? new Date(r.created_at) : undefined,
        },
      })
    )
  );
  created += batch.length;
  console.log(`  ${created}/${rows.length}`);
}

console.log("Done.");
await prisma.$disconnect();
sqlite.close();
