import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Paginated spaces list.
 * Supports server-side bounds filtering + attribute filters.
 * Returns 20 spaces per page.
 */
function sqftRange(bucket: string): { gte?: number; lte?: number } | null {
  if (bucket === "small")  return { lte: 1999 };
  if (bucket === "medium") return { gte: 2000, lte: 4999 };
  if (bucket === "large")  return { gte: 5000, lte: 14999 };
  if (bucket === "huge")   return { gte: 15000 };
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page           = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit          = 20;
    const zone           = searchParams.get("zone")           ?? "";
    const formerly       = searchParams.get("formerly")       ?? "";
    const neighborhoods  = searchParams.getAll("neighborhood");
    const sqft           = searchParams.get("sqft")           ?? "";
    const excludeOffices = searchParams.get("excludeOffices") === "1";
    const onlyVacant     = searchParams.get("onlyVacant")     === "1";

    // Bounds from map viewport
    const north = parseFloat(searchParams.get("north") ?? "");
    const south = parseFloat(searchParams.get("south") ?? "");
    const east  = parseFloat(searchParams.get("east")  ?? "");
    const west  = parseFloat(searchParams.get("west")  ?? "");
    const hasBounds = [north, south, east, west].every((n) => !isNaN(n));

    const where: Record<string, unknown> = { status: "active" };

    if (hasBounds) {
      where.lat = { gte: south, lte: north };
      where.lng = { gte: west,  lte: east  };
    }
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

    const [total, spaces] = await Promise.all([
      prisma.space.count({ where }),
      prisma.space.findMany({
        where,
        orderBy: [
          { squareFeet: "desc" },
          { id: "asc" },
        ],
        skip:  (page - 1) * limit,
        take:  limit,
        select: {
          id:              true,
          name:            true,
          address:         true,
          neighborhood:    true,
          squareFeet:      true,
          zoningCode:      true,
          previousUse:     true,
          imageUrl:        true,
          lat:             true,
          lng:             true,
          occupancyStatus: true,
          rawAttributes:   true,
          _count: { select: { ideas: true, themes: true } },
        },
      }),
    ]);

    const spacesWithPmId = spaces.map(({ rawAttributes, ...s }) => {
      let portlandMapsId: string | null = null;
      try {
        if (rawAttributes) portlandMapsId = JSON.parse(rawAttributes).portlandMapsId ?? null;
      } catch { /* ignore */ }
      return { ...s, portlandMapsId };
    });

    return NextResponse.json({
      spaces: spacesWithPmId,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch spaces" }, { status: 500 });
  }
}
