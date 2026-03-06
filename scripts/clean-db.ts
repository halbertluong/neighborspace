/**
 * One-time DB cleanup:
 * 1. Remove exact duplicates (same address + squareFeet)
 * 2. Remove spaces over 50,000 sqft (campuses, malls — not individual units)
 *
 * Run: DATABASE_URL="..." npx tsx scripts/clean-db.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.space.count({ where: { status: "active" } });
  console.log(`Before: ${before.toLocaleString()} active spaces`);

  // Step 1: Remove exact duplicates (same address + squareFeet, keep the one with a sourceId or the smallest createdAt)
  const dupes = await prisma.$queryRaw<{ keep_id: string }[]>`
    SELECT DISTINCT ON (address, COALESCE(square_feet, -1))
      id AS keep_id
    FROM "Space"
    WHERE status = 'active'
    ORDER BY address, COALESCE(square_feet, -1), source_id NULLS LAST, created_at ASC
  `;

  const keepIds = new Set(dupes.map((r) => r.keep_id));
  console.log(`Keeping ${keepIds.size.toLocaleString()} unique address+sqft combinations`);

  const dupeDeleted = await prisma.space.deleteMany({
    where: {
      status: "active",
      id: { notIn: Array.from(keepIds) },
    },
  });
  console.log(`Deleted ${dupeDeleted.count.toLocaleString()} duplicates`);

  // Step 2: Remove spaces over 50,000 sqft (campuses, hospitals, malls)
  const bigDeleted = await prisma.space.deleteMany({
    where: {
      status: "active",
      squareFeet: { gt: 50000 },
    },
  });
  console.log(`Deleted ${bigDeleted.count.toLocaleString()} oversized spaces (>50k sqft)`);

  const after = await prisma.space.count({ where: { status: "active" } });
  console.log(`After: ${after.toLocaleString()} active spaces`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
