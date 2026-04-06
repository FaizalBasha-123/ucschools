function getBackendBaseUrl() {
  const url = process.env.API_BASE_URL || process.env.BACKEND_URL;
  if (!url) {
    return "";
  }
  return url.endsWith("/api/v1") ? url.replace(/\/+$/, "") : `${url.replace(/\/+$/, "")}/api/v1`;
}

function getAllowedOrigins() {
  const raw = process.env.PUBLIC_SUPPORT_ALLOWED_ORIGINS;
  if (raw) {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function applyCors(res, origin) {
  if (origin && getAllowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  applyCors(res, origin);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const base = getBackendBaseUrl();
  if (!base) {
    res.status(500).json({ error: "backend_not_configured" });
    return;
  }

  const upstream = await fetch(`${base}/public/demo-requests`, {
    method: "POST",
    headers: {
      "content-type": req.headers["content-type"] || "application/json",
    },
    body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
  });

  const text = await upstream.text();
  res
    .status(upstream.status)
    .setHeader("Content-Type", upstream.headers.get("content-type") || "application/json")
    .send(text);
}
