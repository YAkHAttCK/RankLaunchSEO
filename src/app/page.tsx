"use client";

import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Menu,
  Navigation,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Activity, AuditMetric, Business, Listing, SearchResponse } from "@/lib/types";

const BUSINESS_KEY = "results-flow-business-v1";
const ACTIVITY_KEY = "results-flow-activity-v1";
const PRIVACY_KEY = "results-flow-privacy-v1";
const SESSION_KEY = "results-flow-guest-session-v1";

type Providers = { googlePlaces: boolean; serpApi: boolean; configurationWarnings: string[] };
type ApiError = { error?: string; warnings?: string[] };
type ManualOutcome = { status: string; detail: string };
type GeoState = { status: "idle" | "loading" | "success" | "error"; message: string; distance?: number };

const emptyBusiness: Business = {
  id: "",
  name: "",
  phone: "",
  address: "",
  latitude: null,
  longitude: null,
  website: "",
  reviewUrls: [],
  source: "Manually entered",
};

const demoListings: Listing[] = [
  {
    id: "demo-northstar-coffee",
    name: "Northstar Coffee (Demo)",
    phone: "+1 555 010 2020",
    address: "100 Sample Street, Austin, TX 00000",
    latitude: null,
    longitude: null,
    website: "",
    reviewUrls: [],
    source: "DEMO ONLY · Fictional sample",
    rating: null,
    reviewCount: null,
    sources: ["DEMO ONLY"],
  },
  {
    id: "demo-maple-street-dental",
    name: "Maple Street Dental (Demo)",
    phone: "",
    address: "25 Example Avenue, Austin, TX 00000",
    latitude: null,
    longitude: null,
    website: "",
    reviewUrls: [],
    source: "DEMO ONLY · Fictional sample",
    rating: null,
    reviewCount: null,
    sources: ["DEMO ONLY"],
  },
];

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeTelHref(value: string) {
  const phone = value.trim();
  if (!/^\+?[0-9().\-\s]{7,24}$/.test(phone) || (phone.match(/\+/g) ?? []).length > 1) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "";
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function measuredCoverage(metrics: AuditMetric[]) {
  return metrics.filter((item) => item.available).length;
}

function reviewHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function HomePage() {
  const [providers, setProviders] = useState<Providers>({
    googlePlaces: false,
    serpApi: false,
    configurationWarnings: [],
  });
  const [business, setBusiness] = useState<Business>(emptyBusiness);
  const [hasBusiness, setHasBusiness] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [guestSession, setGuestSession] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [privacy, setPrivacy] = useState(false);
  const [queryName, setQueryName] = useState("");
  const [queryLocation, setQueryLocation] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [searchSources, setSearchSources] = useState<string[]>([]);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [audit, setAudit] = useState<AuditMetric[]>([]);
  const [auditAt, setAuditAt] = useState("");
  const [auditWarnings, setAuditWarnings] = useState<string[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [manualOutcome, setManualOutcome] = useState<ManualOutcome | null>(null);
  const [geo, setGeo] = useState<GeoState>({ status: "idle", message: "" });
  const [secureContext, setSecureContext] = useState(false);
  const [notice, setNotice] = useState("");
  const persistedActivityIds = useRef(new Set<string>());
  const privateActivityIds = useRef(new Set<string>());

  useEffect(() => {
    setSecureContext(window.isSecureContext);
    try {
      setGuestSession(sessionStorage.getItem(SESSION_KEY) === "guest");
    } catch {
      setGuestSession(false);
    }
    setSessionReady(true);
    const rawBusiness = readStorage<unknown>(BUSINESS_KEY, emptyBusiness);
    const storedBusiness =
      rawBusiness && typeof rawBusiness === "object" && !Array.isArray(rawBusiness)
        ? (rawBusiness as Partial<Business>)
        : emptyBusiness;
    const validBusiness = {
      id: typeof storedBusiness.id === "string" ? storedBusiness.id : "",
      name: typeof storedBusiness.name === "string" ? storedBusiness.name : "",
      phone: typeof storedBusiness.phone === "string" ? storedBusiness.phone : "",
      address: typeof storedBusiness.address === "string" ? storedBusiness.address : "",
      latitude: typeof storedBusiness.latitude === "number" && Number.isFinite(storedBusiness.latitude) ? storedBusiness.latitude : null,
      longitude: typeof storedBusiness.longitude === "number" && Number.isFinite(storedBusiness.longitude) ? storedBusiness.longitude : null,
      website: safeHttpUrl(typeof storedBusiness.website === "string" ? storedBusiness.website : ""),
      reviewUrls: Array.isArray(storedBusiness.reviewUrls)
        ? storedBusiness.reviewUrls.filter((url): url is string => typeof url === "string").map(safeHttpUrl).filter(Boolean)
        : [],
      source: typeof storedBusiness.source === "string" ? storedBusiness.source : "Manually entered",
    };
    setBusiness(validBusiness);
    setHasBusiness(Boolean(validBusiness.id && validBusiness.name.trim()));
    const storedActivities = readStorage<unknown>(ACTIVITY_KEY, []);
    const safeActivities = Array.isArray(storedActivities)
      ? storedActivities.filter(
          (item): item is Activity =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof item.id === "string" &&
            (item.type === "call" || item.type === "checkin") &&
            typeof item.status === "string" &&
            typeof item.detail === "string" &&
            typeof item.createdAt === "string" &&
            Number.isFinite(Date.parse(item.createdAt)),
        )
      : [];
    persistedActivityIds.current = new Set(safeActivities.map((item) => item.id));
    setActivities(safeActivities);
    setPrivacy(readStorage<unknown>(PRIVACY_KEY, false) === true);
    void fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { providers?: Providers; warnings?: string[] }) => {
        if (data.providers) {
          setProviders({ ...data.providers, configurationWarnings: data.warnings ?? [] });
        }
      })
      .catch(() => undefined);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const persistActivity = useCallback((items: Activity[], id: string) => {
    setActivities(items);
    if (privacy) {
      privateActivityIds.current.add(id);
      return;
    }
    persistedActivityIds.current.add(id);
    const persistentItems = items.filter((item) => persistedActivityIds.current.has(item.id));
    if (!writeStorage(ACTIVITY_KEY, persistentItems)) {
      setNotice("Activity is visible in this session, but browser storage is unavailable.");
    }
  }, [privacy]);

  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "x-results-flow-private": String(privacy) }),
    [privacy],
  );

  const startGuestSession = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, "guest");
    } catch {
      setNotice("Guest mode could not persist in this tab; continuing for this page session.");
    }
    setGuestSession(true);
  };

  const endGuestSession = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // The session gate still closes in memory when session storage is unavailable.
    }
    setGuestSession(false);
    setActivities(readStorage(ACTIVITY_KEY, []));
    privateActivityIds.current.clear();
    setManualOutcome(null);
    setAudit([]);
    setAuditAt("");
    setGeo({ status: "idle", message: "" });
  };

  const loadDemoPreview = () => {
    setListings(demoListings);
    setSearchSources(["DEMO PREVIEW · FICTIONAL DATA · NOT LIVE"]);
    setSearchWarnings([]);
    setSearchError("");
  };

  const demoBusiness = business.source.startsWith("DEMO ONLY");

  const saveBusiness = (next: Business) => {
    const website = next.website.trim();
    if (website && !safeHttpUrl(website)) {
      setNotice("Website must be a valid http or https URL.");
      window.setTimeout(() => setNotice(""), 5000);
      return;
    }
    const cleaned = {
      ...next,
      name: next.name.trim(),
      phone: next.phone.trim(),
      address: next.address.trim(),
      website: safeHttpUrl(website),
      reviewUrls: next.reviewUrls.map((url) => safeHttpUrl(url.trim())).filter(Boolean),
    };
    setBusiness(cleaned);
    setHasBusiness(Boolean(cleaned.id));
    setManualOutcome(null);
    setAudit([]);
    setAuditAt("");
    setGeo({ status: "idle", message: "" });
    const saved = writeStorage(BUSINESS_KEY, cleaned);
    setEditing(false);
    setNotice(
      saved
        ? "Business details confirmed and saved on this device."
        : "Business details are confirmed for this session, but browser storage is unavailable.",
    );
    window.setTimeout(() => setNotice(""), 4000);
  };

  const selectListing = (listing: Listing) => {
    setManualOutcome(null);
    setAudit([]);
    setAuditAt("");
    setGeo({ status: "idle", message: "" });
    setBusiness({
      ...listing,
      reviewUrls: listing.reviewUrls,
      id: listing.id || makeId(),
      latitude: listing.latitude,
      longitude: listing.longitude,
    });
    setEditing(true);
    setNotice("Review and confirm every detail before saving.");
    window.setTimeout(() => setNotice(""), 5000);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchError("");
    setSearchWarnings([]);
    setListings([]);
    setIsSearching(true);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: queryName, location: queryLocation }),
      });
      const data = (await response.json()) as SearchResponse & ApiError;
      if (!response.ok) throw new Error(data.error || "Search failed.");
      setListings(data.listings ?? []);
      setSearchSources(data.sources ?? []);
      setSearchWarnings(data.warnings ?? []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  };

  const runAudit = async () => {
    if (!business.id) return;
    setAuditBusy(true);
    setAuditWarnings([]);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers,
        body: JSON.stringify(business),
      });
      const data = (await response.json()) as { metrics?: AuditMetric[]; warnings?: string[] } & ApiError;
      if (!response.ok) throw new Error(data.error || "Visibility audit failed.");
      setAudit(data.metrics ?? []);
      setAuditAt((data as { measuredAt?: string }).measuredAt ?? new Date().toISOString());
      setAuditWarnings(data.warnings ?? []);
    } catch (error) {
      setAuditWarnings([error instanceof Error ? error.message : "Visibility audit failed."]);
    } finally {
      setAuditBusy(false);
    }
  };

  const addActivity = (type: Activity["type"], status: string, detail: string) => {
    const id = makeId();
    const next = [{ id, type, status, detail, createdAt: new Date().toISOString() }, ...activities].slice(0, 40);
    persistActivity(next, id);
  };

  const openPhoneDialer = () => {
    setManualOutcome({
      status: "Dialer link opened",
      detail: "The phone app may open. Results Flow cannot tell whether the call was placed or answered.",
    });
    addActivity("call", "Dialer link opened", `Dialer handoff requested for ${business.phone}; call not confirmed.`);
  };

  const logManualOutcome = (result: string) => {
    setManualOutcome({ status: result, detail: "Manually logged by you; no call status is detected automatically." });
    addActivity("call", result, `Manual phone verification outcome: ${result}.`);
  };

  const checkIn = () => {
    if (!business.id) return;
    if (!window.isSecureContext) {
      setGeo({
        status: "error",
        message: "Browser location requires HTTPS on this device. Open the app through its secure HTTPS address and try again.",
      });
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "Location is not supported by this browser." });
      return;
    }
    if (
      business.latitude === null ||
      business.longitude === null ||
      !Number.isFinite(business.latitude) ||
      !Number.isFinite(business.longitude) ||
      Math.abs(business.latitude) > 90 ||
      Math.abs(business.longitude) > 180
    ) {
      setGeo({ status: "error", message: "This business has no confirmed coordinates. Edit its details before checking in." });
      return;
    }
    setGeo({ status: "loading", message: "Waiting for location permission…" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const distance = distanceMeters(
          position.coords.latitude,
          position.coords.longitude,
          business.latitude!,
          business.longitude!,
        );
        const arrived = distance <= 50;
        const detail = arrived
          ? `GPS confirmed within 50 m (${Math.round(distance)} m from the business).`
          : `Outside the 50 m check-in radius (${Math.round(distance)} m away).`;
        setGeo({ status: arrived ? "success" : "error", message: detail, distance });
        addActivity("checkin", arrived ? "Arrived" : "Outside radius", detail);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access in your browser settings and try again."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your device could not determine its location. Check location services and try again."
              : error.code === error.TIMEOUT
                ? "Location request timed out. Try again somewhere with a clearer GPS signal."
                : "Unable to determine your location.";
        setGeo({ status: "error", message });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const savePrivacy = (enabled: boolean) => {
    setPrivacy(enabled);
    if (!writeStorage(PRIVACY_KEY, enabled)) {
      setNotice("Privacy mode is on for this session, but your browser could not save the preference.");
      window.setTimeout(() => setNotice(""), 5000);
    }
  };

  const hasAudit = audit.length > 0;
  const coverage = hasAudit ? measuredCoverage(audit) : null;
  const directionsUrl = business.address
    ? business.latitude !== null && business.longitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(business.address)}`
    : "";

  if (!sessionReady) {
    return <main className="session-loading" aria-label="Loading local session" />;
  }

  if (!guestSession) {
    return (
      <main className="session-screen">
        <section className="session-card">
          <a className="brand session-brand" href="#" aria-label="Results Flow home">
            <span className="brand-mark"><AudioLines size={21} strokeWidth={2.4} /></span>
            <span>results<span className="brand-light">flow</span></span>
          </a>
          <span className="session-eyebrow"><ShieldCheck size={15} /> YOUR PRIVATE WORKSPACE</span>
          <h1>Local presence,<br />made <span>measurable.</span></h1>
          <p>Find your business, verify the details, and see what customers see—all in one place.</p>
          <Button className="session-continue" onClick={startGuestSession}>
            Continue as guest <ArrowRight size={16} />
          </Button>
          <div className="session-disclosure">
            <ShieldCheck size={15} />
            <span><b>No account needed.</b> Your business profile stays in this browser. No Google OAuth, fingerprint spoofing, or user-agent rotation.</span>
          </div>
          <div className="session-bottom">GUEST SESSION <span /> LOCAL TO THIS BROWSER</div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Results Flow home">
          <span className="brand-mark"><AudioLines size={21} strokeWidth={2.4} /></span>
          <span>results<span className="brand-light">flow</span></span>
        </a>
        <div className="workspace-chip"><span className="workspace-avatar">G</span><span><b>Guest workspace</b><small>Saved on this device</small></span><ChevronDown size={15} /></div>
        <p className="nav-label">WORKSPACE</p>
        <a className="nav-item active" href="#overview" title="Overview"><Compass size={17} /> Overview <span className="nav-dot" /></a>
        <a className="nav-item" href="#discovery" title="Find a business"><Search size={17} /> Find a business</a>
        <a className="nav-item" href="#visibility" title="Search visibility"><Target size={17} /> Search visibility</a>
        <a className="nav-item" href="#activity" title="Activity"><Clock3 size={17} /> Activity</a>
        <div className="sidebar-bottom">
          <div className="privacy-card">
          <div className="privacy-heading"><ShieldCheck size={16} /><b>Privacy & Fingerprint Obfuscation</b><button className={`switch ${privacy ? "on" : ""}`} type="button" role="switch" aria-checked={privacy} aria-label="Toggle privacy mode" onClick={() => savePrivacy(!privacy)}><span /></button></div>
          <p>{privacy ? "We do not spoof browser fingerprints or rotate user agents. New activity stays in this session; explicit search locations are sent to providers." : "We do not spoof browser fingerprints or rotate user agents. Privacy mode keeps new activity in this session only."}</p>
          </div>
          <div className="help-link"><CircleHelp size={16} /> Help center <ArrowUpRight size={14} /></div>
          <div className="user-row"><span className="user-avatar">G</span><span><b>Guest user</b><small>Local session</small></span><Menu size={17} /></div>
        </div>
      </aside>

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><b>Overview</b></div>
          <div className="topbar-right"><span className="secure-pill"><span /> Private workspace</span><button className="privacy-mobile" type="button" role="switch" aria-checked={privacy} onClick={() => savePrivacy(!privacy)}>{privacy ? <EyeOff size={14} /> : <Eye size={14} />}{privacy ? "Privacy on" : "Privacy"}</button><button className="icon-button" aria-label="Help" type="button" title="Your session is private to this browser"><CircleHelp size={18} /></button><span className="small-avatar">G</span><button className="signout-button" type="button" onClick={endGuestSession}>End session</button></div>
        </header>

        <div className="content" id="overview">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><Sparkles size={14} /> YOUR LOCAL PRESENCE, AT A GLANCE</div>
              <h1>Good morning<span className="period">.</span></h1>
              <p className="welcome-copy">Find a business, confirm its details, and see what customers see.</p>
            </div>
            <div className="updated-pill"><span className="live-dot" /> LIVE WORKSPACE <span className="updated-divider" /> {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date())}</div>
          </section>

          {notice && <div className="notice" role="status"><CheckCircle2 size={17} />{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><X size={15} /></button></div>}

          <section className="stat-grid" aria-label="Business overview">
            <article className="stat-card">
              <div className="stat-top"><span className="stat-icon green"><Building2 size={18} /></span><span className="stat-label">TRACKING</span><span className="stat-context">this workspace</span></div>
              <div className="stat-number">{hasBusiness ? "01" : "00"}<span className="stat-unit"> business</span></div>
              <p>{hasBusiness ? "One confirmed business profile" : "No business added yet"}</p>
              <a href={hasBusiness ? "#business" : "#discovery"} className="stat-link">{hasBusiness ? "View business" : "Add your first"} <ArrowRight size={14} /></a>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-icon lavender"><Eye size={18} /></span><span className="stat-label">SIGNALS MEASURED</span><span className="stat-context">provider-backed</span></div>
              <div className="stat-number">{coverage === null ? "—" : coverage}<span className="stat-unit">{coverage === null ? " no audit" : ` / ${audit.length}`}</span></div>
              <p>{hasAudit ? "Only signals returned by configured providers" : "Run an audit to measure available signals"}</p>
              <a href="#visibility" className="stat-link">{hasAudit ? "See the breakdown" : "Explore visibility"} <ArrowRight size={14} /></a>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-icon peach"><Navigation size={18} /></span><span className="stat-label">ARRIVAL</span><span className="stat-context">GPS check-in</span></div>
              <div className="stat-number">{geo.status === "success" ? "✓" : "50"}<span className="stat-unit">{geo.status === "success" ? " verified" : " m radius"}</span></div>
              <p>{geo.status === "success" ? "Location verified on this device" : "Precise, on-site arrival proof"}</p>
              <a href="#checkin" className="stat-link">Check in on arrival <ArrowRight size={14} /></a>
            </article>
            <article className="stat-card">
              <div className="stat-top"><span className="stat-icon blue"><Star size={18} /></span><span className="stat-label">REVIEW LINKS</span><span className="stat-context">ready to share</span></div>
              <div className="stat-number">{business.reviewUrls.length.toString().padStart(2, "0")}<span className="stat-unit"> outlets</span></div>
              <p>{business.reviewUrls.length ? "Confirmed review destinations" : "Add trusted review destinations"}</p>
              <a href="#reviews" className="stat-link">Manage links <ArrowRight size={14} /></a>
            </article>
          </section>

          <div className="section-heading" id="discovery"><div><div className="section-kicker">STEP 01 <span>·</span> DISCOVERY</div><h2>Find your business</h2><p>Search live listings, then verify the details before saving.</p></div><div className="provider-status"><span className={providers.googlePlaces || providers.serpApi ? "provider-dot enabled" : "provider-dot"} />{providers.googlePlaces || providers.serpApi ? `${[providers.googlePlaces && "Google Places", providers.serpApi && "SerpAPI"].filter(Boolean).join(" + ")} connected` : "Search providers not configured"}</div></div>
          {providers.configurationWarnings.map((warning) => <p className="warning-message config-warning" key={warning}>{warning}</p>)}
          <section className="panel search-panel">
            <form className="search-form" onSubmit={submitSearch}>
              <label className="field"><span>BUSINESS NAME</span><div className="input-wrap"><Building2 size={16} /><input aria-label="Business name" placeholder="e.g. Northside Coffee" value={queryName} onChange={(event) => setQueryName(event.target.value)} required minLength={2} maxLength={120} /></div></label>
              <label className="field"><span>CITY, STATE OR ZIP</span><div className="input-wrap"><MapPin size={16} /><input aria-label="City, state or ZIP" placeholder="e.g. Austin, TX" value={queryLocation} onChange={(event) => setQueryLocation(event.target.value)} required minLength={2} maxLength={120} /></div></label>
              <button className="primary-button search-button" type="submit" disabled={isSearching}>{isSearching ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}{isSearching ? "Searching…" : "Search listings"}<ArrowRight size={15} /></button>
            </form>
            <div className="panel-footnote"><ShieldCheck size={14} /><span>Searches use the location you enter. We do not spoof browser fingerprints or rotate user agents; configured providers receive your query.</span><button type="button" className="text-button" title="Searches are transient server requests and are not stored by this app.">How it works <ArrowUpRight size={13} /></button></div>
            {!providers.googlePlaces && !providers.serpApi && <div className="demo-callout"><div><b>No live search provider is configured.</b><span>Try a clearly marked fictional preview to explore the confirmation flow.</span></div><button type="button" className="outline-button" onClick={loadDemoPreview}>Load demo preview <Sparkles size={14} /></button></div>}
            {(searchError || listings.length > 0 || searchWarnings.length > 0) && <div className="results-block">
              <div className="results-header"><div><b>{searchError ? "Search unavailable" : `${listings.length} listing${listings.length === 1 ? "" : "s"} found`}</b><span>{searchSources.join(" + ") || "Provider results"}</span></div>{listings.length > 0 && <span className={searchSources[0]?.startsWith("DEMO") ? "demo-results" : "live-results"}>{searchSources[0]?.startsWith("DEMO") ? "DEMO ONLY" : "LIVE RESULTS"}</span>}</div>
              {searchError && <p className="error-message" role="alert">{searchError}</p>}
              {searchWarnings.map((warning) => <p className="warning-message" key={warning}>{warning}</p>)}
              {listings.map((listing) => <div className="listing-row" key={listing.id}><div className="listing-mark"><Building2 size={18} /></div><div className="listing-info"><b>{listing.name}</b><span>{[listing.address, listing.phone].filter(Boolean).join(" · ") || "Address and phone not supplied by provider"}</span><div className="listing-meta">{listing.rating !== null && <span><Star size={12} fill="currentColor" /> {listing.rating}{listing.reviewCount !== null && ` (${listing.reviewCount.toLocaleString()})`}</span>}<span>{listing.sources.join(" · ")}</span></div></div><button className="outline-button confirm-button" type="button" onClick={() => selectListing(listing)}>Review details <ArrowRight size={14} /></button></div>)}
              {listings.length === 0 && !searchError && <p className="empty-results">No listings were returned. Try a nearby city or ZIP code.</p>}
            </div>}
          </section>

          {editing && <BusinessForm business={business} onCancel={() => setEditing(false)} onSave={saveBusiness} />}

          <div className="section-heading business-heading" id="business"><div><div className="section-kicker">STEP 02 <span>·</span> VERIFIED PROFILE</div><h2>{hasBusiness ? business.name : "Confirm your business"}</h2><p>{hasBusiness ? "Your confirmed details are the source of truth for each check." : "Choose a live result or enter business details manually."}</p></div>{hasBusiness && <button type="button" className="outline-button" onClick={() => setEditing(true)}>Edit details <ChevronDown size={14} /></button>}</div>
          <section className="panel business-panel">
            {hasBusiness ? <div className="business-overview">
              <div className="business-identity"><span className="business-avatar"><Building2 size={22} /></span><div><div className="business-name">{business.name}</div><span className="confirmed-label"><BadgeCheck size={14} /> Details confirmed by you</span></div></div>
              {demoBusiness && <p className="demo-profile-note">Fictional demo profile: calls, GPS check-ins, and live visibility audits are disabled.</p>}
              <div className="business-details"><div><span className="detail-label">PHONE</span><a href={business.phone ? `tel:${business.phone}` : undefined}>{business.phone || "Not provided"}</a></div><div><span className="detail-label">ADDRESS</span><span>{business.address || "Not provided"}</span></div><div><span className="detail-label">WEBSITE</span>{business.website ? <a href={business.website} target="_blank" rel="noreferrer">{business.website.replace(/^https?:\/\//, "")} <ExternalLink size={12} /></a> : <span>Not provided</span>}</div></div>
              <div className="source-row"><span className="source-badge">{business.source}</span><span className="source-note">Confirmed by you · saved on this device</span><button type="button" className="text-button" onClick={() => setEditing(true)}>Update details <ArrowRight size={13} /></button></div>
            </div> : <div className="empty-business"><div className="empty-illustration"><Building2 size={22} /><span><Plus size={14} /></span></div><div><b>No business confirmed yet</b><p>Search above or enter your business details manually.</p></div><button className="outline-button" type="button" onClick={() => { setBusiness({ ...emptyBusiness, id: makeId() }); setEditing(true); }}>Add manually <ArrowRight size={14} /></button></div>}
          </section>

          <div className="section-heading split-heading" id="verification"><div><div className="section-kicker">STEP 03 <span>·</span> VERIFICATION & ARRIVAL</div><h2>Confirm the real-world details</h2><p>Call the business and check in when you arrive.</p></div><span className="not-audit-note"><ShieldCheck size={14} /> Actions are user initiated</span></div>
          <div className="two-column">
            <section className="panel action-panel">
              <div className="action-title"><span className="action-icon call-icon"><Phone size={17} /></span><div><b>Manual phone verification</b><span>Use this device's phone app or calling handler</span></div><span className="mini-status ready"><i />NO CREDENTIALS</span></div>
              {manualOutcome && <div className="manual-outcome" role="status"><b>{manualOutcome.status}</b><span>{manualOutcome.detail}</span></div>}
              <div className="action-buttons"><a className={`outline-button ${!safeTelHref(business.phone) || demoBusiness ? "disabled-link" : ""}`} href={safeTelHref(business.phone) && !demoBusiness ? safeTelHref(business.phone) : undefined} onClick={() => { if (safeTelHref(business.phone) && !demoBusiness) openPhoneDialer(); }}><Phone size={15} /> Open phone app <ArrowUpRight size={13} /></a></div>
              {safeTelHref(business.phone) && !demoBusiness && <div className="outcome-row"><span>Log manual outcome</span>{["Reached", "No answer", "Voicemail"].map((result) => <button type="button" key={result} className="outcome-button" onClick={() => logManualOutcome(result)}>{result}</button>)}</div>}
              <p className="fine-print">On a phone, this opens its dialer. On desktop, the OS may hand off to a configured calling app/device. A webpage cannot control a USB/Bluetooth-connected phone without a companion/native app or OS call handler. Call result is never detected automatically.</p>
            </section>
            <section className="panel action-panel" id="checkin">
              <div className="action-title"><span className="action-icon location-icon"><LocateFixed size={17} /></span><div><b>GPS arrival check-in</b><span>Verify on-site presence within 50 m</span></div><span className="mini-status ready"><i />BROWSER LOCATION</span></div>
              <div className={`geo-result ${geo.status}`}><span className="geo-marker">{geo.status === "success" ? <CheckCircle2 size={17} /> : <MapPin size={17} />}</span><div><b>{geo.status === "idle" ? "Location not checked" : geo.status === "loading" ? "Checking your location…" : geo.status === "success" ? "Arrival confirmed" : "Check-in not confirmed"}</b><span>{geo.message || "Allow location access when prompted. Your coordinates are only checked in this browser."}</span></div></div>
              {!secureContext && <p className="warning-message">Browser geolocation and PWA installation require HTTPS outside localhost. Use the HTTPS deployment or a trusted local certificate on your phone.</p>}
              <div className="action-buttons"><button type="button" className="primary-button" disabled={!hasBusiness || demoBusiness || geo.status === "loading"} onClick={checkIn}>{geo.status === "loading" ? <LoaderCircle className="spin" size={15} /> : <LocateFixed size={15} />}{geo.status === "loading" ? "Checking…" : "Check in now"}<ArrowRight size={14} /></button>{directionsUrl && <a className="outline-button" href={directionsUrl} target="_blank" rel="noreferrer"><Navigation size={15} /> Get directions <ArrowUpRight size={13} /></a>}</div>
              <p className="fine-print">GPS results can be inaccurate indoors; check-in is not proof of identity.</p>
            </section>
          </div>

          <div className="section-heading visibility-heading" id="visibility"><div><div className="section-kicker">STEP 04 <span>·</span> ONLINE FOOTPRINT</div><h2>Search visibility</h2><p>Provider-backed signals only. Unavailable data is labeled, never estimated.</p></div><button type="button" className="outline-button" disabled={!hasBusiness || demoBusiness || auditBusy} onClick={runAudit}>{auditBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{auditBusy ? "Measuring…" : "Run visibility audit"}<ArrowRight size={14} /></button></div>
          <section className="panel visibility-panel">
            <div className="visibility-top"><div><div className="audit-label"><Globe2 size={14} /> SEARCH FOOTPRINT <span className="audited-dot" /></div><h3>{hasAudit ? "Latest measured signals" : "Visibility signals, not vanity metrics"}</h3><p>{hasAudit ? `Measured ${formatTime(auditAt)}. Results vary by query and location.` : "Run an audit with a configured provider to see available results."}</p></div><div className="coverage-wrap"><div className="coverage-ring"><span>{coverage === null ? "—" : `${coverage}/${audit.length}`}</span></div><span>{coverage === null ? "NO AUDIT" : "MEASURED"}</span></div></div>
            <div className="metric-grid">{(hasAudit ? audit : [
              { label: "Map pack", value: "Not measured", detail: "SerpAPI Google Search local results required", available: false },
              { label: "Google Maps position", value: "Not measured", detail: "SerpAPI Google Maps required", available: false },
              { label: "Organic visibility", value: "Not measured", detail: "SerpAPI Google Search required", available: false },
              { label: "AI overview", value: "Not measured", detail: "Provider support required", available: false },
              {label: "NAP consistency", value: "Not measured", detail: "Google Places + SerpAPI Maps required", available: false },
              { label: "Directory coverage", value: "Not measured", detail: "Supported directory result pages required", available: false },
              { label: "Indexed pages", value: "Not measured", detail: "Supported provider required", available: false },
              { label: "Backlinks", value: "Not measured", detail: "Supported provider required", available: false },
            ]).map((metric) => <div className="metric-cell" key={metric.label}><div className="metric-name"><span className={`metric-indicator ${metric.available ? "measured" : ""}`} />{metric.label}<button type="button" aria-label={`About ${metric.label}`} title={metric.detail}><CircleHelp size={13} /></button></div><b className={metric.available ? "metric-value" : "metric-unavailable"}>{metric.value}</b><span>{metric.detail}</span></div>)}</div>
            {auditWarnings.map((warning) => <p className="warning-message" key={warning}>{warning}</p>)}
            <div className="audit-disclosure"><ShieldCheck size={15} /><span>Search provider results are snapshots, not rankings guaranteed across every user or location. Queries use your confirmed business location.</span></div>
          </section>

          <div className="bottom-grid">
            <section id="reviews" className="panel review-panel">
              <div className="panel-heading"><div><div className="section-kicker">REVIEW OUTLETS</div><h3>Your review links</h3></div><button type="button" className="small-edit" onClick={() => { if (hasBusiness) setEditing(true); else { setBusiness({ ...emptyBusiness, id: makeId() }); setEditing(true); } }}>+ Add link</button></div>
              {business.reviewUrls.length ? <div className="review-list">{business.reviewUrls.map((url) => <a href={safeHttpUrl(url) || undefined} target="_blank" rel="noreferrer" key={url} className="review-link"><span className="review-brand"><Star size={15} /></span><span><b>{reviewHost(url)}</b><small>{url}</small></span><ExternalLink size={15} /></a>)}</div> : <div className="empty-review"><span className="empty-link-icon"><ExternalLink size={17} /></span><span><b>No review links added</b><small>Add verified review URLs in your business details.</small></span></div>}
              <p className="review-note"><ShieldCheck size={13} /> Only links you confirm are shown here.</p>
            </section>
            <section id="activity" className="panel activity-panel">
              <div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h3>Field log</h3></div><span className="activity-count">{activities.length.toString().padStart(2, "0")} EVENTS</span></div>
              {activities.length ? <div className="activity-list">{activities.slice(0, 5).map((item) => <div className="activity-entry" key={item.id}><span className={`activity-icon ${item.type}`}>{item.type === "call" ? <Phone size={14} /> : <MapPin size={14} />}</span><span className="activity-copy"><b>{item.status}</b><small>{item.detail}</small></span><time>{formatTime(item.createdAt)}</time></div>)}</div> : <div className="empty-activity"><Clock3 size={17} /><span>Calls and GPS check-ins will appear here.</span></div>}
              <div className="activity-foot"><span><span className="live-dot" /> LOCAL SESSION LOG</span><span>{privacy ? <><EyeOff size={13} /> Not saved</> : privateActivityIds.current.size > 0 ? <><EyeOff size={13} /> Some events not saved</> : <><Check size={13} /> Saved on device</>}</span></div>
            </section>
          </div>

          <footer className="page-footer"><a className="footer-brand" href="#"><span className="brand-mark"><AudioLines size={16} /></span> resultsflow</a><span>Built for local businesses. No browser fingerprinting, ever.</span><a href="https://www.google.com/maps" target="_blank" rel="noreferrer">Map data by Google Maps <ArrowUpRight size={12} /></a></footer>
        </div>
      </section>
    </main>
  );
}

function BusinessForm({ business, onCancel, onSave }: { business: Business; onCancel: () => void; onSave: (value: Business) => void }) {
  const [draft, setDraft] = useState<Business>(business);
  const [reviewUrls, setReviewUrls] = useState(business.reviewUrls.join("\n"));
  const update = (key: keyof Business, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.website && !safeHttpUrl(draft.website)) {
      alert("Website URLs need to begin with https:// or http://.");
      return;
    }
    const urls = reviewUrls.split(/\n|,/).map((value) => value.trim()).filter(Boolean);
    if (urls.some((url) => !safeHttpUrl(url))) {
      alert("Review links must be valid http or https URLs.");
      return;
    }
    onSave({ ...draft, id: draft.id || makeId(), reviewUrls: urls });
  };
  return <section className="panel edit-panel" aria-label="Confirm business details"><div className="panel-heading"><div><div className="section-kicker">CONFIRM DETAILS</div><h3>Review before saving</h3></div><button className="icon-button" type="button" aria-label="Close" onClick={onCancel}><X size={16} /></button></div><p className="edit-intro">Confirm the name, contact information, and location. This profile is saved locally in your browser.</p><form onSubmit={submit} className="edit-form">
    <label className="field"><span>BUSINESS NAME</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} required minLength={2} maxLength={120} /></label>
    <label className="field"><span>PHONE</span><input value={draft.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+1 (555) 010-2020" maxLength={24} /></label>
    <label className="field wide"><span>FORMATTED ADDRESS</span><input value={draft.address} onChange={(event) => update("address", event.target.value)} placeholder="Street, city, state, ZIP" maxLength={200} /></label>
    <label className="field"><span>LATITUDE</span><input type="number" step="any" min="-90" max="90" value={draft.latitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value ? Number(event.target.value) : null }))} placeholder="30.2672" /></label>
    <label className="field"><span>LONGITUDE</span><input type="number" step="any" min="-180" max="180" value={draft.longitude ?? ""} onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value ? Number(event.target.value) : null }))} placeholder="-97.7431" /></label>
    <label className="field wide"><span>WEBSITE</span><input type="url" value={draft.website} onChange={(event) => update("website", event.target.value)} placeholder="https://example.com" maxLength={2048} /></label>
    <label className="field wide"><span>REVIEW URLS <small>One per line</small></span><textarea rows={3} value={reviewUrls} onChange={(event) => setReviewUrls(event.target.value)} placeholder={"https://g.page/r/...\nhttps://www.yelp.com/biz/..."} /></label>
    <div className="edit-source">Listing source: {draft.source}</div><div className="edit-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button"><Check size={15} /> Confirm & save <ArrowRight size={14} /></button></div>
  </form></section>;
}
