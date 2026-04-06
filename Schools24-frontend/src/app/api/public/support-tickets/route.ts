import { NextRequest, NextResponse } from "next/server";

function getBackendBaseUrl(): string {
  const url = process.env.API_BASE_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:8081/api/v1" : "");
  return url.replace(/\/+$/, "");
}

function getAllowedOrigins(): string[] {
  const raw = process.env.PUBLIC_SUPPORT_ALLOWED_ORIGINS;
  if (raw) {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return ["http://localhost:1000", "http://127.0.0.1:1000"];
}

function withCorsHeaders(response: NextResponse, origin: string | null) {
  const allowedOrigins = getAllowedOrigins();
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS(req: NextRequest) {
  return withCorsHeaders(new NextResponse(null, { status: 204 }), req.headers.get("origin"));
}

export async function POST(req: NextRequest) {
  const base = getBackendBaseUrl();
  const origin = req.headers.get("origin");

  if (!base) {
    return withCorsHeaders(
      NextResponse.json({ error: "backend_not_configured" }, { status: 500 }),
      origin,
    );
  }

  const contentType = req.headers.get("content-type") || "application/json";
  const body = await req.text();

  const upstream = await fetch(`${base}/public/support/tickets`, {
    method: "POST",
    headers: {
      "content-type": contentType,
    },
    body,
    cache: "no-store",
  });

  const text = await upstream.text();
  return withCorsHeaders(
    new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    }),
    origin,
  );
}
