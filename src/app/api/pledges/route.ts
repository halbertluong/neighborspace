import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { themeId, spaceId, amountCents, pledgerName, pledgerEmail } = body;
    if (!themeId || !spaceId || amountCents == null || !pledgerName || !pledgerEmail) {
      return NextResponse.json(
        { error: "Missing themeId, spaceId, amountCents, pledgerName, or pledgerEmail" },
        { status: 400 }
      );
    }
    const amount = parseInt(String(amountCents), 10);
    if (isNaN(amount) || amount < 100) {
      return NextResponse.json(
        { error: "Pledge must be at least $1 (100 cents)" },
        { status: 400 }
      );
    }
    const theme = await prisma.theme.findUnique({ where: { id: themeId } });
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!theme || !space || theme.spaceId !== spaceId) {
      return NextResponse.json({ error: "Theme or space not found" }, { status: 404 });
    }

    const pledge = await prisma.pledge.create({
      data: {
        themeId,
        spaceId,
        amountCents: amount,
        pledgerName,
        pledgerEmail,
      },
    });
    return NextResponse.json(pledge);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create pledge" }, { status: 500 });
  }
}
