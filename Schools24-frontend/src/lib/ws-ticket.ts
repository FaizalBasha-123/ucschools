import { api } from "@/lib/api";

type WSTicketResponse = {
  ticket: string;
  expires_in: number;
  scope: string;
  class_id?: string;
};

export function buildWsBaseUrl(): string {
  const wsBase = process.env.NEXT_PUBLIC_WS_BASE_URL?.replace(/\/+$/, "");
  if (wsBase) {
    return wsBase.replace(/^http/, "ws");
  }

  const publicApiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/+$/, "");
  if (publicApiOrigin) {
    return publicApiOrigin.replace(/^http/, "ws");
  }

  const backendOrigin = process.env.BACKEND_URL?.replace(/\/+$/, "");
  if (backendOrigin) {
    return backendOrigin.replace(/^http/, "ws");
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "/api/v1";
  if (apiUrl.startsWith("/")) {
    if (typeof window === "undefined") {
      return "";
    }

    return window.location.origin.replace(/^http/, "ws");
  }
  return apiUrl.replace(/^http/, "ws").replace(/\/api\/v1\/?$/, "");
}

export async function getWSTicket(scope: string, params?: Record<string, string | undefined>) {
  const search = new URLSearchParams({ scope });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return api.get<WSTicketResponse>(`/auth/ws-ticket?${search.toString()}`);
}
