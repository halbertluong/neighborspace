import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Mapillary v4 Graph API — free tier, ~50k req/month
// Sign up at https://www.mapillary.com/app/?login=true
// Create an app at https://www.mapillary.com/dashboard/developers
// Set MAPILLARY_ACCESS_TOKEN in .env.local

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = process.env.MAPILLARY_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Mapillary not configured" }, { status: 503 });
  }

  const { id } = await params;
  const space = await prisma.space.findUnique({
    where: { id },
    select: { lat: true, lng: true },
  });
  if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 });

  // Find the nearest image within 150m
  const apiUrl = new URL("https://graph.mapillary.com/images");
  apiUrl.searchParams.set("fields", "id,thumb_1024_url");
  apiUrl.searchParams.set("closeto", `${space.lng},${space.lat}`);
  apiUrl.searchParams.set("limit", "1");
  apiUrl.searchParams.set("radius", "150");
  apiUrl.searchParams.set("access_token", token);

  try {
    const metaRes = await fetch(apiUrl.toString());
    if (!metaRes.ok) {
      return new NextResponse(null, { status: 502 });
    }
    const meta = (await metaRes.json()) as {
      data?: { id: string; thumb_1024_url: string }[];
    };

    const imageUrl = meta.data?.[0]?.thumb_1024_url;
    if (!imageUrl) {
      return new NextResponse(null, { status: 404 });
    }

    // Proxy the image so the client doesn't need the token
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return new NextResponse(null, { status: 502 });

    const buf = await imgRes.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error("Mapillary error:", e);
    return new NextResponse(null, { status: 500 });
  }
}
