import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        ideas: { orderBy: { createdAt: "desc" } },
        themes: {
          include: {
            _count: { select: { votes: true } },
            ideas: true,
          },
        },
        pledges: { where: { status: "pledged" } },
      },
    });
    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });
    const totalPledgedCents = space.pledges.reduce((s, p) => s + p.amountCents, 0);
    let portlandMapsId: string | null = null;
    let portlandMapsLinkAddress: string | null = null;
    try {
      if (space.rawAttributes) {
        const raw = JSON.parse(space.rawAttributes);
        portlandMapsId = raw.portlandMapsId ?? null;
        if (raw.portlandMapsViaAltAddr && raw.portlandMapsMatchAddr) {
          portlandMapsLinkAddress = raw.portlandMapsMatchAddr.split(",")[0].trim();
        }
      }
    } catch { /* ignore */ }
    return NextResponse.json({
      ...space,
      totalPledgedCents,
      portlandMapsId,
      portlandMapsLinkAddress,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch space" }, { status: 500 });
  }
}
