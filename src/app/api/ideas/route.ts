import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkFeasibility } from "@/lib/feasibility";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { spaceId, title, description, category, submitterName, submitterEmail } = body;
    if (!spaceId || !title || !description || !category) {
      return NextResponse.json(
        { error: "Missing spaceId, title, description, or category" },
        { status: 400 }
      );
    }
    const space = await prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

    const { feasible, message } = checkFeasibility(
      category,
      space.squareFeet ?? null,
      space.zoningCode ?? null
    );
    const feasibilityStatus = feasible ? "feasible" : "pending_review";

    const idea = await prisma.idea.create({
      data: {
        spaceId,
        title,
        description,
        category,
        submitterName: submitterName ?? null,
        submitterEmail: submitterEmail ?? null,
        feasibilityStatus,
      },
    });
    return NextResponse.json({ idea, feasibilityMessage: message });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create idea" }, { status: 500 });
  }
}
