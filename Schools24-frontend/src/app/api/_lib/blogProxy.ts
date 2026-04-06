import { NextRequest, NextResponse } from "next/server";

function normalizeApiBase(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBackendBaseUrls(): string[] {
  const explicitApiBase = process.env.API_BASE_URL;
  if (explicitApiBase) {
    return [normalizeApiBase(explicitApiBase)];
  }

  const backendOrigin = process.env.BACKEND_URL;
  const resolved = new Set<string>();

  if (process.env.NODE_ENV !== "production") {
    resolved.add("http://localhost:8081/api/v1");
  }

  if (backendOrigin) {
    resolved.add(`${normalizeApiBase(backendOrigin)}/api/v1`);
  }

  return Array.from(resolved);
}

function copyHeaders(req: NextRequest): HeadersInit {
  const headers = new Headers();
  const auth = req.headers.get("authorization");
  const contentType = req.headers.get("content-type");
  const cookie = req.headers.get("cookie");
  const csrf = req.headers.get("x-csrf-token");

  if (auth) headers.set("authorization", auth);
  if (contentType) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (csrf) headers.set("x-csrf-token", csrf);

  return headers;
}

export async function proxyBlogRequest(req: NextRequest, path: string) {
  const bases = getBackendBaseUrls();
  if (bases.length === 0) {
    return NextResponse.json({ error: "backend_not_configured" }, { status: 500 });
  }

  const search = req.nextUrl.search || "";
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  let upstream: Response | null = null;
  let lastError: unknown = null;

  for (const base of bases) {
    try {
      upstream = await fetch(`${base}${path}${search}`, {
        method: req.method,
        headers: copyHeaders(req),
        body,
        cache: "no-store",
        redirect: "manual",
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!upstream) {
    return NextResponse.json(
      { error: "blog_proxy_unreachable", detail: lastError instanceof Error ? lastError.message : "Unable to reach upstream" },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const response = new NextResponse(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });

  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) {
    response.headers.set("set-cookie", setCookie);
  }

  return response;
}
