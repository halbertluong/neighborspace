import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function sqftRange(bucket: string): { gte?: number; lte?: number } | null {
  if (bucket === "small")  return { lte: 1999 };
  if (bucket === "medium") return { gte: 2000, lte: 4999 };
  if (bucket === "large")  return { gte: 5000, lte: 14999 };
  if (bucket === "huge")   return { gte: 15000 };
  return null;
}

/**
 * Lightweight endpoint for map markers.
 * Returns only the fields the map needs — no address details, no photos.
 * Supports attribute filters but NOT bounds (map shows all filtered markers).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const zone              = searchParams.get("zone")              ?? "";
    const formerly          = searchParams.get("formerly")          ?? "";
    const neighborhoods     = searchParams.getAll("neighborhood");
    const sqft              = searchParams.get("sqft")              ?? "";
    const excludeOffices    = searchParams.get("excludeOffices")    === "1";
    const onlyVacant        = searchParams.get("onlyVacant")        === "1";

    const where: Record<string, unknown> = { status: "active" };
    if (zone)     where.zoningCode  = zone;
    if (formerly) where.previousUse = formerly;
    else if (excludeOffices) {
      // NOT: "Office" excludes NULL rows in SQL — explicitly include them
      where.OR = [{ previousUse: { not: "Office" } }, { previousUse: null }];
    }
    if (neighborhoods.length > 0) where.neighborhood = { in: neighborhoods };
    const sqftFilter = sqftRange(sqft);
    if (sqftFilter) where.squareFeet = sqftFilter;
    if (onlyVacant) where.occupancyStatus = "likely_vacant";

    const spaces = await prisma.space.findMany({
      where,
      select: {
        id:              true,
        lat:             true,
        lng:             true,
        name:            true,
        address:         true,
        previousUse:     true,
        occupancyStatus: true,
      },
    });

    const markers = spaces.map((s) => ({
      id:              s.id,
      lat:             s.lat,
      lng:             s.lng,
      name:            s.name,
      address:         s.address,
      previousUse:     s.previousUse,
      occupancyStatus: s.occupancyStatus,
    }));

    return NextResponse.json(markers, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
