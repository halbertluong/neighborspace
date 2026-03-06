import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Returns distinct filter values for the filter panel dropdowns.
 * Called once on mount — values rarely change.
 */
export async function GET() {
  try {
    const [zoneRows, formerlyRows, neighborhoodRows] = await Promise.all([
      prisma.space.findMany({
        where: { status: "active", zoningCode: { not: null } },
        select: { zoningCode: true },
        distinct: ["zoningCode"],
        orderBy: { zoningCode: "asc" },
      }),
      prisma.space.findMany({
        where: { status: "active", previousUse: { not: null } },
        select: { previousUse: true },
        distinct: ["previousUse"],
        orderBy: { previousUse: "asc" },
      }),
      prisma.space.findMany({
        where: { status: "active", neighborhood: { not: "" } },
        select: { neighborhood: true },
        distinct: ["neighborhood"],
        orderBy: { neighborhood: "asc" },
      }),
    ]);

    return NextResponse.json({
      zones:            zoneRows.map((r) => r.zoningCode).filter(Boolean) as string[],
      formerlyOptions:  formerlyRows.map((r) => r.previousUse).filter(Boolean) as string[],
      neighborhoods:    neighborhoodRows.map((r) => r.neighborhood).filter(Boolean) as string[],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ zones: [], formerlyOptions: [], neighborhoods: [] });
  }
}
