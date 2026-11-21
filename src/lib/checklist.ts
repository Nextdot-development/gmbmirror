import { AUDIT_ITEMS } from "./business";
import type { AuditRecord, Business, GoogleVerdict } from "./types";

/**
 * The profile checklist, combining the owner's own ticks with what the last profile audit could verify on Google.
 * Google's answer never overwrites the owner's tick; a disagreement is shown so the owner can choose.
 * Items Google cannot report stay with the owner's answer, or "not confirmed yet", never "missing".
 */

/** What each verdict means for the items a profile audit can check. Other items are owner-only. */
export const GOOGLE_CHECKED: Record<string, Partial<Record<GoogleVerdict, string>>> = {
  hours: { yes: "Google shows opening hours. Holiday hours cannot be checked here.", no: "Google shows no opening hours." },
  photos: { yes: "Google shows 10 or more photos. How recent they are cannot be checked here.", no: "Google shows fewer than 10 photos." },
  website: { yes: "Google lists a website.", no: "Google shows no website." },
  phone: {
    yes: "Google lists a phone number, and it matches the one in your Settings.",
    no: "Google shows no phone number.",
    attention: "Google's phone number is different from the one in your Settings.",
    partial: "Google lists a phone number. Add your phone in Settings to check that it matches.",
  },
  primary_category: {
    yes: "Google's primary category fits the category you chose.",
    no: "Google shows no primary category.",
    attention: "Google's primary category does not fit the category you chose.",
    partial: "Google shows a primary category, but this category cannot be checked against it.",
  },
};

/** After this many days a Google verdict is shown as possibly out of date. */
export const STALE_DAYS = 30;

export type ChecklistStatus = "verified" | "missing" | "attention" | "confirmed" | "unknown";

export type ChecklistRow = {
  key: string;
  label: string;
  why: string;
  /** The owner's own tick. */
  owner: boolean;
  /** Present when the last audit gave a verdict for this item. */
  google?: { verdict: GoogleVerdict; text: string; at: string; stale: boolean };
  /** verified / missing / attention come from Google; confirmed is the owner's tick; unknown is neither. */
  status: ChecklistStatus;
  /** The owner's tick and Google's answer disagree. */
  conflict: boolean;
};

export function checklistRows(b: Business, audit?: AuditRecord | null, now = Date.now()): ChecklistRow[] {
  return AUDIT_ITEMS.filter((i) => (i.healthcareOnly ? b.type === "healthcare" : true)).map((i) => {
    const owner = Boolean(b.audit?.[i.key]);
    const verdict = audit?.checklist?.[i.key];
    const text = verdict ? GOOGLE_CHECKED[i.key]?.[verdict] : undefined;
    const google = verdict && text && audit ? { verdict, text, at: audit.at, stale: now - Date.parse(audit.at) > STALE_DAYS * 86_400_000 } : undefined;
    let status: ChecklistStatus;
    if (google?.verdict === "yes") status = "verified";
    else if (google?.verdict === "no") status = "missing";
    else if (google?.verdict === "attention") status = "attention";
    else status = owner ? "confirmed" : "unknown";
    const conflict = Boolean(google && ((google.verdict === "yes" && !owner) || ((google.verdict === "no" || google.verdict === "attention") && owner)));
    return { key: i.key, label: i.label, why: i.why, owner, google, status, conflict };
  });
}

export const checklistDone = (rows: ChecklistRow[]) => rows.filter((r) => r.status === "verified" || r.status === "confirmed").length;
export const checklistVerified = (rows: ChecklistRow[]) => rows.filter((r) => r.google).length;
