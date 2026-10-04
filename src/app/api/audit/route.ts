import type { NextRequest } from "next/server";
import { getProviderConfig, isAllowedOrigin, jsonError, noStoreHeaders, rateLimit } from "@/lib/server";
import type { AuditMetric, Business } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) return jsonError("Request origin is not allowed.", 403);
  if (!rateLimit(request, "audit", 8, 60_000)) {
    return jsonError("Audit limit reached. Try again in a minute.", 429);
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
  const business = input as Partial<Business>;
  if (typeof business.name !== "string" || business.name.trim().length < 2 || business.name.length > 120) {
    return jsonError("A confirmed business name is required.", 400);
  }
  if (business.address !== undefined && business.address !== null &&
    (typeof business.address !== "string" || business.address.length > 200)) {
    return jsonError("Business address is too long.", 400);
  }
  if (business.website !== undefined && business.website !== null &&
    (typeof business.website !== "string" || business.website.length > 2048)) {
    return jsonError("Business website is too long.", 400);
  }
  for (const [coordinate, value, maximum] of [
    ["latitude", business.latitude, 90],
    ["longitude", business.longitude, 180],
  ] as const) {
    if (value !== null && value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum)) {
      return jsonError(`Business ${coordinate} is invalid.`, 400);
    }
  }
  let websiteHost = "";
  if (business.website) {
    try {
      const website = new URL(business.website);
      if (!["http:", "https:"].includes(website.protocol)) throw new Error();
      websiteHost = website.hostname.toLowerCase();
    } catch {
      return jsonError("Business website must be a valid HTTP or HTTPS URL.", 400);
    }
  }
  const providerConfig = getProviderConfig();
  const serpKey = providerConfig.serpApi ? process.env.SERPAPI_API_KEY : undefined;
  const metrics: AuditMetric[] = [
    {
      label: "Map pack",
      value: "Unavailable",
      detail: serpKey ? "Could not retrieve Google Search local results." : "Requires SerpAPI Google Search local results.",
      available: false,
    },
    {
      label: "Google Maps position",
      value: "Unavailable",
      detail: serpKey ? "Could not retrieve Google Maps results." : "Requires SerpAPI Google Maps data.",
      available: false,
    },
    {
      label: "Organic visibility",
      value: "Unavailable",
      detail: serpKey ? "Could not retrieve organic results." : "Requires SerpAPI Google Search data.",
      available: false,
    },
    {
      label: "AI overview",
      value: "Unavailable",
      detail: serpKey ? "Could not retrieve overview data." : "Requires a configured search provider that returns AI overview data.",
      available: false,
    },
    {
      label: "NAP consistency",
      value: "Not measured",
      detail: "Requires matching Google Places and SerpAPI Maps details.",
      available: false,
    },
    {
      label: "Directory coverage",
      value: "Unavailable",
      detail: "Requires search-provider results from business directories.",
      available: false,
    },
    {
      label: "Indexed pages",
      value: "Not measured",
      detail: "No supported indexed-page measurement provider is configured.",
      available: false,
    },
    {
      label: "Backlinks",
      value: "Not measured",
      detail: "No supported backlink measurement provider is configured.",
      available: false,
    },
  ];
  const queryLocation = [business.name, business.address].filter(Boolean).join(" ");
  const warnings: string[] = [...providerConfig.warnings];
  if (serpKey) {
    const mapParams = new URLSearchParams({
      engine: "google_maps",
      q: `${business.name} ${business.address ?? ""}`.trim(),
      api_key: serpKey,
    });
    const organicParams = new URLSearchParams({
      engine: "google",
      q: queryLocation,
      api_key: serpKey,
      num: "20",
    });
    const placesResult = providerConfig.googlePlaces
      ? fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
            "X-Goog-FieldMask":
              "places.displayName,places.formattedAddress,places.nationalPhoneNumber",
          },
          body: JSON.stringify({ textQuery: queryLocation, maxResultCount: 5 }),
          cache: "no-store",
        })
      : null;
    const requests: Promise<Response>[] = [
      fetch(`https://serpapi.com/search.json?${mapParams}`, { cache: "no-store" }),
      fetch(`https://serpapi.com/search.json?${organicParams}`, { cache: "no-store" }),
    ];
    if (placesResult) requests.push(placesResult);
    const [mapResult, organicResult, placesSearchResult] = await Promise.allSettled(requests);
    if (mapResult.status === "fulfilled" && mapResult.value.ok) {
      const data = (await mapResult.value.json()) as {
        local_results?: Record<string, unknown>[];
        error?: unknown;
      };
      if (data.error) {
        warnings.push("Google Maps data could not be retrieved from SerpAPI.");
      } else {
        const mapListings = data.local_results ?? [];
        const matches = mapListings.find(
          (item) => String(item.title ?? "").toLowerCase() === business.name!.trim().toLowerCase(),
        );
        const rank = matches ? mapListings.indexOf(matches) + 1 : null;
        metrics[1].value = rank ? `#${rank}` : "Not in returned results";
        metrics[1].detail = rank
          ? `Position among ${mapListings.length} Google Maps results returned by SerpAPI.`
          : "Business name was not an exact match in returned Google Maps results.";
        metrics[1].available = true;
        if (placesSearchResult?.status === "fulfilled" && placesSearchResult.value.ok && matches) {
          const placesData = (await placesSearchResult.value.json()) as {
            places?: Array<Record<string, unknown>>;
            error?: unknown;
          };
          if (placesData.error) {
            warnings.push("NAP consistency could not be measured from Google Places.");
          } else {
            const selectedName = business.name.trim().toLowerCase();
            const placesMatch = (placesData.places ?? []).find((place) => {
              const displayName = place.displayName as { text?: unknown } | undefined;
              return typeof displayName?.text === "string" && displayName.text.trim().toLowerCase() === selectedName;
            });
            if (placesMatch) {
              const normalizePhone = (value: unknown) => String(value ?? "").replace(/\D/g, "");
              const normalizeAddress = (value: unknown) =>
                String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
              const comparisons = [
                {
                  label: "Phone",
                  left: normalizePhone(matches.phone ?? matches.phone_number),
                  right: normalizePhone(placesMatch.nationalPhoneNumber),
                },
                {
                  label: "Address",
                  left: normalizeAddress(matches.address),
                  right: normalizeAddress(placesMatch.formattedAddress),
                },
              ].filter((item) => item.left && item.right);
              if (comparisons.length) {
                const matchedCount = comparisons.filter((item) => item.left === item.right).length;
                metrics[4] = {
                  label: "NAP consistency",
                  value: `${matchedCount}/${comparisons.length} match`,
                  detail: `Compared ${comparisons.map((item) => item.label.toLowerCase()).join(" and ")} across Google Places and SerpAPI Maps.`,
                  available: true,
                };
              } else {
                metrics[4].detail = "The providers did not return comparable phone or address values.";
              }
            }
          }
        } else if (providerConfig.googlePlaces && matches) {
          warnings.push("NAP consistency could not be measured from Google Places.");
        }
      }
    } else {
      warnings.push("Google Maps data could not be retrieved from SerpAPI.");
    }
    if (organicResult.status === "fulfilled" && organicResult.value.ok) {
      const data = (await organicResult.value.json()) as {
        local_results?: Record<string, unknown>[];
        organic_results?: Record<string, unknown>[];
        ai_overview?: unknown;
        error?: unknown;
      };
      if (data.error) {
        warnings.push("Map pack, organic, AI overview, and directory coverage data could not be retrieved from SerpAPI.");
      } else {
        const localResults = data.local_results ?? [];
        const localMatch = localResults.find(
          (item) => String(item.title ?? "").toLowerCase() === business.name!.trim().toLowerCase(),
        );
        const localPosition = localMatch ? localResults.indexOf(localMatch) + 1 : null;
        metrics[0] = {
          label: "Map pack",
          value: localPosition ? (localPosition <= 3 ? `#${localPosition} · top 3` : `#${localPosition}`) : "Not in returned results",
          detail: localPosition
            ? `Position among ${localResults.length} local results returned in Google Search.`
            : localResults.length
              ? "Business name was not an exact match in returned local results."
              : "No local results were returned for this query.",
          available: true,
        };
        const entries = data.organic_results ?? [];
        const match = entries.find((item) => {
          const title = String(item.title ?? "").toLowerCase();
          let sameDomain = false;
          if (websiteHost && typeof item.link === "string") {
            try {
              const resultHost = new URL(item.link).hostname.toLowerCase();
              sameDomain = resultHost === websiteHost || resultHost.endsWith(`.${websiteHost}`);
            } catch {
              sameDomain = false;
            }
          }
          return title.includes(business.name!.trim().toLowerCase()) || sameDomain;
        });
        const position = match ? entries.indexOf(match) + 1 : null;
        metrics[2] = {
          label: "Organic visibility",
          value: position ? `#${position}` : "Not in returned results",
          detail: position
            ? `First matching result among ${entries.length} organic listings returned.`
            : "No exact business/domain match among the organic results returned.",
          available: true,
        };
        metrics[3] = {
          label: "AI overview",
          value: data.ai_overview ? "Detected" : "Not detected",
          detail: data.ai_overview
            ? "An AI overview was present in this provider response."
            : "No AI overview was returned for this query.",
          available: true,
        };
        const directoryDomains = new Set([
          "yelp.com",
          "tripadvisor.com",
          "yellowpages.com",
          "facebook.com",
          "bbb.org",
          "foursquare.com",
        ]);
        const directoryMatches = entries.filter((item) => {
          if (typeof item.link !== "string") return false;
          try {
            const host = new URL(item.link).hostname.toLowerCase().replace(/^www\./, "");
            return [...directoryDomains].some((domain) => host === domain || host.endsWith(`.${domain}`));
          } catch {
            return false;
          }
        });
        const observedDirectories = new Set(
          directoryMatches.flatMap((item) => {
            if (typeof item.link !== "string") return [];
            try {
              return [new URL(item.link).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "")];
            } catch {
              return [];
            }
          }),
        );
        metrics[5] = {
          label: "Directory coverage",
          value: `${observedDirectories.size} surfaced`,
          detail: observedDirectories.size
            ? `${[...observedDirectories].join(", ")} appeared among organic results; this does not confirm a business listing.`
            : `No supported directory domains appeared among ${entries.length} organic results.`,
          available: true,
        };
      }
    } else {
      warnings.push("Map pack, organic, AI overview, and directory coverage data could not be retrieved from SerpAPI.");
    }
  }
  return Response.json(
    { metrics, warnings, measuredAt: new Date().toISOString() },
    { headers: noStoreHeaders(request) },
  );
}
