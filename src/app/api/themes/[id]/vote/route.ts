import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

function getVoterId(request: NextRequest): string {
  const cookie = request.cookies.get("voter_id");
  if (cookie?.value) return cookie.value;
  return "anon-" + uuidv4();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: themeId } = await params;
    const voterId = getVoterId(request);
    const theme = await prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme) return NextResponse.json({ error: "Theme not found" }, { status: 404 });

    await prisma.themeVote.upsert({
      where: {
        themeId_voterId: { themeId, voterId },
      },
      create: { themeId, voterId },
      update: {},
    });
    const response = NextResponse.json({ ok: true });
    if (!request.cookies.get("voter_id"))
      response.cookies.set("voter_id", voterId, { httpOnly: true, maxAge: 60 * 60 * 24 * 365, path: "/" });
    return response;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to vote" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: themeId } = await params;
    const voterId = getVoterId(request);
    await prisma.themeVote.deleteMany({
      where: { themeId, voterId },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to remove vote" }, { status: 500 });
  }
}
