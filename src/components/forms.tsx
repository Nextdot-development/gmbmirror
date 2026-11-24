"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  addGoogleLocationAction, contactAction, resendConfirmationAction, deleteAccountAction, emailReportAction, removeLocationAction, saveNotificationPrefsAction, requestPasswordResetAction, setNewPasswordAction, addInsightAction, chooseLocationAction, createReportAction, explainCompetitorsAction, explainInsightsAction, deleteInsightAction, editInsightAction, editPostAction, logInAction, postComposerAction, refreshFromGoogleAction, refreshInsightsAction,
  replyAction, runVisibilityAction, saveAiPreferencesAction, saveAutomationAction, saveBusinessAction, saveGuideNotesAction, signUpAction, type FormState,
} from "@/app/actions";
import { Field, Msg, SubmitButton } from "./ui";
import { statusLabel } from "./bits";
import { categoryInfo, GENERAL_CATEGORIES, HEALTHCARE_CATEGORIES, LANGUAGES } from "@/lib/business";
import type { AutomationSettings, Business, BusinessType, SourcedField } from "@/lib/types";
import { defaultCategory } from "@/lib/business-sync";

const init: FormState = {};

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [s, action] = useActionState(mode === "login" ? logInAction : signUpAction, init);
  return (
    <>
    <form action={action} className="flex flex-col gap-4" key={JSON.stringify(s.values ?? {})}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email} error={s.fieldErrors?.email} />
      <Field
        label="Password" name="password" type="password" required
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        hint={mode === "signup" ? "At least 8 characters." : undefined} error={s.fieldErrors?.password}
      />
      {mode === "login" ? <p className="caption-2 -mt-2"><Link href="/forgot-password" className="text-brand underline underline-offset-2">Forgot your password?</Link></p> : null}
      <Msg state={s} />
      <SubmitButton pending={mode === "login" ? "Logging in" : "Creating account"}>{mode === "login" ? "Log in" : "Create account"}</SubmitButton>
      <p className="caption-2 text-muted">
        {mode === "login" ? <>New here? <Link href="/signup" className="underline">Create an account</Link></> : <>Already have an account? <Link href="/login" className="underline">Log in</Link></>}
      </p>
    </form>
    {s.resendFor ? <ResendConfirmation email={s.resendFor} key={s.resendFor} /> : null}
    </>
  );
}

/** "Send the link again", under the sign-up result or an unconfirmed login. Its own form (forms cannot nest). */
function ResendConfirmation({ email }: { email: string }) {
  const [s, action] = useActionState(resendConfirmationAction, init);
  return (
    <form action={action} className="mt-4 flex flex-col items-start gap-2 border-t border-line pt-4" data-testid="resend-confirmation">
      <input type="hidden" name="email" value={email} />
      <p className="caption-2 text-muted">No email after a few minutes? Check spam, then:</p>
      <SubmitButton pending="Sending" variant="secondary">Send the confirmation link again</SubmitButton>
      <Msg state={s} />
    </form>
  );
}

/** "Forgot password": asks for the email; the answer is the same whether or not an account exists. */
export function ForgotPasswordForm() {
  const [s, action] = useActionState(requestPasswordResetAction, init);
  return (
    <form action={action} className="flex flex-col gap-4" key={JSON.stringify(s.values ?? {})}>
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email} error={s.fieldErrors?.email} />
      <Msg state={s} />
      <SubmitButton pending="Sending">Send reset link</SubmitButton>
      <p className="caption-2 text-muted">Remembered it? <Link href="/login" className="underline">Log in</Link></p>
    </form>
  );
}

/** After the reset link: the new password, twice. */
export function NewPasswordForm() {
  const [s, action] = useActionState(setNewPasswordAction, init);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="New password" name="password" type="password" autoComplete="new-password" required hint="At least 8 characters." error={s.fieldErrors?.password} />
      <Field label="New password again" name="confirm" type="password" autoComplete="new-password" required error={s.fieldErrors?.confirm} idPrefix="c" />
      <Msg state={s} />
      <SubmitButton pending="Saving">Save new password</SubmitButton>
    </form>
  );
}

function TypeChoice({ type, setType }: { type: BusinessType; setType: (t: BusinessType) => void }) {
  return (
    <fieldset>
      <legend className="label">What kind of business is it?</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["healthcare", "general"] as const).map((t) => (
          <label key={t} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${type === t ? "border-brand bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-3"}`}>
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="accent-accent" />
            <span className="body-5">{t === "healthcare" ? "Healthcare or wellness" : "Local business"}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Onboarding step 1: only what is needed to start. Everything else comes from Google or Settings. */
export function OnboardingForm({ initial }: { initial?: Business | null }) {
  const [s, action] = useActionState(saveBusinessAction, init);
  const [type, setType] = useState<BusinessType>(initial?.type ?? "healthcare");
  const e = s.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" key={JSON.stringify(s.values ?? {})}>
      <input type="hidden" name="step" value="basics" />
      <TypeChoice type={type} setType={setType} />
      <Field label="Business name" name="name" defaultValue={s.values?.name ?? initial?.name} required error={e.name}
        placeholder={type === "healthcare" ? "Dr. Meera Sahu Skin Clinic" : "Lotus Spa and Salon"} />
      <Field label="City or area" name="location" defaultValue={s.values?.location ?? initial?.location} required error={e.location} placeholder="Bhubaneswar" />
      <Field label="Website (optional)" name="website" defaultValue={s.values?.website ?? initial?.website} error={e.website} placeholder="yourclinic.in"
        hint="Leave it empty if you do not have one. We fill it from Google when you connect." />
      <Msg state={s} />
      <div><SubmitButton pending="Saving">Continue</SubmitButton></div>
    </form>
  );
}

const SOURCE_HINT = { user: "Added by you.", google: "From your Google Business Profile." } as const;

/**
 * Settings > Business information. Shows where each value came from. Saving changes only these fields, and marks
 * changed values as the owner's, so a later Google sync does not replace them.
 */
export function BusinessInfoForm({ initial, hints = {} }: { initial: Business; hints?: Partial<Record<"website" | "phone" | "category", string>> }) {
  const [s, action] = useActionState(saveBusinessAction, init);
  const [type, setType] = useState<BusinessType>(initial.type);
  const cats = type === "healthcare" ? HEALTHCARE_CATEGORIES : GENERAL_CATEGORIES;
  const e = s.fieldErrors ?? {};
  const src = (f: SourcedField, extra?: string) => [initial.sources?.[f] ? SOURCE_HINT[initial.sources[f]!] : undefined, extra].filter(Boolean).join(" ") || undefined;
  const savedCat = categoryInfo(initial.category, initial.type).label;
  // The saved category if it belongs to the chosen type, otherwise the general one for that type.
  const fitting = (t: BusinessType) => ((t === "healthcare" ? HEALTHCARE_CATEGORIES : GENERAL_CATEGORIES).includes(savedCat) ? savedCat : defaultCategory(t));
  const [category, setCategory] = useState(s.values?.category ?? fitting(initial.type));
  const catRef = useRef<HTMLSelectElement>(null);
  // React resets a form after each submit; put the chosen category back so what is shown is what is sent.
  useEffect(() => { if (catRef.current) catRef.current.value = category; }, [s, category]);
  return (
    <form action={action} className="flex flex-col gap-4" key={JSON.stringify(s.values ?? {})}>
      <TypeChoice type={type} setType={(t) => { setType(t); setCategory(fitting(t)); }} />
      <Field label="Business name" name="name" defaultValue={s.values?.name ?? initial.name} required error={e.name} hint={src("name")} />
      <div>
        <label htmlFor="f-category" className="label">Category</label>
        <select id="f-category" name="category" ref={catRef} className="field" value={category} onChange={(ev) => setCategory(ev.target.value)}
          aria-invalid={Boolean(e.category)} aria-describedby={e.category ? "f-category-e" : "f-category-h"}>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {e.category ? <p id="f-category-e" className="field-error">{e.category}</p>
          : <p id="f-category-h" className="hint">{src("category", "Decides which businesses you are compared with and what AI assistants are asked.")}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City or area" name="location" defaultValue={s.values?.location ?? initial.location} required error={e.location} />
        <Field label="Phone (optional)" name="phone" type="tel" defaultValue={s.values?.phone ?? initial.phone} error={e.phone} hint={src("phone", hints.phone)} />
      </div>
      <Field label="Website (optional)" name="website" defaultValue={s.values?.website ?? initial.website} error={e.website} placeholder="yourclinic.in" hint={src("website", hints.website)} />
      <Msg state={s} />
      <div><SubmitButton pending="Saving">Save changes</SubmitButton></div>
    </form>
  );
}

/** Settings > AI preferences. Saved on their own, so they never overwrite the business information. */
export function AiPreferencesForm({ initial }: { initial: Business }) {
  const [s, action] = useActionState(saveAiPreferencesAction, init);
  const e = s.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" key={JSON.stringify(s.values ?? {})}>
      <Field label="Reply and post language" name="language" as="select" defaultValue={s.values?.language ?? initial.language ?? "en"}
        hint="Used for new AI drafts of review replies and posts, and for the WhatsApp review message.">
        {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </Field>
      <Field label="Other names (optional)" name="aliases" as="textarea" rows={3} error={e.aliases}
        defaultValue={s.values?.aliases ?? initial.aliases?.join("\n")}
        hint="Up to 5, one per line, for example a short name or the doctor's name. AI visibility checks count a match on any of them." />
      <Field label="Your own visibility questions (optional)" name="customQuestions" as="textarea" rows={3} error={e.customQuestions}
        defaultValue={s.values?.customQuestions ?? initial.customQuestions?.join("\n")}
        hint="Up to 3, one per line, for example: Where can I get a skin allergy test in Bhubaneswar? Asked as well as the standard questions." />
      <Field label="Services (optional)" name="services" as="textarea" rows={3} error={e.services}
        defaultValue={s.values?.services ?? initial.services?.join("\n")}
        hint="Up to 10, one per line. Used in post drafts and for service questions in AI visibility checks. Only list what you really offer." />
      <Field label="Search phrases to track (optional)" name="keywords" as="textarea" rows={3} error={e.keywords}
        defaultValue={s.values?.keywords ?? initial.keywords?.join("\n")}
        hint="Up to 5, one per line, for example: skin clinic near me. Offered in the local rank grid." />
      <Field label="Review request message (optional)" name="reviewMessage" as="textarea" rows={3} error={e.reviewMessage}
        defaultValue={s.values?.reviewMessage ?? initial.reviewMessage}
        hint="Your own WhatsApp message asking for a review. Use {name} for the business name and {link} for the review link. Empty: the standard message in your language." />
      <Msg state={s} />
      <div><SubmitButton pending="Saving">Save AI preferences</SubmitButton></div>
    </form>
  );
}

/** Reads the Business Profile again and fills what is missing. */
export function RefreshFromGoogle() {
  const [s, action] = useActionState(refreshFromGoogleAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton variant="secondary" small pending="Reading Google">Refresh from Google</SubmitButton>
      <Msg state={s} />
    </form>
  );
}

export function VisibilityForm({ hasProvider }: { hasProvider: boolean }) {
  const [s, action] = useActionState(runVisibilityAction, init);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Msg state={s} />
      <div><SubmitButton pending="Asking the AI models. This takes up to a minute." >Run a new check</SubmitButton></div>
      {!hasProvider ? <p className="hint">Add ANTHROPIC_API_KEY to your .env file to enable checks.</p> : null}
    </form>
  );
}

/**
 * Reply workflow for one review: draft with Claude or type, adjust (shorter, more detailed, more professional, more
 * friendly, try again), save, approve this exact text, then publish. Publish appears only for a live Google location
 * and only while the text is the approved text. Reviews that need care ask for a confirmation before approval.
 */
export function ReplyEditor({
  reviewId, reviewer, initialText, status: initialStatus, canPostLive, label = "Reply", care = [],
}: { reviewId: string; reviewer: string; initialText: string; status?: string; canPostLive: boolean; label?: string; care?: string[] }) {
  const [s, action] = useActionState(replyAction, init);
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState(initialStatus);
  const [approvedText, setApprovedText] = useState(initialStatus === "approved" ? initialText : null);
  useEffect(() => { if (s.text !== undefined) setText(s.text); }, [s]);
  useEffect(() => {
    if (!s.status) return;
    setStatus(s.status);
    setApprovedText(s.status === "approved" ? s.text ?? null : null);
  }, [s]);
  const approvedNow = status === "approved" && approvedText !== null && text.trim() === approvedText;
  const changedAfterApproval = status === "approved" && !approvedNow;
  const hasText = text.trim().length > 0;
  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label className="sr-only" htmlFor={`r-${reviewId}`}>{label} for {reviewer}</label>
      <textarea id={`r-${reviewId}`} name="text" className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply, or let Claude draft one." />
      {hasText ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Change the reply">
          {([["rewrite:shorter", "Shorter"], ["rewrite:longer", "More detailed"], ["rewrite:professional", "More professional"], ["rewrite:friendly", "More friendly"], ["rewrite:regenerate", "Try again"]] as const).map(([v, l]) => (
            <SubmitButton key={v} name="intent" value={v} variant="ghost" small pending="Rewriting">{l}</SubmitButton>
          ))}
        </div>
      ) : null}
      <Msg state={s} />
      {s.warnings?.length ? (
        <ul className="flex flex-col gap-1" aria-label="Wording to reread before posting">
          {s.warnings.map((w) => <li key={w} className="caption-1 text-warn">{w}</li>)}
        </ul>
      ) : null}
      {care.length && !approvedNow ? (
        <label className="caption-1 flex items-start gap-2">
          <input type="checkbox" name="confirmSensitive" value="yes" className="mt-0.5" />
          <span>I have read this reply and it is right for this review.</span>
        </label>
      ) : null}
      {changedAfterApproval ? <p className="caption-2 text-warn">You changed the reply after approving it. Approve it again before publishing.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="intent" value="draft" variant="secondary" small pending="Drafting">Draft with Claude</SubmitButton>
        <SubmitButton name="intent" value="save" variant="ghost" small pending="Saving">Save draft</SubmitButton>
        {!approvedNow ? <SubmitButton name="intent" value="approve" variant={canPostLive ? "secondary" : "primary"} small pending="Approving">Approve</SubmitButton> : null}
        {canPostLive && approvedNow ? <SubmitButton name="intent" value="publish" small pending="Publishing">Publish reply to Google</SubmitButton> : null}
        {status ? <span className="badge">{changedAfterApproval ? "Edited after approval" : statusLabel(status)}</span> : null}
      </div>
    </form>
  );
}

export function PostComposer({ healthcare }: { healthcare: boolean }) {
  const [s, action] = useActionState(postComposerAction, init);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("STANDARD");
  const kindRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (s.text) setText(s.text); }, [s.text]);
  // React resets the form after every submit, which puts the select back on its first option.
  // Put it back on the chosen type so the visible value and the submitted value match the fields shown.
  useEffect(() => { if (kindRef.current) kindRef.current.value = kind; }, [s, kind]);
  // Clear the composer after a successful save so the same post is not saved twice.
  useEffect(() => {
    if (s.saved) {
      setText("");
      setKind("STANDARD");
      setCta("");
    }
  }, [s.saved]);
  const v = s.values ?? {};
  const [cta, setCta] = useState(v.ctaType ?? "");
  const ctaRef = useRef<HTMLSelectElement>(null);
  // Same as the type: React's form reset would otherwise send "no button" while "Book" is still shown.
  useEffect(() => { if (ctaRef.current) ctaRef.current.value = cta; }, [s, cta]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <TimeZoneField />
      <Field label="What is the post about?" name="topic" defaultValue={v.topic} placeholder={healthcare ? "Monsoon skin care tips for patients" : "New weekend menu"} />
      <div className="flex flex-col gap-2">
        <label htmlFor="p-text" className="label">Post text</label>
        <textarea id="p-text" name="text" className="field" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="hint">{text.length} of 1500 characters</p>
      </div>
      {s.variants?.length ? (
        <div className="flex flex-col gap-2" role="group" aria-label="Versions from Claude">
          <p className="label">Versions from Claude</p>
          {s.variants.map((t, i) => (
            <div key={i} className={`inset flex flex-col gap-2 ${text === t ? "border-brand" : ""}`}>
              <p className="body-6 whitespace-pre-wrap">{t}</p>
              <button type="button" className="btn btn-secondary btn-sm w-fit" onClick={() => setText(t)} aria-pressed={text === t}>{text === t ? "Using this version" : `Use version ${i + 1}`}</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="f-kind" className="label">Type</label>
          <select id="f-kind" name="kind" ref={kindRef} className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="STANDARD">Update</option>
            <option value="EVENT">Event</option>
            {!healthcare ? <option value="OFFER">Offer</option> : null}
          </select>
        </div>
        <Field label="Schedule for (optional)" name="scheduledFor" type="datetime-local" defaultValue={v.scheduledFor}
          hint="Approved posts with a time are published automatically at that time, once Google is connected." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="f-ctaType" className="label">Button (optional)</label>
          <select id="f-ctaType" name="ctaType" ref={ctaRef} className="field" value={cta} onChange={(e) => setCta(e.target.value)}>
            <option value="">No button</option>
            <option value="BOOK">Book</option>
            <option value="CALL">Call now</option>
            <option value="LEARN_MORE">Learn more</option>
            {!healthcare ? <><option value="ORDER">Order online</option><option value="SHOP">Buy</option></> : null}
            <option value="SIGN_UP">Sign up</option>
          </select>
        </div>
        {cta && cta !== "CALL" ? <Field label="Button link" name="ctaUrl" type="url" placeholder="https://" defaultValue={v.ctaUrl} /> : null}
      </div>
      <Field label="Photo link (optional)" name="imageUrl" type="url" placeholder="https://" defaultValue={v.imageUrl}
        hint="A public https link to a JPG or PNG photo (at least 250 × 250 pixels, under 5 MB), for example from your website. Google downloads it when the post is published; if Google cannot use it, the post is not published and the reason is shown." />
      {kind !== "STANDARD" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2" key={JSON.stringify(v)}>
          <legend className="label">{kind === "EVENT" ? "Event details" : "Offer details"} (Google requires a title and dates)</legend>
          <div className="sm:col-span-2">
            <Field label={kind === "EVENT" ? "Event title" : "Offer title"} name="eventTitle" required defaultValue={v.eventTitle} />
          </div>
          <Field label="Starts" name="eventStart" type="datetime-local" required defaultValue={v.eventStart} />
          <Field label="Ends" name="eventEnd" type="datetime-local" required defaultValue={v.eventEnd} />
          {kind === "OFFER" ? (
            <>
              <Field label="Coupon code (optional)" name="couponCode" defaultValue={v.couponCode} />
              <Field label="Redeem link (optional)" name="redeemOnlineUrl" type="url" placeholder="https://" defaultValue={v.redeemOnlineUrl} />
              <div className="sm:col-span-2">
                <Field label="Terms and conditions (optional)" name="termsConditions" as="textarea" rows={2} defaultValue={v.termsConditions} />
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}
      <Msg state={s} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="draft" variant="secondary" pending="Drafting">Draft with Claude</SubmitButton>
        <SubmitButton name="intent" value="save" pending="Saving">Save as draft</SubmitButton>
      </div>
    </form>
  );
}

export type LocationOption = { location: string; title: string; address: string; matchesListing: boolean };

/** Choose which Business Profile location to manage. The server checks the choice against Google's own list. */
export function LocationForm({ options, current, next, submitLabel = "Use this location" }: { options: LocationOption[]; current?: string; next?: "dashboard" | "settings"; submitLabel?: string }) {
  const [s, action] = useActionState(chooseLocationAction, init);
  return (
    <form action={action} className="flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Business locations on your Google account ({options.length})</legend>
        {options.map((o) => (
          <label key={o.location} className="inset flex cursor-pointer items-start gap-3">
            <input type="radio" name="location" value={o.location} defaultChecked={o.location === current} className="mt-1 shrink-0" required />
            <span className="min-w-0">
              <span className="body-5 block break-words">{o.title}</span>
              {o.address ? <span className="caption-2 block break-words text-muted">{o.address}</span> : null}
              {o.matchesListing ? <span className="badge badge-ok mt-1">Same listing as in Settings</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      <Msg state={s} />
      <div><SubmitButton pending="Saving">{submitLabel}</SubmitButton></div>
    </form>
  );
}

/** Fetches Business Profile performance from Google again. */
export function InsightsRefresh({ label = "Update from Google" }: { label?: string }) {
  const [s, action] = useActionState(refreshInsightsAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton variant="secondary" small pending="Updating">{label}</SubmitButton>
      <Msg state={s} />
    </form>
  );
}

export function NotesForm({ notes }: { notes: string }) {
  const [s, action] = useActionState(saveGuideNotesAction, init);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Your notes" name="notes" as="textarea" defaultValue={notes} rows={4} placeholder="Who is handling it, what OpenAI asked for, dates." />
      <Msg state={s} />
      <div><SubmitButton variant="secondary" pending="Saving">Save notes</SubmitButton></div>
    </form>
  );
}

export function InsightForm() {
  const [s, action] = useActionState(addInsightAction, init);
  const e = s.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3" key={JSON.stringify(s.values ?? {})}>
      <Field label="Date" name="date" type="date" defaultValue={s.values?.date} error={e.date} />
      <Field label="What the number is" name="label" placeholder="Profile views last 30 days" defaultValue={s.values?.label} error={e.label} />
      <Field label="Value" name="value" placeholder="240" defaultValue={s.values?.value} error={e.value} />
      <div className="sm:col-span-3"><Msg state={s} /></div>
      <div className="sm:col-span-3"><SubmitButton variant="secondary" pending="Adding">Add entry</SubmitButton></div>
    </form>
  );
}

/** Edit form for a saved post. Errors (for example text that is too short) show under the field. */
export function PostEditor({ id, text, approved, scheduledFor }: { id: string; text: string; approved: boolean; scheduledFor?: string }) {
  const [s, action] = useActionState(editPostAction, init);
  const [value, setValue] = useState(text);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="intent" value="edit" />
      <TimeZoneField />
      <label htmlFor={`e-${id}`} className="label">Post text</label>
      <textarea id={`e-${id}`} name="text" className="field" rows={5} value={value} onChange={(e) => setValue(e.target.value)} />
      <p className="hint">{value.trim().length} of 1500 characters{approved ? ". Saving changes moves this post back to draft, so it needs approving again." : ""}</p>
      <Field idPrefix={`e-${id}`} label="Schedule for (optional)" name="scheduledFor" type="datetime-local" defaultValue={scheduledFor} hint="Leave empty to publish by hand." />
      <Msg state={s} />
      <div><SubmitButton small pending="Saving">Save changes</SubmitButton></div>
    </form>
  );
}

type Insight = { date: string; label: string; value: string };

/** One recorded number, with Edit and Delete. */
export function InsightItem({ index, insight }: { index: number; insight: Insight }) {
  const [s, editAction] = useActionState(editInsightAction, init);
  const [d, deleteAction] = useActionState(deleteInsightAction, init);
  const e = s.fieldErrors ?? {};
  const orig = (
    <>
      <input type="hidden" name="index" value={index} />
      <input type="hidden" name="origDate" value={insight.date} />
      <input type="hidden" name="origLabel" value={insight.label} />
      <input type="hidden" name="origValue" value={insight.value} />
    </>
  );
  return (
    <li className="body-5">
      <div className="flex flex-wrap items-center gap-2">
        <span>{insight.date}: {insight.label}, <strong>{insight.value}</strong></span>
        <form action={deleteAction}>
          {orig}
          <SubmitButton variant="ghost" small pending="Deleting">Delete</SubmitButton>
        </form>
      </div>
      <Msg state={d} />
      <details className="mt-1">
        <summary className="btn btn-ghost btn-sm list-none [&::-webkit-details-marker]:hidden">Edit</summary>
        <form action={editAction} className="mt-2 grid gap-4 sm:grid-cols-3">
          {orig}
          <Field idPrefix={`insight-${index}`} label="Date" name="date" type="date" defaultValue={insight.date} error={e.date} />
          <Field idPrefix={`insight-${index}`} label="What the number is" name="label" defaultValue={insight.label} error={e.label} />
          <Field idPrefix={`insight-${index}`} label="Value" name="value" defaultValue={insight.value} error={e.value} />
          <div className="sm:col-span-3"><Msg state={s} /></div>
          <div className="sm:col-span-3"><SubmitButton variant="secondary" small pending="Saving">Save changes</SubmitButton></div>
        </form>
      </details>
    </li>
  );
}

/** Adds another location from the connected Google account. Only locations not already in the account are offered. */
export function AddGoogleLocationForm({ options }: { options: { location: string; title: string; address: string }[] }) {
  const [s, action] = useActionState(addGoogleLocationAction, init);
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Other locations on your connected Google account</legend>
        {options.map((o) => (
          <label key={o.location} className="inset flex cursor-pointer items-start gap-3">
            <input type="radio" name="location" value={o.location} required className="mt-1 shrink-0" />
            <span className="min-w-0"><span className="body-5 block break-words">{o.title}</span>{o.address ? <span className="caption-2 block break-words text-muted">{o.address}</span> : null}</span>
          </label>
        ))}
      </fieldset>
      <Msg state={s} />
      <div><SubmitButton pending="Adding">Add this location</SubmitButton></div>
    </form>
  );
}

/**
 * Locations page: removes one location after its name is typed. Says exactly what is deleted and what is not.
 * Closed by default so it cannot be pressed by accident.
 */
export function RemoveLocationForm({ loc, name, connected }: { loc: string; name: string; connected: boolean }) {
  const [s, action] = useActionState(removeLocationAction, init);
  const id = `rm-${loc}`;
  return (
    <details className="w-full border-t border-line pt-3" data-testid="remove-location">
      <summary className="caption-1 cursor-pointer text-bad">Remove this location</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="loc" value={loc} />
        <div className="caption-2 text-muted">
          <p>Deletes this location&apos;s details, review reply drafts, posts (scheduled ones are cancelled), reports, audits, rank scans and history from this app.{connected ? " Its Google access is cancelled, unless another of your locations uses the same Google sign-in." : ""}</p>
          <p className="mt-1">Your other locations are not changed. Nothing changes on Google: your Business Profile, reviews and published posts stay as they are. This cannot be undone.</p>
        </div>
        <div>
          <label htmlFor={id} className="label">Type <strong className="break-all">{name}</strong> to confirm</label>
          <input id={id} name="confirmName" className="field" autoComplete="off" required />
        </div>
        <Msg state={s} />
        <div><SubmitButton variant="secondary" small pending="Removing">Remove {name}</SubmitButton></div>
      </form>
    </details>
  );
}

/** Settings > Automation: how review replies are handled for this location. */
export function AutomationForm({ initial, canAuto }: { initial: AutomationSettings; canAuto: boolean }) {
  const [s, action] = useActionState(saveAutomationAction, init);
  const [mode, setMode] = useState(initial.replies);
  const MODES = [
    { v: "manual", t: "Manual", d: "Claude drafts a reply only when you ask." },
    { v: "approval", t: "Approval required", d: "New reviews get a draft reply automatically. Nothing is published until you approve it." },
    { v: "auto", t: "Automatic", d: canAuto ? "Eligible replies are published automatically. Negative, sensitive or flagged reviews always wait for you." : "Needs a connected Google Business Profile." },
  ] as const;
  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="label">Review replies</legend>
        {MODES.map((m) => (
          <label key={m.v} className={`inset flex items-start gap-3 ${m.v === "auto" && !canAuto ? "opacity-60" : "cursor-pointer"}`}>
            <input type="radio" name="replies" value={m.v} checked={mode === m.v} onChange={() => setMode(m.v)} disabled={m.v === "auto" && !canAuto} className="mt-1 shrink-0" />
            <span><span className="body-5 block">{m.t}</span><span className="caption-2 block text-muted">{m.d}</span></span>
          </label>
        ))}
      </fieldset>
      {mode === "auto" ? (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="f-autoMinStars" className="label">Publish automatically for</label>
            <select id="f-autoMinStars" name="autoMinStars" className="field" defaultValue={String(initial.autoMinStars)}>
              <option value="5">5-star reviews only</option>
              <option value="4">4 and 5-star reviews</option>
            </select>
          </div>
          {!initial.autoOptInAt || initial.replies !== "auto" ? (
            <label className="caption-1 flex items-start gap-2">
              <input type="checkbox" name="confirmAuto" value="yes" className="mt-0.5" />
              <span>I agree that replies passing every safety check may be published to Google without me reading them first. I can pause this at any time.</span>
            </label>
          ) : <p className="caption-2 text-muted">Automatic publishing was confirmed on {new Date(initial.autoOptInAt).toLocaleDateString("en-IN")}.</p>}
        </div>
      ) : null}
      <label className="caption-1 flex items-center gap-2">
        <input type="checkbox" name="paused" value="yes" defaultChecked={initial.paused} /> Pause all automation for this location
      </label>
      <input type="hidden" name="paused" value="no" />
      <Msg state={s} />
      <div><SubmitButton pending="Saving">Save automation</SubmitButton></div>
    </form>
  );
}

export function CreateReportForm({ month }: { month: string }) {
  const [s, action] = useActionState(createReportAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="month" value={month} />
      <SubmitButton pending="Creating the report">Create this month's report now</SubmitButton>
      <Msg state={s} />
    </form>
  );
}

/** The browser's time-zone offset, so a scheduled time typed here is published at that moment wherever the server is. */
function TimeZoneField() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(String(new Date().getTimezoneOffset())), []);
  return <input type="hidden" name="tz" value={tz} />;
}

export function ExplainInsights() {
  const [s, action] = useActionState(explainInsightsAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton variant="secondary" small pending="Asking Claude">Explain these numbers</SubmitButton>
      {s.error ? <Msg state={s} /> : null}
    </form>
  );
}

export function ExplainCompetitors() {
  const [s, action] = useActionState(explainCompetitorsAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <SubmitButton variant="secondary" small pending="Asking Claude">Explain why they may be more visible</SubmitButton>
      {s.error ? <Msg state={s} /> : null}
    </form>
  );
}

/** Settings > Email notifications. Security notices are always sent, so they have no switch. */
export function NotificationPrefsForm({ initial, configured }: { initial: { reportEmails: boolean; jobAlerts: boolean; postPublished: boolean }; configured: boolean }) {
  const [s, action] = useActionState(saveNotificationPrefsAction, init);
  const OPTIONS = [
    { name: "reportEmails", t: "Monthly report", d: "The report PDF for each location on the 1st of every month.", on: initial.reportEmails },
    { name: "jobAlerts", t: "Failure alerts", d: "When a scheduled post, review automation or a report fails after every retry.", on: initial.jobAlerts },
    { name: "postPublished", t: "Published posts", d: "Each time Google accepts one of your scheduled posts.", on: initial.postPublished },
  ];
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="notification-prefs">
      {OPTIONS.map((o) => (
        <label key={o.name} className="inset flex cursor-pointer items-start gap-3">
          <input type="checkbox" name={o.name} defaultChecked={o.on} className="mt-1 shrink-0" />
          <span><span className="body-5 block">{o.t}</span><span className="caption-2 block text-muted">{o.d}</span></span>
        </label>
      ))}
      <p className="caption-2 text-muted">Security notices (password changed, Google connected or disconnected) are always sent.{configured ? "" : " Nothing is sent until email is set up on the server."}</p>
      <Msg state={s} />
      <div><SubmitButton pending="Saving">Save email choices</SubmitButton></div>
    </form>
  );
}

/** "Email me this report": the PDF to the account's own address. */
export function EmailReportForm({ id }: { id: string }) {
  const [s, action] = useActionState(emailReportAction, init);
  return (
    <form action={action} className="flex flex-col items-start gap-2" data-testid="email-report">
      <input type="hidden" name="id" value={id} />
      <SubmitButton pending="Sending" variant="secondary" small>Email me this report</SubmitButton>
      <Msg state={s} />
    </form>
  );
}

const TOPICS = ["Question", "Problem or bug", "Billing", "Privacy or data", "Other"];

/** The public contact form. */
export function ContactForm({ email }: { email?: string }) {
  const [s, action] = useActionState(contactAction, init);
  const e = s.fieldErrors ?? {};
  if (s.ok) return <p className="inset body-5" role="status" data-testid="contact-sent">{s.ok}</p>;
  return (
    <form action={action} className="flex flex-col gap-4" key={JSON.stringify(s.values ?? {})} data-testid="contact-form">
      <Field label="Your name" name="name" autoComplete="name" required defaultValue={s.values?.name} error={e.name} />
      <Field label="Your email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email ?? email} error={e.email} hint="We answer to this address." />
      <Field label="Topic" name="topic" as="select" defaultValue={s.values?.topic ?? "Question"} error={e.topic}>
        {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
      </Field>
      <Field label="Message" name="message" as="textarea" rows={6} required defaultValue={s.values?.message} error={e.message} />
      {/* Hidden from people; automated form fillers complete it. */}
      <div aria-hidden="true" className="hidden"><label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <Msg state={s} />
      <div><SubmitButton pending="Sending">Send message</SubmitButton></div>
    </form>
  );
}

/** Settings > Account > Delete my account. The owner types their email address and ticks the box. */
export function DeleteAccountForm({ email }: { email: string }) {
  const [s, action] = useActionState(deleteAccountAction, init);
  const e = s.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="delete-account" key={JSON.stringify(s.values ?? {})}>
      <Field label={`Type your account email (${email}) to confirm`} name="confirmEmail" type="email" autoComplete="off" required error={e.confirmEmail} defaultValue={s.values?.confirmEmail} />
      <label className="caption-1 flex items-start gap-2">
        <input type="checkbox" name="understand" className="mt-0.5 accent-accent" />
        <span>I understand my account and all its data will be deleted permanently</span>
      </label>
      {e.understand ? <p className="field-error" role="alert">{e.understand}</p> : null}
      <Msg state={s} />
      <div><SubmitButton pending="Deleting your account" variant="secondary">Delete my account permanently</SubmitButton></div>
    </form>
  );
}
