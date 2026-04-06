import { NextRequest, NextResponse } from "next/server";

function getBackendBaseUrl(): string {
  const url = process.env.API_BASE_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:8081/api/v1" : "");
  return url.replace(/\/+$/, "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const base = getBackendBaseUrl();
  if (!base) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 500 });
  }
  const upstream = await fetch(`${base}/public/teacher-appointments/${encodeURIComponent(slug)}${req.nextUrl.search}`, {
    method: "GET",
    cache: "no-store",
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const base = getBackendBaseUrl();
  if (!base) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 500 });
  }

  const contentType = req.headers.get("content-type") || "";
  const body = await req.arrayBuffer();

  const upstream = await fetch(`${base}/public/teacher-appointments/${encodeURIComponent(slug)}${req.nextUrl.search}`, {
    method: "POST",
    headers: {
      "content-type": contentType,
    },
    body,
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
  });
}
