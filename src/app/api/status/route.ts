import { getProviderConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const providers = getProviderConfig();
  return Response.json(
    {
      providers: {
        googlePlaces: providers.googlePlaces,
        serpApi: providers.serpApi,
      },
      warnings: providers.warnings,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
