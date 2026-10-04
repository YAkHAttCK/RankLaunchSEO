import type { NextRequest } from "next/server";
import { getProviderConfig, isAllowedOrigin, jsonError, noStoreHeaders, rateLimit } from "@/lib/server";
import type { Listing } from "@/lib/types";

export const dynamic = "force-dynamic";

type ProviderResult = { listings: Listing[]; source: string };

function text(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const candidate = (value as { text?: unknown }).text;
    return typeof candidate === "string" ? candidate : "";
  }
  return "";
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeListing(item: Record<string, unknown>, source: string): Listing | null {
  const name = text(item.title ?? item.displayName);
  if (!name) return null;
  const coords = item.gps_coordinates as Record<string, unknown> | undefined;
  const location = item.location as Record<string, unknown> | undefined;
  const geometry = item.geometry as Record<string, unknown> | undefined;
  const geometryLocation = geometry?.location as Record<string, unknown> | undefined;
  const latitude = numberOrNull(coords?.latitude ?? location?.latitude ?? geometryLocation?.lat);
  const longitude = numberOrNull(coords?.longitude ?? location?.longitude ?? geometryLocation?.lng);
  const rawPlaceId = text(item.place_id ?? item.id);
  const placeId = rawPlaceId.replace(/^places\//, "");
  const reviewUrls = [
    text(item.review_link),
    placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : "",
  ].filter(Boolean);
  const website = text(item.website ?? item.websiteUri);
  const address = text(item.address ?? item.formatted_address ?? item.formattedAddress);
  const phone = text(item.phone ?? item.phone_number ?? item.internationalPhoneNumber);

  return {
    id: placeId || `${source}:${name}:${address}`,
    name,
    phone,
    address,
    latitude,
    longitude,
    website,
    reviewUrls: [...new Set(reviewUrls)],
    source,
    rating: numberOrNull(item.rating),
    reviewCount: numberOrNull(item.reviews ?? item.user_ratings_total ?? item.userRatingCount),
    sources: [source],
  };
}

async function placesSearch(query: string): Promise<ProviderResult> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 10 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google Places returned ${response.status}`);
  const data = (await response.json()) as { places?: Record<string, unknown>[]; error?: unknown };
  if (data.error) throw new Error("Google Places reported a provider error.");
  const listings = (data.places ?? [])
    .map((item) => normalizeListing(item, "Google Places"))
    .filter((item): item is Listing => item !== null);
  return { listings, source: "Google Places" };
}

async function serpMapsSearch(query: string): Promise<ProviderResult> {
  const params = new URLSearchParams({
    engine: "google_maps",
    q: query,
    api_key: process.env.SERPAPI_API_KEY!,
  });
  const response = await fetch(`https://serpapi.com/search.json?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);
  const data = (await response.json()) as { local_results?: Record<string, unknown>[]; error?: unknown };
  if (data.error) throw new Error("SerpAPI reported a provider error.");
  const listings = (data.local_results ?? [])
    .map((item) => normalizeListing(item, "SerpAPI Maps"))
    .filter((item): item is Listing => item !== null);
  return { listings, source: "SerpAPI Maps" };
}

function mergeResults(results: ProviderResult[]) {
  const merged = new Map<string, Listing>();
  for (const result of results) {
    for (const listing of result.listings) {
      const key = (listing.id || `${listing.name}|${listing.address}`).toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        existing.sources.push(...listing.sources);
        existing.reviewUrls = [...new Set([...existing.reviewUrls, ...listing.reviewUrls])];
        existing.phone ||= listing.phone;
        existing.address ||= listing.address;
        existing.website ||= listing.website;
        existing.latitude ??= listing.latitude;
        existing.longitude ??= listing.longitude;
        existing.rating ??= listing.rating;
        existing.reviewCount ??= listing.reviewCount;
      } else {
        merged.set(key, listing);
      }
    }
  }
  return [...merged.values()].map((listing) => ({
    ...listing,
    sources: [...new Set(listing.sources)],
  }));
}

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) return jsonError("Request origin is not allowed.", 403);
  if (!rateLimit(request, "search", 8, 60_000)) {
    return jsonError("Search limit reached. Try again in a minute.", 429);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Request body must be a JSON object.", 400);
  }
  const input = body as { name?: unknown; location?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const location = typeof input.location === "string" ? input.location.trim() : "";
  if (name.length < 2 || name.length > 120 || location.length < 2 || location.length > 120) {
    return jsonError("Enter a business name and a city, state, or ZIP (2–120 characters each).", 400);
  }
  if (/[<>]/.test(name + location)) return jsonError("Search text contains invalid characters.", 400);
  const query = `${name}, ${location}`;
  const providerConfig = getProviderConfig();
  const providers = [
    ...(providerConfig.googlePlaces ? [placesSearch(query)] : []),
    ...(providerConfig.serpApi ? [serpMapsSearch(query)] : []),
  ];
  if (providers.length === 0) {
    return Response.json(
      {
        error: "Live search is unavailable. Configure a valid GOOGLE_PLACES_API_KEY or SERPAPI_API_KEY.",
        warnings: providerConfig.warnings,
      },
      { status: 503, headers: noStoreHeaders(request) },
    );
  }

  const settled = await Promise.allSettled(providers);
  const successes = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
  const failures = [
    ...providerConfig.warnings,
    ...settled.flatMap((item) =>
      item.status === "rejected" ? [item.reason instanceof Error ? item.reason.message : "Provider request failed."] : [],
    ),
  ];
  if (successes.length === 0) {
    return Response.json(
      { error: "All configured search providers failed.", warnings: failures },
      { status: 502, headers: noStoreHeaders(request) },
    );
  }
  return Response.json(
    {
      listings: mergeResults(successes),
      sources: successes.map((item) => item.source),
      warnings: failures,
    },
    { headers: noStoreHeaders(request) },
  );
}
