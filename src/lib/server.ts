import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
type CallToken = { digest: string; expiresAt: number };

const store = globalThis as typeof globalThis & {
  __resultsFlowLimits?: Map<string, Bucket>;
  __resultsFlowCallTokens?: Map<string, CallToken>;
};
const limits = (store.__resultsFlowLimits ??= new Map());
const callTokens = (store.__resultsFlowCallTokens ??= new Map());

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

export function validPhone(phone: unknown): phone is string {
  if (typeof phone !== "string" || !/^\+?[0-9().\-\s]{7,24}$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

type VoiceProvider = "vapi" | "retell" | "twilio";

export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!phone.trim().startsWith("+") || digits.length < 7 || digits.length > 15 || digits.startsWith("0")) {
    return null;
  }
  return `+${digits}`;
}

export function getProviderConfig() {
  const serpApi = (process.env.SERPAPI_API_KEY ?? "").trim();
  const googlePlaces = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  const vapiKey = (process.env.VAPI_API_KEY ?? "").trim();
  const retellKey = (process.env.RETELL_API_KEY ?? "").trim();
  const twilioSid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const twilioToken = (process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const twilioNumber = (process.env.TWILIO_PHONE_NUMBER ?? "").trim();
  const twimlUrl = (process.env.TWILIO_TWIML_URL ?? "").trim();
  const vapi = vapiKey.length >= 12 &&
    Boolean(process.env.VAPI_ASSISTANT_ID?.trim()) &&
    Boolean(process.env.VAPI_PHONE_NUMBER_ID?.trim());
  const retell = retellKey.length >= 12 &&
    Boolean(process.env.RETELL_AGENT_ID?.trim()) &&
    Boolean(process.env.RETELL_FROM_NUMBER && toE164(process.env.RETELL_FROM_NUMBER) === process.env.RETELL_FROM_NUMBER);
  let validTwimlUrl = false;
  try {
    validTwimlUrl = new URL(twimlUrl).protocol === "https:";
  } catch {
    validTwimlUrl = false;
  }
  const twilio = /^AC[a-fA-F0-9]{32}$/.test(twilioSid) &&
    twilioToken.length >= 12 &&
    Boolean(toE164(twilioNumber) && toE164(twilioNumber) === twilioNumber) &&
    validTwimlUrl;
  const warnings: string[] = [];
  if (serpApi && serpApi.length < 20) warnings.push("SERPAPI_API_KEY is present but does not look valid.");
  if (googlePlaces && !/^AIza[0-9A-Za-z_-]{30,}$/.test(googlePlaces)) {
    warnings.push("GOOGLE_PLACES_API_KEY is present but does not look like a Google API key.");
  }
  if ((vapiKey || process.env.VAPI_ASSISTANT_ID || process.env.VAPI_PHONE_NUMBER_ID) && !vapi) {
    warnings.push("Vapi requires VAPI_API_KEY, VAPI_ASSISTANT_ID, and VAPI_PHONE_NUMBER_ID.");
  }
  if ((retellKey || process.env.RETELL_AGENT_ID || process.env.RETELL_FROM_NUMBER) && !retell) {
    warnings.push("Retell requires RETELL_API_KEY, RETELL_AGENT_ID, and an E.164 RETELL_FROM_NUMBER.");
  }
  if ((twilioSid || twilioToken || twilioNumber || twimlUrl) && !twilio) {
    warnings.push("Twilio requires a valid account SID, auth token, E.164 phone number, and HTTPS TWILIO_TWIML_URL.");
  }
  return {
    serpApi: serpApi.length >= 20,
    googlePlaces: /^AIza[0-9A-Za-z_-]{30,}$/.test(googlePlaces),
    vapi,
    retell,
    twilio,
    warnings,
  };
}

export function issueCallStatusToken(provider: VoiceProvider, callId: string) {
  const token = randomBytes(32).toString("base64url");
  const key = `${provider}:${callId}`;
  const now = Date.now();
  for (const [id, entry] of callTokens) {
    if (entry.expiresAt <= now) callTokens.delete(id);
  }
  if (callTokens.size >= 5000) {
    const oldestId = callTokens.keys().next().value;
    if (oldestId) callTokens.delete(oldestId);
  }
  callTokens.set(key, {
    digest: createHash("sha256").update(token).digest("hex"),
    expiresAt: now + 6 * 60 * 60_000,
  });
  return token;
}

export function canReadCallStatus(provider: VoiceProvider, callId: string, token: string) {
  const key = `${provider}:${callId}`;
  const entry = callTokens.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    callTokens.delete(key);
    return false;
  }
  const supplied = createHash("sha256").update(token).digest();
  const expected = Buffer.from(entry.digest, "hex");
  return timingSafeEqual(supplied, expected);
}
