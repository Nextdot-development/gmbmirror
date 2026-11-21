import type { BusinessType } from "./types";

export const LANGUAGES: { value: "en" | "hi" | "hinglish"; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिन्दी)" },
  { value: "hinglish", label: "Hinglish (Hindi in English letters)" },
];

export type CategoryInfo = {
  /** Shown in the form and saved on the business. */
  label: string;
  type: BusinessType;
  /** How the category reads in a customer's question: "a trusted {one} in Pune", "the best {many} in Pune". */
  one: string;
  many: string;
  /** Short description, used as context for AI prompts. */
  about: string;
  /**
   * Parts of Google place types that fit this category ("hospital" matches hospital and general_hospital).
   * Used to check whether Google's primary category matches the one chosen here. Empty: not checked.
   */
  googleTypes: string[];
};

export const CATEGORIES: CategoryInfo[] = [
  // Healthcare. "Doctor / Clinic" stays first: it is the most common choice and the form's default.
  { label: "Doctor / Clinic", type: "healthcare", one: "clinic", many: "clinics", about: "a doctor's clinic or polyclinic", googleTypes: ["doctor", "clinic", "physician"] },
  { label: "Hospital", type: "healthcare", one: "hospital", many: "hospitals", about: "a hospital", googleTypes: ["hospital"] },
  { label: "Multi-speciality Hospital", type: "healthcare", one: "multi-speciality hospital", many: "multi-speciality hospitals", about: "a multi-speciality hospital with several departments", googleTypes: ["hospital"] },
  { label: "General Hospital", type: "healthcare", one: "general hospital", many: "general hospitals", about: "a general hospital", googleTypes: ["hospital"] },
  { label: "Eye Hospital", type: "healthcare", one: "eye hospital", many: "eye hospitals", about: "an eye hospital or eye care centre", googleTypes: ["hospital", "eye", "optic", "ophthalm"] },
  { label: "Dental Clinic", type: "healthcare", one: "dental clinic", many: "dental clinics", about: "a dental clinic", googleTypes: ["dent"] },
  { label: "Dermatology Clinic", type: "healthcare", one: "dermatology clinic", many: "dermatology clinics", about: "a skin (dermatology) clinic", googleTypes: ["skin", "dermat", "doctor", "clinic"] },
  { label: "Diagnostic Centre", type: "healthcare", one: "diagnostic centre", many: "diagnostic centres", about: "a diagnostic centre or pathology lab", googleTypes: ["lab", "diagnos"] },
  { label: "Physiotherapy Centre", type: "healthcare", one: "physiotherapy centre", many: "physiotherapy centres", about: "a physiotherapy centre", googleTypes: ["physio"] },
  { label: "Pharmacy", type: "healthcare", one: "pharmacy", many: "pharmacies", about: "a pharmacy or chemist", googleTypes: ["pharmacy", "drugstore", "chemist"] },
  { label: "Therapist or counsellor", type: "healthcare", one: "therapist", many: "therapists", about: "a therapist or counsellor", googleTypes: ["therap", "psych", "counsel"] },
  { label: "Other healthcare", type: "healthcare", one: "healthcare provider", many: "healthcare providers", about: "a healthcare provider", googleTypes: [] },
  // Local businesses
  { label: "Restaurant", type: "general", one: "restaurant", many: "restaurants", about: "a restaurant", googleTypes: ["restaurant", "food", "meal"] },
  { label: "Cafe", type: "general", one: "cafe", many: "cafes", about: "a cafe", googleTypes: ["cafe", "coffee", "bakery", "tea"] },
  { label: "Salon", type: "general", one: "salon", many: "salons", about: "a hair or beauty salon", googleTypes: ["salon", "hair", "beauty", "barber"] },
  { label: "Spa", type: "general", one: "spa", many: "spas", about: "a spa", googleTypes: ["spa", "massage", "wellness"] },
  { label: "Gym", type: "general", one: "gym", many: "gyms", about: "a gym or fitness centre", googleTypes: ["gym", "fitness", "yoga", "sports"] },
  { label: "Hotel", type: "general", one: "hotel", many: "hotels", about: "a hotel", googleTypes: ["hotel", "lodging", "guest", "resort", "inn"] },
  { label: "Retail shop", type: "general", one: "shop", many: "shops", about: "a retail shop", googleTypes: ["store", "shop"] },
  { label: "Other local business", type: "general", one: "local business", many: "local businesses", about: "a local business", googleTypes: [] },
];

/** Category names saved before 19 November 2026. Saved data is not rewritten; it is read through this map. */
const LEGACY_CATEGORIES: Record<string, string> = {
  "Doctor or clinic": "Doctor / Clinic",
  Dentist: "Dental Clinic",
  "Diagnostic centre": "Diagnostic Centre",
  Physiotherapy: "Physiotherapy Centre",
  "Salon or spa": "Salon",
  "Restaurant or cafe": "Restaurant",
  "Gym or fitness": "Gym",
  "Other local service": "Other local business",
};

/** The category details for a saved category, including names saved by older versions. Unknown names still work. */
export function categoryInfo(category: string, type: BusinessType = "general"): CategoryInfo {
  const label = LEGACY_CATEGORIES[category] ?? category;
  const found = CATEGORIES.find((c) => c.label === label);
  if (found) return found;
  const lower = category.trim().toLowerCase() || "local business";
  return { label: category, type, one: lower, many: lower, about: `a ${lower}`, googleTypes: [] };
}

/** Whether Google's primary type (for example "general_hospital") fits the chosen category. Undefined: not checkable. */
export function typeMatchesCategory(googleType: string | undefined, category: string): boolean | undefined {
  const hints = categoryInfo(category).googleTypes;
  if (!googleType || !hints.length) return undefined;
  const t = googleType.toLowerCase();
  return hints.some((h) => t.includes(h));
}

export const HEALTHCARE_CATEGORIES = CATEGORIES.filter((c) => c.type === "healthcare").map((c) => c.label);
export const GENERAL_CATEGORIES = CATEGORIES.filter((c) => c.type === "general").map((c) => c.label);

export const copyFor = (t: BusinessType) =>
  t === "healthcare"
    ? {
        customer: "patient",
        customers: "patients",
        example: "Dr. Meera Sahu, dermatologist in Bhubaneswar",
        replyRule: "Never mention diagnoses, treatments or any patient detail in a public reply.",
      }
    : {
        customer: "customer",
        customers: "customers",
        example: "Lotus Spa and Salon in Indiranagar",
        replyRule: "Keep replies short, specific to what the reviewer said, and polite.",
      };

/** Profile completeness items the owner confirms by hand until the Google API is approved. */
export const AUDIT_ITEMS: { key: string; label: string; why: string; healthcareOnly?: boolean }[] = [
  { key: "primary_category", label: "Primary category names your main service", why: "Google uses it to decide which searches you appear for." },
  { key: "secondary_categories", label: "Secondary categories added", why: "Covers related services without changing the main category." },
  { key: "services", label: "Every service is listed", why: "Services in your profile match more specific searches." },
  { key: "hours", label: "Opening hours and holiday hours are current", why: "Wrong hours are the most common reason for bad reviews." },
  { key: "description", label: "Description is between 300 and 600 characters", why: "The limit is 750. Google does not allow links or offers in it." },
  { key: "photos", label: "At least 10 recent photos added", why: "Profiles with real photos get more calls and direction requests." },
  { key: "website", label: "Website is listed on the profile", why: "Also a Google requirement for API access." },
  { key: "phone", label: "Phone number matches your website", why: "Name, address and phone should be identical everywhere." },
  { key: "review_replies", label: "Every review has a reply", why: "Replies show future customers that someone is listening." },
  { key: "booking_link", label: "Booking or appointment link added", why: "Lets people act straight from the profile.", healthcareOnly: false },
  { key: "doctor_profiles", label: "Doctor names and qualifications are on your website", why: "Helps people and AI assistants confirm who treats them.", healthcareOnly: true },
];

export const CHATGPT_PREPARE = [
  { key: "legal_name", label: "Legal business name exactly as on your registration" },
  { key: "address", label: "Full address, written the same way as on Google" },
  { key: "phone", label: "Business phone number that someone answers" },
  { key: "website", label: "Website that lists the same name, address and phone" },
  { key: "proof", label: "A document that proves you run the business (registration, licence or utility bill)" },
  { key: "owner_email", label: "An email address on your business domain" },
  { key: "hours_services", label: "Opening hours and the list of services written out" },
  { key: "photos", label: "Logo and a few recent photos" },
];

export const CHATGPT_STEPS = [
  "Open ChatGPT and search for your business by name and city. Note what it says now.",
  "Look for an official way to claim or manage business information. OpenAI controls this, so use only its own help pages and sign in links.",
  "Prepare everything in the checklist below before you start, so one sitting is enough.",
  "Follow the verification steps OpenAI shows you. If it asks for a document or a code, use the ones from your checklist.",
  "After approval, compare what ChatGPT shows with your Google profile and fix any difference.",
  "Record your progress here and add any numbers OpenAI shows you as a dated note.",
];
