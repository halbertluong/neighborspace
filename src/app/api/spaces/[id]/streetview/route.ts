import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const STREETVIEW_SIZE = "640x360";
const STREETVIEW_FOV = 90;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Street View not configured (missing GOOGLE_MAPS_API_KEY)" },
      { status: 503 }
    );
  }
  try {
    const { id } = await params;
    const space = await prisma.space.findUnique({
      where: { id },
      select: { lat: true, lng: true },
    });
    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

    const location = `${space.lat},${space.lng}`;
    const url = new URL("https://maps.googleapis.com/maps/api/streetview");
    url.searchParams.set("size", STREETVIEW_SIZE);
    url.searchParams.set("location", location);
    url.searchParams.set("fov", String(STREETVIEW_FOV));
    url.searchParams.set("source", "outdoor");
    url.searchParams.set("return_error_code", "true");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch street view" }, { status: 500 });
  }
}
