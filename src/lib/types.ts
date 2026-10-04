export type Business = {
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  website: string;
  reviewUrls: string[];
  source: string;
};

export type Activity = {
  id: string;
  type: "call" | "checkin";
  status: string;
  detail: string;
  createdAt: string;
};

export type Listing = Business & {
  rating: number | null;
  reviewCount: number | null;
  sources: string[];
};

export type SearchResponse = {
  listings: Listing[];
  sources: string[];
  warnings: string[];
};

export type AuditMetric = {
  label: string;
  value: string;
  detail: string;
  available: boolean;
};
