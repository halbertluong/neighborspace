import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { themeId } = body;
    const idea = await prisma.idea.findUnique({ where: { id } });
    if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    if (themeId !== null) {
      const theme = await prisma.theme.findUnique({ where: { id: themeId } });
      if (!theme || theme.spaceId !== idea.spaceId) {
        return NextResponse.json({ error: "Theme not found or does not belong to this space" }, { status: 400 });
      }
    }
    const updated = await prisma.idea.update({
      where: { id },
      data: { themeId: themeId ?? null },
    });
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update idea" }, { status: 500 });
  }
}
