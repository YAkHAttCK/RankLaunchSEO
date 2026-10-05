import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
const store = globalThis as typeof globalThis & {
  __resultsFlowLimits?: Map<string, Bucket>;
};
const limits = (store.__resultsFlowLimits ??= new Map());

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function isAllowedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || allowed.includes(origin);
}

export function rateLimit(request: NextRequest, scope: string, max: number, windowMs: number) {
  const remote = request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const digest = createHash("sha256").update(remote).digest("hex").slice(0, 24);
  const key = `${scope}:${digest}`;
  const now = Date.now();
  const bucket = limits.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (limits.size >= 5000) {
      for (const [item, value] of limits) {
        if (value.resetAt <= now) limits.delete(item);
      }
      if (limits.size >= 5000) return false;
    }
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

export function noStoreHeaders(request: NextRequest) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (request.headers.get("x-results-flow-private") === "true") {
    headers.set("X-Results-Flow-Privacy", "ephemeral");
  }
  return headers;
}

export function getProviderConfig() {
  const serpApi = (process.env.SERPAPI_API_KEY ?? "").trim();
  const googlePlaces = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  const warnings: string[] = [];
  if (serpApi && serpApi.length < 20) warnings.push("SERPAPI_API_KEY is present but does not look valid.");
  if (googlePlaces && !/^AIza[0-9A-Za-z_-]{30,}$/.test(googlePlaces)) {
    warnings.push("GOOGLE_PLACES_API_KEY is present but does not look like a Google API key.");
  }
  return {
    serpApi: serpApi.length >= 20,
    googlePlaces: /^AIza[0-9A-Za-z_-]{30,}$/.test(googlePlaces),
    warnings,
  };
}
