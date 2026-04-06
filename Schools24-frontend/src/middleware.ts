import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/register"];
const PUBLIC_FORM_PATHS = ["/teacher-appointment", "/admission"];
const PUBLIC_BLOG_PATHS = ["/blogs", "/blog"];
const PUBLIC_API_PREFIXES = ["/api/public"];
const ROLE_DASHBOARDS: Record<string, string> = {
  super_admin: "/super-admin",
  admin: "/admin/dashboard",
  teacher: "/teacher/dashboard",
  student: "/student/dashboard",
  staff: "/driver/tracking",
};

function getOrigin(envValue: string | undefined, localhostFallback: string): string {
  if (envValue) return envValue.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return localhostFallback;
  throw new Error("Required public origin env is missing");
}

const formsOrigin = getOrigin(process.env.NEXT_PUBLIC_FORMS_URL, "http://localhost:3000");
const dashOrigin = getOrigin(process.env.NEXT_PUBLIC_DASH_URL, "http://localhost:3000");
const FORMS_HOSTNAME = (() => {
  try {
    return new URL(formsOrigin).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
})();
const DASH_HOSTNAME = (() => {
  try {
    return new URL(dashOrigin).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
})();
const apiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL || "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();
const publicApiOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_PUBLIC_API_BASE || "";
  try {
    return raw ? new URL(raw).origin : "";
  } catch {
    return "";
  }
})();
const embedFrameAncestors =
  process.env.NEXT_PUBLIC_EMBED_FRAME_ANCESTORS || "'self' http://localhost:* https://localhost:*";

function isLocalHost(hostname: string) {
  return hostname.startsWith("localhost") || hostname.startsWith("127.0.0.1");
}

function isAuthPage(pathname: string) {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicFormPath(pathname: string) {
  return PUBLIC_FORM_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicBlogPath(pathname: string) {
  return PUBLIC_BLOG_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function withSecurityHeaders(response: NextResponse, request: NextRequest, opts: { embeddable: boolean }) {
  const isProd = process.env.NODE_ENV === "production";
  const connectSrc = ["'self'", "https:", "wss:"];
  if (apiOrigin) {
    connectSrc.push(apiOrigin);
  }
  if (publicApiOrigin && !connectSrc.includes(publicApiOrigin)) {
    connectSrc.push(publicApiOrigin);
  }

  const scriptSrc = isProd
    ? "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com";

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "object-src 'none'",
    "frame-src 'self' https://sketchfab.com",
    opts.embeddable ? `frame-ancestors ${embedFrameAncestors}` : "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Permissions-Policy", "geolocation=(self), microphone=(), camera=()");
  if (opts.embeddable) {
    response.headers.delete("X-Frame-Options");
  } else {
    response.headers.set("X-Frame-Options", "DENY");
  }
  response.headers.set("Vary", "Host, Cookie");
  return response;
}

function redirectTo(origin: string, request: NextRequest) {
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const publicForm = isPublicFormPath(pathname);
  const publicBlog = isPublicBlogPath(pathname);
  const publicApi = isPublicApiPath(pathname);
  const localHost = isLocalHost(hostname);

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return withSecurityHeaders(NextResponse.next(), request, { embeddable: false });
  }

  if (pathname.startsWith("/api")) {
    if (!localHost && hostname === FORMS_HOSTNAME && !publicApi) {
      return redirectTo(dashOrigin, request);
    }
    return withSecurityHeaders(NextResponse.next(), request, { embeddable: false });
  }

  if (!localHost && hostname === FORMS_HOSTNAME) {
    if (!publicForm && !publicApi) {
      return redirectTo(dashOrigin, request);
    }
    return withSecurityHeaders(NextResponse.next(), request, { embeddable: publicForm });
  }

  if (!localHost && hostname === DASH_HOSTNAME && publicForm) {
    return redirectTo(formsOrigin, request);
  }

  if (publicForm) {
    return withSecurityHeaders(NextResponse.next(), request, { embeddable: true });
  }

  if (publicBlog) {
    return withSecurityHeaders(NextResponse.next(), request, { embeddable: false });
  }

  const hasSession = request.cookies.get("School24_session")?.value === "1";
  const sessionRole =
    request.cookies.get("School24_role")?.value ||
    request.cookies.get("School24_last_role")?.value ||
    "";

  if (!hasSession && !isAuthPage(pathname)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("redirect", pathname);
    }
    return withSecurityHeaders(NextResponse.redirect(loginUrl), request, { embeddable: false });
  }

  if (hasSession && isAuthPage(pathname)) {
    const dashboard = ROLE_DASHBOARDS[sessionRole] || "/login";
    if (dashboard !== "/login") {
      return withSecurityHeaders(NextResponse.redirect(new URL(dashboard, request.url)), request, { embeddable: false });
    }
  }

  return withSecurityHeaders(NextResponse.next(), request, { embeddable: false });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
