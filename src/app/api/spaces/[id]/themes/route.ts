import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: spaceId } = await params;
    const themes = await prisma.theme.findMany({
      where: { spaceId },
      include: {
        _count: { select: { votes: true, ideas: true } },
      },
    });
    return NextResponse.json(themes);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch themes" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: spaceId } = await params;
    const body = await request.json();
    const { name, description } = body;
    if (!name) {
      return NextResponse.json({ error: "Theme name required" }, { status: 400 });
    }
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

    const theme = await prisma.theme.create({
      data: { spaceId, name, description: description ?? null },
    });
    return NextResponse.json(theme);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create theme" }, { status: 500 });
  }
}
