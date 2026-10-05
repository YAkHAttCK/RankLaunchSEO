# Results Flow

Results Flow is a mobile-first Next.js PWA built with the App Router, React, Tailwind CSS 4, and shadcn/ui component conventions. It supports local business discovery, guest sessions, detail confirmation, GPS arrival check-ins, provider-backed search visibility snapshots, and review-link organization.

## Run locally

Requirements: Node.js 20.9+ and npm.

```sh
npm install
Copy-Item .env.example .env.local # PowerShell; use cp .env.example .env.local on macOS/Linux
npm run dev
```

The development and production scripts listen on `0.0.0.0` so the app can be opened by another device on your private LAN. On the computer, open `http://localhost:3000`. To connect a phone on the same Wi-Fi:

1. Find the computer's private IPv4 address (`ipconfig` on Windows; look for the active Wi-Fi/Ethernet adapter's IPv4 address, or use `ip addr` / `ifconfig` on macOS/Linux).
2. On the phone, open `http://<computer-ipv4>:3000` (for example, `http://192.168.1.24:3000`). Keep both devices on the same trusted Wi-Fi/LAN.
3. If the browser cannot connect, allow Node.js/port 3000 on the computer's **private-network** firewall profile only. Do not expose the development server to a public network.

Choose **Continue as guest**. The guest session is scoped to the current browser tab; end it from the header. A confirmed business and activity log are stored in the current browser with local storage; no database or server-side business profile storage is configured. Searches are never stored by the app. Privacy mode keeps new call/GPS activity in the current session instead of writing it to local storage; the confirmed business remains saved.

The LAN HTTP address is convenient for responsive-layout checks, but browsers normally restrict geolocation and PWA installation to secure contexts. For actual phone check-ins and installation, open the app on the phone over HTTPS (for example, a deployed HTTPS site) or configure a trusted HTTPS certificate for your private LAN and trust it on the phone. `localhost` on the phone refers to the phone, not your computer. After opening the HTTPS site, use the browser's **Install app** / **Add to Home Screen** action.

When no search provider is configured, **Load demo preview** shows fictional sample businesses marked as demo data, never live results. Demo profiles disable outbound calls, GPS, and audits. No rankings or provider metrics are invented.

## Optional search provider configuration

Set search credentials in `.env.local` or the hosting platform's secret manager, then restart the server. Phone verification does not require provider credentials.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Live Google Places Text Search results with phone, address, coordinates, website, rating and place ID. Enable Places API (New) and billing for the key. |
| `SERPAPI_API_KEY` | SerpAPI Google Maps discovery and Google Search local-pack, organic, and AI overview snapshots. |
| `APP_ALLOWED_ORIGINS` | Optional comma-separated extra origins allowed to call this application's API. Same-origin requests are always allowed. |

Provider variables are validated before a provider is marked ready; incomplete or malformed configurations are reported in the app. The search endpoint combines configured Google Places and SerpAPI Maps results and deduplicates listings. The audit reports a Map Pack position only when SerpAPI returns Google Search local results, plus a distinct Google Maps results position. NAP consistency is measured only when Google Places and SerpAPI Maps return an exact-name business and comparable phone/address fields. Directory coverage counts supported directory domains surfaced by the actual organic-search response; that count does **not** assert the business has a listing there. Indexed-page and backlink measurements require dedicated supported data providers and remain unavailable. Search positions and AI overview presence are snapshots from a single provider query, not guaranteed rankings. Yelp, Tripadvisor, Facebook, and YellowPages links can be supplied as confirmed review URLs; their listings are not claimed unless an actual provider returns them.

## Phone verification

Phone verification is manual and requires no credentials. The `tel:` link asks the current device/browser to hand the number to its dialer or configured calling handler. On a phone this normally opens the dialer; on desktop, available behavior depends on the operating system and installed calling apps. A webpage cannot automatically bridge to or control a USB/Bluetooth-attached phone. That would require a separately installed companion/native integration or an OS calling handler. Results Flow does not infer that a call happened: the user records a call outcome with the manual status buttons.

## Privacy, security, and limits

There is no Google OAuth, browser-fingerprint spoofing, or user-agent rotation. The Privacy & Fingerprint Obfuscation disclosure explicitly states that behavior. Searches use the explicit business-location parameter; the app does not rotate IPs or user agents to affect search results. Search terms and precise geolocation are not written to a server database by this app; configured search providers receive the data needed to fulfill requests. The server uses a short-lived in-memory rate limiter (8 search requests/minute and 8 audits/minute per client IP); it is process-local and resets on restart. Deploy behind a trusted proxy that supplies `x-real-ip`, and replace the limiter with a shared store when running multiple instances. API routes validate input and enforce same-origin requests (plus optional allowed origins). Protect paid provider keys with provider-side quotas and restrictions.

Geolocation is requested only when the user starts check-in, requires browser permission and a secure context, and compares current device coordinates with the confirmed business coordinates using a 50 m Haversine radius. GPS is approximate and is not identity verification. PostgreSQL is not required; the current guest implementation intentionally uses validated browser-local JSON storage. Add an authenticated persistence layer before using the app for multi-user or cross-device records.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
```
