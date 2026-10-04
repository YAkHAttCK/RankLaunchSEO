# Results Flow

Results Flow is a mobile-first Next.js PWA built with the App Router, React, Tailwind CSS 4, and shadcn/ui component conventions. It supports local business discovery, guest sessions, detail confirmation, GPS arrival check-ins, provider-backed search visibility snapshots, and review-link organization.

## Run locally

Requirements: Node.js 20.9+ and npm.

```sh
npm install
Copy-Item .env.example .env.local # PowerShell; use cp .env.example .env.local on macOS/Linux
npm run dev
```

Open `http://localhost:3000`, then choose **Continue as guest**. The guest session is scoped to the current browser tab; end it from the header. A confirmed business and activity log are stored in the current browser with local storage; no database or server-side business profile storage is configured. Searches are never stored by the app. Privacy mode keeps new call/GPS activity in the current session instead of writing it to local storage; the confirmed business remains saved. Provider credentials remain on the server.

When no search provider is configured, **Load demo preview** shows fictional sample businesses marked as demo data, never live results. Demo profiles disable outbound calls, GPS, and audits. No rankings or provider metrics are invented.

## Optional provider configuration

Set credentials in `.env.local` or the hosting platform's secret manager, then restart the server.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Live Google Places Text Search results with phone, address, coordinates, website, rating and place ID. Enable Places API (New) and billing for the key. |
| `SERPAPI_API_KEY` | SerpAPI Google Maps discovery and Google Search local-pack, organic, and AI overview snapshots. |
| `VAPI_API_KEY` | Server-side Vapi API credential for an explicitly user-initiated outbound verification call. |
| `VAPI_ASSISTANT_ID` | Vapi assistant configured for the call. |
| `VAPI_PHONE_NUMBER_ID` | Vapi-owned outbound phone number ID. |
| `RETELL_API_KEY` | Retell API key for user-initiated calls. |
| `RETELL_AGENT_ID` | Configured Retell agent ID. |
| `RETELL_FROM_NUMBER` | Retell-owned outbound number in E.164 format (for example, `+15551234567`). |
| `TWILIO_ACCOUNT_SID` | Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | Server-side Twilio auth token. |
| `TWILIO_PHONE_NUMBER` | Twilio-owned outbound number in E.164 format. |
| `TWILIO_TWIML_URL` | HTTPS URL that returns the TwiML instructions for the call. |
| `APP_ALLOWED_ORIGINS` | Optional comma-separated additional origins allowed to call the API. Same-origin requests are always allowed. |

Provider variables are validated before a provider is marked ready; incomplete or malformed configurations are reported in the app. The search endpoint combines configured Google Places and SerpAPI Maps results and deduplicates listings. The audit reports a Map Pack position only when SerpAPI returns Google Search local results, plus a distinct Google Maps results position. NAP consistency is measured only when Google Places and SerpAPI Maps return an exact-name business and comparable phone/address fields. Directory coverage counts supported directory domains surfaced by the actual organic-search response; that count does **not** assert the business has a listing there. Indexed-page and backlink measurements require dedicated supported data providers and remain unavailable. Search positions and AI overview presence are snapshots from a single provider query, not guaranteed rankings. Yelp, Tripadvisor, Facebook, and YellowPages links can be supplied as confirmed review URLs; their listings are not claimed unless an actual provider returns them.

Vapi, Retell, and Twilio credentials are used only server-side; the configured provider is selected in the call panel. Outbound calls are never made automatically. Starting one sends the confirmed business name and phone number to the selected provider; automated calls require the destination number in E.164 format. The app reports accepted call status and allows the originating browser session to retrieve the provider status/transcript for six hours (transcripts depend on provider features; Twilio status alone does not imply a transcript). The `tel:` fallback opens the device phone app and logs only that it was opened; the call outcome is not assumed. Quick manual outcome buttons record the user's selection. Configure providers and assistant/TwiML scripts for appropriate disclosure and consent before enabling outbound calls.

## Privacy, security, and limits

There is no Google OAuth, browser-fingerprint spoofing, or user-agent rotation. The Privacy & Fingerprint Obfuscation disclosure explicitly states that behavior. Searches use the explicit business-location parameter; the app does not rotate IPs or user agents to affect search results. Search terms, precise geolocation, credentials, and call transcripts are not written to server logs or a server database by this app; the configured search/call provider still receives the data required to perform that request. The server uses a short-lived in-memory rate limiter (8 search requests/minute, 8 audits/minute, 3 outbound verification requests/hour, and 20 status checks/minute per client IP); it is process-local and resets on restart. Deploy behind a trusted proxy that supplies `x-real-ip`, and replace the limiter with a shared store when running multiple instances. API routes validate input and enforce same-origin requests (plus optional allowed origins). Protect paid provider keys with provider-side quotas and restrictions.

Geolocation is requested only when the user starts check-in, requires browser permission and a secure context, and compares current device coordinates with the confirmed business coordinates using a 50 m Haversine radius. GPS is approximate and is not identity verification. PostgreSQL is not required; the current guest implementation intentionally uses validated browser-local JSON storage. Add an authenticated persistence layer before using the app for multi-user or cross-device records.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
