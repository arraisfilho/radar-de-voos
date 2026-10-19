export type Leg = {
  start: string;
  end: string;
  arrival_before: string | null;
  stops: number[];
  max_duration: number | null;
  max_layover: number | null;
  airlines: string[];
};
export type Config = {
  language: "pt"|"en"|"es";
  currency: string;
  name: string;
  origins: string[];
  destinations: string[];
  outbound: Leg;
  inbound: Leg | null;
  adults: number;
  children: number;
  infants_in_seat: number;
  infants_on_lap: number;
  cabin: string;
  interval: number;
  checked_bags: number;
  target_cents: number | null;
  min_drop_cents: number;
  notify_email: boolean;
  notify_whatsapp?: boolean;
};
/**
 * Kind of the last fare-source failure (API contract, sections 2 and 5).
 * "no_results": the source answered without usable flights for that query.
 */
export type SourceKind =
  | "rate_limited"
  | "blocked"
  | "format"
  | "timeout"
  | "network"
  | "server"
  | "no_results"
  | "unknown";
/** Fare-source health shared by every trip (`/api/state` → `source`). */
export type SourceStatus = {
  status: "ok" | "degraded" | "paused";
  kind: SourceKind | null;
  consecutive_failures: number;
  last_success_at: number | null;
  last_failure_at: number | null;
  /** Only while paused: when a test query is allowed. May be past while it runs. */
  retry_at: number | null;
};
export type SearchRecord = {
  summary?: Partial<Record<"outbound"|"inbound",{price:number;collected:number;ref?:{price:number;collected:number;basis?:"day"|"first"}}>>;
  ends_at: number;
  id: string;
  config: Config;
  version: number;
  active: number;
  state: string;
  next_due: number | null;
  last_started: number | null;
  /** When a manual refresh may run again (epoch seconds). */
  refresh_after?: number;
  last_finished: number | null;
  last_success: number | null;
  progress: number;
  total: number;
  error: string | null;
  /** Prevailing failure kind of the last cycle; older servers omit it. */
  error_kind?: SourceKind | null;
};
export type Flight = {
  airline_codes?: string[];
  currency: string;
  id: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  duration_minutes: number;
  stops: number;
  via: string[];
  airlines: string[];
  price_cents: number;
  adults: number;
  children?: number;
  infants_in_seat?: number;
  infants_on_lap?: number;
  search_url: string;
  collected_at: number;
  stale: boolean;
  direction: string;
  layovers: number[];
  checked_bags_requested?: number;
  segments: {
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
  }[];
};
export type Route = {
  key: string;
  origin: string;
  destination: string;
  date: string;
  direction: string;
  status: string;
  last_attempt: number;
  last_valid: number | null;
  count: number;
  raw_count: number;
  stale: boolean;
  error: string | null;
  /** Set when `stale` is true; older servers omit it. */
  error_kind?: SourceKind | null;
  latency: number;
};
export type Snapshot = {
  previous_price?: number | null;
  currency: string;
  id: number;
  version: number;
  cycle_id: number;
  direction: string;
  collected: number;
  complete: number;
  price: number | null;
  count: number;
};
export type ChannelDelivery = {channel:string;counts:Record<string,number>;receipts?:Record<string,number>;
  /** When the deliveries held by quiet hours go out (counts.held), and the account's time zone to read it. */
  held_until?:number;held_zone?:string};
export type Alert = {
  channels?: ChannelDelivery[];
  id: string;
  version: number;
  direction: string;
  created: number;
  status: string;
  price: number;
  previous: number | null;
  payload: {
    title: string;
    kind: string;
    /** Why the engine alerted: "first", "new_low", "rearmed" or "reminder" (target still met). */
    reason?: string;
    /** The trip's target when the engine alerted (alerts from 0.26 on). */
    target_cents?: number | null;
    flight: Flight;
    previous: number | null;
    saving_cents: number | null;
    saving_percent: number | null;
    comparison: string;
    collected_at: number;
  };
};
export type SMTP = {
  enabled: boolean;
  host: string;
  port: number;
  security: string;
  username: string;
  sender: string;
  recipient: string;
  password_set: boolean;
  password?: string;
};
export type Delivery = {
  recipients: string[];
  id: string;
  created: number;
  status: string;
  attempts: number;
  error: string | null;
  sent: number | null;
  subject: string;
};
export type State = {
  revision?:string;
  quote_expires?:number|null;
  alert_total?:number;
  /** Creation times of the latest 100 alerts, newest first. */
  alert_recent?:number[];
  raw_retention_days?:number;
  token: string;
  server_time: number;
  searches: SearchRecord[];
  archived: SearchRecord[];
  selected: SearchRecord | null;
  flights: Flight[];
  routes: Route[];
  history: Snapshot[];
  alerts: Alert[];
  smtp: SMTP | null;
  mail_provider?: "google" | "smtp" | null;
  user: User;
  email_available: boolean;
  whatsapp_available?: boolean;
  google_mail: GoogleMail | null;
  mail_test_recipient: string | null;
  deliveries: Delivery[];
  airports: Airport[];
  /** Fare-source health; `null` only when the database is unavailable, absent on older servers. */
  source?: SourceStatus | null;
  cycles: {
    id: number;
    version: number;
    started: number;
    finished: number | null;
    /** Includes "interrupted" when queries were skipped while the source was paused. */
    status: string;
    total: number;
    successes: number;
    failures: number;
  }[];
};

export type Airport = {
  code: string;
  city: string;
  name: string;
  /** `name` without " International Airport"/" Intl Airport"/" Airport"; older servers omit it. */
  label?: string;
  country: string;
  timezone: string;
};

export type User = {
  client_number?: number;
  monitoring_counts?: {active:number;paused:number;ended:number;total:number};
  search_limit?: number;
  additional_phones: {country:string;phone:string}[];
  timezone: string;
  quiet_hours: boolean;
  quiet_start: string;
  quiet_end: string;
  language: "pt"|"en"|"es";
  id: string;
  name: string;
  role: "user" | "admin";
  country: string;
  phone: string;
  /** Formatted for display by the backend; older servers send only `phone`. */
  phone_display?: string;
  phone_verified: boolean;
  telegram_username: string;
  emails: string[];
  whatsapp_use_login: boolean;
  whatsapp_country: string;
  whatsapp_phone: string | null;
};

export type GoogleMail = {
  deployment?: "public" | "local";
  client_type?: "web" | "desktop";
  configured: boolean;
  client_id: string;
  client_secret_set: boolean;
  connected: boolean;
  email: string;
  error: string | null;
  redirect_uri: string;
};
