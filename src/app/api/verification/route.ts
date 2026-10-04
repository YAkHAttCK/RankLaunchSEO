import type { NextRequest } from "next/server";
import {
  canReadCallStatus,
  getProviderConfig,
  isAllowedOrigin,
  issueCallStatusToken,
  jsonError,
  noStoreHeaders,
  rateLimit,
  toE164,
  validPhone,
} from "@/lib/server";

export const dynamic = "force-dynamic";

type VoiceProvider = "vapi" | "retell" | "twilio";

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) return jsonError("Request origin is not allowed.", 403);
  if (!rateLimit(request, "verification", 3, 60 * 60_000)) {
    return jsonError("Verification call limit reached. Try again later.", 429);
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return jsonError("Request body must be a JSON object.", 400);
  }
  const body = input as { phone?: unknown; businessName?: unknown; provider?: unknown };
  if (!validPhone(body.phone)) return jsonError("Enter a valid phone number.", 400);
  const destination = toE164(body.phone);
  if (!destination) return jsonError("Automated verification requires an E.164 phone number beginning with +. You can still use manual calling.", 400);
  if (typeof body.businessName !== "string" || body.businessName.trim().length < 2 || body.businessName.length > 120) {
    return jsonError("A confirmed business name is required.", 400);
  }
  if (body.provider !== undefined && !["vapi", "retell", "twilio"].includes(String(body.provider))) {
    return jsonError("Choose a supported verification provider.", 400);
  }
  const config = getProviderConfig();
  const requested = body.provider as VoiceProvider | undefined;
  const provider = requested
    ? config[requested] ? requested : null
    : config.vapi ? "vapi" : config.retell ? "retell" : config.twilio ? "twilio" : null;
  if (!provider) {
    return Response.json(
      {
        error: "Automated calls are not configured for the selected provider. Use the manual call option instead.",
        warnings: config.warnings,
      },
      { status: 503, headers: noStoreHeaders(request) },
    );
  }

  let response: Response;
  if (provider === "vapi") {
    response = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: destination },
        assistantOverrides: { variableValues: { businessName: body.businessName.trim() } },
      }),
      cache: "no-store",
    });
  } else if (provider === "retell") {
    response = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from_number: process.env.RETELL_FROM_NUMBER,
        to_number: destination,
        override_agent_id: process.env.RETELL_AGENT_ID,
        metadata: { businessName: body.businessName.trim() },
      }),
      cache: "no-store",
    });
  } else {
    const twimlUrl = new URL(process.env.TWILIO_TWIML_URL!);
    twimlUrl.searchParams.set("businessName", body.businessName.trim());
    const twilioBody = new URLSearchParams({
      To: destination,
      From: process.env.TWILIO_PHONE_NUMBER!,
      Url: twimlUrl.toString(),
      Method: "POST",
    });
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const credentials = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: twilioBody,
        cache: "no-store",
      },
    );
  }

  if (!response.ok) {
    return jsonError(
      `${provider} rejected the call request or is temporarily unavailable.`,
      response.status < 500 ? 422 : 502,
    );
  }
  const data = (await response.json()) as { id?: string; call_id?: string; sid?: string; status?: string; call_status?: string };
  const callId = data.id ?? data.call_id ?? data.sid;
  if (!callId) return jsonError(`${provider} returned a response without a call ID; status cannot be tracked.`, 502);
  const statusToken = issueCallStatusToken(provider, callId);
  return Response.json(
    {
      id: callId,
      provider,
      statusToken,
      status: data.status ?? data.call_status ?? "queued",
      detail: `${provider} accepted the call request. The call outcome is not yet known.`,
    },
    { status: 202, headers: noStoreHeaders(request) },
  );
}

export async function GET(request: NextRequest) {
  if (!isAllowedOrigin(request)) return jsonError("Request origin is not allowed.", 403);
  if (!rateLimit(request, "call-status", 20, 60_000)) {
    return jsonError("Call status limit reached. Try again in a minute.", 429);
  }
  const id = request.nextUrl.searchParams.get("id");
  const providerValue = request.nextUrl.searchParams.get("provider");
  if (!id || !/^[a-zA-Z0-9_-]{3,120}$/.test(id)) return jsonError("A valid call ID is required.", 400);
  if (!["vapi", "retell", "twilio"].includes(providerValue ?? "")) {
    return jsonError("A valid call provider is required.", 400);
  }
  const provider = providerValue as VoiceProvider;
  const statusToken = request.headers.get("x-results-flow-call-token") ?? "";
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(statusToken) || !canReadCallStatus(provider, id, statusToken)) {
    return jsonError("This browser session is not authorized to read that call status.", 403);
  }
  const config = getProviderConfig();
  if (!config[provider]) return jsonError(`${provider} call status is unavailable because credentials are not configured.`, 503);

  let response: Response;
  if (provider === "vapi") {
    response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      cache: "no-store",
    });
  } else if (provider === "retell") {
    response = await fetch(`https://api.retellai.com/v2/get-call/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
      cache: "no-store",
    });
  } else {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const credentials = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(id)}.json`,
      { headers: { Authorization: `Basic ${credentials}` }, cache: "no-store" },
    );
  }
  if (!response.ok) return jsonError(`Unable to retrieve call status from ${provider}.`, 502);
  const data = (await response.json()) as {
    id?: string;
    call_id?: string;
    sid?: string;
    status?: string;
    call_status?: string;
    endedReason?: string;
    disconnection_reason?: string;
    transcript?: string;
    artifact?: { transcript?: string };
  };
  return Response.json(
    {
      id: data.id ?? data.call_id ?? data.sid ?? id,
      provider,
      status: data.status ?? data.call_status ?? "unknown",
      outcome: data.endedReason ?? data.disconnection_reason ?? null,
      transcript: data.transcript ?? data.artifact?.transcript ?? null,
    },
    { headers: noStoreHeaders(request) },
  );
}
