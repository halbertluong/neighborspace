/**
 * Portland vacant commercial spaces ingestion stub.
 *
 * To use real data:
 * 1. Download Portland/Metro open data, e.g.:
 *    - Vacant and Developed Land: https://geo.btaa.org/catalog/2ce80461a32d4b2bb9ac8a4493b1e09c_0
 *    - Buildings (PDX): https://gis-pdx.opendata.arcgis.com/datasets/PDX::buildings/about
 *    - Zoning from PortlandMaps Open Data
 * 2. Export to GeoJSON or CSV with: address, lat, lng, square_feet, zoning_code, previous_use (if available).
 * 3. Place the file at data/portland-vacant.json (or set PORTLAND_DATA_PATH).
 * 4. Run: npx tsx scripts/ingest-portland.ts
 *
 * Example data/portland-vacant.json format:
 * [
 *   { "name": "...", "address": "...", "neighborhood": "...", "city": "Portland, OR", "lat": 45.52, "lng": -122.68, "squareFeet": 900, "zoningCode": "CM2", "previousUse": "Coffee shop" }
 * ]
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const DATA_PATH = process.env.PORTLAND_DATA_PATH || path.join(process.cwd(), "data", "portland-vacant.json");

type Row = {
  name?: string;
  address: string;
  neighborhood?: string;
  city?: string;
  lat: number;
  lng: number;
  squareFeet?: number;
  zoningCode?: string;
  previousUse?: string;
};

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.log("No data file at", DATA_PATH);
    console.log("Create data/portland-vacant.json or set PORTLAND_DATA_PATH. Using seed data only.");
    return;
  }
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const rows: Row[] = JSON.parse(raw);
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (!row.address || row.lat == null || row.lng == null) continue;
    const existing = await prisma.space.findFirst({
      where: { address: row.address, city: row.city ?? "Portland, OR" },
    });
    const data = {
      name: row.name || row.address,
      address: row.address,
      neighborhood: row.neighborhood ?? "",
      city: row.city ?? "Portland, OR",
      lat: row.lat,
      lng: row.lng,
      squareFeet: row.squareFeet ?? null,
      zoningCode: row.zoningCode ?? null,
      previousUse: row.previousUse ?? null,
    };
    if (existing) {
      await prisma.space.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.space.create({ data });
      created++;
    }
  }
  console.log("Ingested from", DATA_PATH, ":", created, "created,", updated, "updated.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
