export type BusinessType = "healthcare" | "general";

/** Language for AI reply and post drafts. "hinglish" is Hindi written in Roman script. */
export type ReplyLanguage = "en" | "hi" | "hinglish";

/** Business fields that can come from the owner or from their Google Business Profile. */
export type SourcedField = "name" | "website" | "phone" | "category";
export type FieldSource = "user" | "google";

export type Business = {
  name: string;
  /** May be empty: the website is optional, and filled from Google when the owner connects. */
  website: string;
  location: string;
  category: string;
  type: BusinessType;
  phone?: string;
  /** Google Place ID, used to build the review link. Entered by the owner. */
  placeId?: string;
  /** Language for reply and post drafts and the review message. Missing means English. */
  language?: ReplyLanguage;
  /** Services the business offers (up to 10). Used in post drafts and service-specific visibility questions. */
  services?: string[];
  /** Search phrases to track in the rank grid (up to 5). */
  keywords?: string[];
  /** The review request message, with {name} and {link} placeholders. Missing: the standard message. */
  reviewMessage?: string;
  /** Automatic actions for this location. Missing: manual, nothing automatic. */
  automation?: AutomationSettings;
  /** Other names the business is known by (up to 5). A visibility match on any of them counts as named. */
  aliases?: string[];
  /** Owner's own visibility questions (up to 3), asked as well as the default ones. */
  customQuestions?: string[];
  /** Where each value came from. Missing means the owner entered it (older data, or onboarding). */
  sources?: Partial<Record<SourcedField, FieldSource>>;
  /** Manually entered profile facts used by the profile audit. Source: user provided. */
  audit: Record<string, boolean>;
  createdAt: string;
};

export type VisibilityResult = {
  provider: "claude" | "chatgpt" | "gemini";
  providerLabel: string;
  question: string;
  /** True only for a clear match on the name or an alias. Kept for older checks; see `match`. */
  found: boolean;
  /** named = exact name or alias; possible = close variant, not counted in the score; none = not found. */
  match?: "named" | "possible" | "none";
  /** The variant seen in the answer, for a possible match. */
  possibleName?: string;
  /** Short excerpt around where the business was named, if it was. */
  excerpt: string;
  mentionedBusinesses: string[];
  /** True when listing the other businesses in the answer failed. */
  extractionFailed?: boolean;
};

export type VisibilityCheck = {
  id: string;
  checkedAt: string;
  businessName: string;
  location: string;
  category: string;
  results: VisibilityResult[];
  methodology: string;
  /** Providers whose answers could not be collected; the other providers' results are still saved. */
  failedProviders?: { label: string; error: string }[];
  /** AI-written next steps based on this check. Missing means the fixed list is shown. */
  fixes?: string[];
};

/** Areas of the Business Profile integration, for "last successful sync" times. */
export type GbpArea = "locations" | "profile" | "reviews" | "reply" | "posts" | "insights";

export type GbpMetricGroup = "searchViews" | "mapsViews" | "calls" | "website" | "directions" | "messages" | "bookings";

/** Business Profile performance for two equal periods. Inclusive "YYYY-MM-DD" ranges. */
export type GbpInsights = {
  at: string;
  current: { start: string; end: string; totals: Record<GbpMetricGroup, number> };
  previous: { start: string; end: string; totals: Record<GbpMetricGroup, number> };
  /** Profile views (search + maps) per day in the current period, oldest first. */
  dailyViews: { date: string; value: number }[];
  /** Metric groups Google returned at all. A group missing here is "not reported", not zero. Older data: all. */
  reported?: GbpMetricGroup[];
  /** Totals per full calendar month (oldest first), when Google returned them. */
  monthly?: { month: string; totals: Record<GbpMetricGroup, number> }[];
  /** Claude's explanation of these numbers, written on request. */
  explanation?: { at: string; text: string };
};

export type GoogleConnection = {
  email: string;
  /** AES-GCM encrypted JSON of tokens. */
  tokens: string;
  accountName?: string;
  locationName?: string;
  locationTitle?: string;
  /** The selected location's address and Google Place ID, as Google listed them when it was chosen. */
  locationAddress?: string;
  locationPlaceId?: string;
  connectedAt: string;
  /** Scopes Google granted at sign-in. */
  scopes?: string[];
  /** Google refused the stored refresh token (revoked, expired or password changed): the owner must reconnect. */
  needsReconnect?: boolean;
  /** Last time each area loaded or saved successfully. */
  lastSync?: Partial<Record<GbpArea, string>>;
  /** The most recent failure, shown until the next success in that area. */
  lastError?: { area: GbpArea; at: string; message: string };
  /** Last performance figures fetched for the selected location (the owner's own Business Profile data). */
  insights?: GbpInsights;
  /** The selected location's profile as Google last returned it. Replaced on every sync; removed with the connection. */
  profile?: GbpProfileSnapshot;
};

/** What Google's Business Profile says about the selected location. Fields Google did not return are left out. */
export type GbpProfileSnapshot = {
  /** The location this was read for ("locations/…"); a snapshot for another location is never shown. */
  location: string;
  fetchedAt: string;
  title: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  description?: string;
  /** Opening hours as Google lists them, one line per period ("Monday 09:00–18:00"). Empty: Google has none. */
  hours: string[];
  openStatus?: string;
  verified?: boolean;
  placeId?: string;
  mapsUri?: string;
  rating?: number;
  reviewCount?: number;
};

export type Review = {
  id: string;
  reviewer: string;
  /** 0 when Google has no star rating for the review. */
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  comment: string;
  createdAt: string;
  updatedAt?: string;
  replied: boolean;
  /** The owner's reply as Google has it. state: Google's moderation state (PENDING, APPROVED, REJECTED). */
  reply?: { text: string; updatedAt?: string; state?: string };
  source: "google_api" | "sample";
};

/**
 * draft -> approved (owner approved this exact text) -> posted (Google accepted it).
 * Editing approved text makes it a draft again, so only approved text can be published.
 */
export type ReplyHistoryEntry = { at: string; action: "drafted" | "rewritten" | "edited" | "approved" | "published" | "auto_published" | "held" | "failed"; by: "owner" | "claude" | "automation"; text?: string; note?: string };

export type ReplyDraft = {
  text: string; status: "draft" | "approved" | "posted"; updatedAt: string; postedAt?: string; googleState?: string;
  /** What happened to this reply, newest first (kept to 20). */
  history?: ReplyHistoryEntry[];
  /** Why the reply needs the owner's eyes (negative, sensitive, wording to check). Set by the safety checks. */
  holdReasons?: string[];
  /** Drafted by automation rather than by the owner pressing a button. */
  byAutomation?: boolean;
};

export type PostDraft = {
  id: string;
  text: string;
  kind: "STANDARD" | "EVENT" | "OFFER";
  /** The time the owner typed ("YYYY-MM-DDTHH:mm", their local time), shown back to them. */
  scheduledFor?: string;
  /** The same moment in UTC, used by the publishing queue. Set only for approved, scheduled posts. */
  scheduledAt?: string;
  /** Google's call-to-action button. CALL uses the profile's phone number, so it has no link. */
  callToAction?: { actionType: "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL"; url?: string };
  /** Required by Google for EVENT and OFFER posts. Dates are local "YYYY-MM-DDTHH:mm". */
  event?: { title: string; start: string; end: string };
  offer?: { couponCode?: string; termsConditions?: string; redeemOnlineUrl?: string };
  /** A public https link to a photo. Google downloads it when the post is published (sent as the post's media). */
  imageUrl?: string;
  status: "draft" | "approved" | "posted";
  warnings: string[];
  /** Last publish failure, shown on the post until the next attempt. */
  publishError?: string;
  createdAt: string;
  /** Set once Google accepted the post: its resource name, the location it went to, and Google's latest state. */
  googleName?: string;
  publishedTo?: string;
  publishedAt?: string;
  googleState?: string;
  searchUrl?: string;
};

/**
 * This app's own verdict, from a profile audit, about one checklist item ("Google lists a website: yes").
 * yes / no: checked against Google. attention: Google differs from what the owner saved. partial: present on
 * Google, but the rest of the item cannot be checked there.
 */
export type GoogleVerdict = "yes" | "no" | "attention" | "partial";

/** One profile audit: our score, our points per audit item, our checklist verdicts. No Google content. */
export type AuditRecord = { score: number; at: string; items?: Record<string, number>; checklist?: Record<string, GoogleVerdict>; placeId?: string };

export type CompetitorMetricName = "rating" | "reviews" | "photos" | "website" | "phone" | "hours";

/** Counts only: how many compared businesses were ahead of, or behind, the owner on one measure. */
export type CompetitorMetric = { metric: CompetitorMetricName; known: number; ahead: number; behind: number; youHave?: boolean };

export type CompetitorSnapshot = {
  at: string; query: string; position: number | null; compared: number; metrics: CompetitorMetric[]; placeId?: string;
  /** Claude's explanation of these counts, written on request (our own text, not Google content). */
  explanation?: string;
};

/**
 * Only our own scores, ranks, counts, verdicts and timestamps are stored (Google Maps Platform terms allow Place IDs;
 * other Places content is fetched fresh and not kept). Fields added later are optional, so older data still reads.
 * Each entry records the Place ID it was measured for (`placeId`); see listing-history.ts.
 */
/** A business that ranks around you in a grid scan: its place ID and our own counts (never its name). */
export type GridLeader = { id: string; top3: number; found: number; avg: number };
/**
 * One rank grid scan. `ranks`: row by row from the north-west, null = not in the top 20. `size`: 3 or 5 points a
 * side (missing on scans made before 5x5 existed: those are 3x3). `leaders`: the businesses most often in the top 3
 * (missing on older scans).
 */
export type GridScan = { id: string; keyword: string; radiusKm: number; ranks: (number | null)[]; at: string; placeId?: string; size?: 3 | 5; leaders?: GridLeader[] };

export type PlacesHistory = {
  profileScores: AuditRecord[];
  scans: GridScan[];
  competitors?: CompetitorSnapshot[];
};

export type Priority = "Critical" | "High" | "Medium";
export type Difficulty = "Easy" | "Medium" | "Advanced";

/** One recommended action. `evidence` always comes from the business's stored data, never from the AI. */
export type Recommendation = {
  id: string;
  title: string;
  why: string;
  evidence: string[];
  steps: string[];
  benefit: string;
  difficulty: Difficulty;
  priority: Priority;
  href: string;
  /** Content Claude can draft for this action. */
  contentKind?: "description" | "photos" | "review_request" | "website_text" | "faq";
};

export type GrowthState = {
  /** Last recommendation set and the fingerprint of the data it was built from. */
  cache?: { fingerprint: string; at: string; source: "ai" | "rules"; recs: Recommendation[] };
  /** Actions the owner marked as done. */
  completed: { id: string; title: string; at: string }[];
  /** Content drafted for an action plan, kept so it is not generated again. */
  drafts: Record<string, { text: string; at: string; warnings: string[] }>;
};

export type GuideProgress = {
  done: Record<string, boolean>;
  notes: string;
  insights: { date: string; label: string; value: string }[];
};

/* ---------------- Background jobs ---------------- */

export type JobKind = "publish_post" | "review_sweep" | "monthly_report" | "refresh_profile";
/** waiting: cannot run yet for a known reason (for example Google is not connected); checked again later. */
export type JobStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

export type Job = {
  id: string;
  kind: JobKind;
  /** The business location the job belongs to. */
  loc: string;
  /** Duplicate protection: one live job per key (for example "publish_post:<postId>:<scheduledAt>"). */
  key: string;
  runAt: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  /** While running: another runner must not take the job before this time. */
  leaseUntil?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, string>;
  /** Execution history, newest first. */
  log: { at: string; status: JobStatus; message: string }[];
};

/* ---------------- Automation and AI ---------------- */

/** manual: drafts only when asked. approval: drafts made automatically, the owner approves. auto: eligible replies are published. */
export type ReplyMode = "manual" | "approval" | "auto";

export type AutomationSettings = {
  replies: ReplyMode;
  /** Pauses every automatic action for this location at once. */
  paused: boolean;
  /** When the owner explicitly opted in to automatic publishing (required for "auto"). */
  autoOptInAt?: string;
  /** Lowest star rating that may be published automatically (4 or 5). Lower ratings always wait for approval. */
  autoMinStars: 4 | 5;
};

export type AutomationLogEntry = { at: string; action: string; result: "done" | "held" | "skipped" | "failed"; detail: string; reviewId?: string; postId?: string };

/** Claude usage for one user and month. */
export type AiUsage = Record<string, { calls: number; inputTokens: number; outputTokens: number; byFeature: Record<string, number> }>;

/* ---------------- Monthly reports ---------------- */

/** One report section. available=false: the data was not there; `reason` says why (never shown as a zero). */
export type ReportSection = { title: string; available: boolean; reason?: string; lines: string[] };

export type MonthlyReport = {
  id: string;
  /** "YYYY-MM" */
  month: string;
  generatedAt: string;
  trigger: "schedule" | "owner";
  /** The month was not over when the report was made. */
  partial: boolean;
  business: string;
  location: string;
  sections: ReportSection[];
  /** Claude's short summary of the sections; missing when it could not be written. */
  summary?: string;
  summaryError?: string;
};
