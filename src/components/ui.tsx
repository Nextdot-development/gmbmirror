"use client";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";

export function SubmitButton({
  children, pending: pendingText, variant = "primary", name, value, small,
}: { children: React.ReactNode; pending?: string; variant?: "primary" | "secondary" | "ghost"; name?: string; value?: string; small?: boolean }) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} className={`btn btn-${variant} ${small ? "btn-sm" : ""}`} disabled={pending} aria-busy={mine}>
      {mine ? pendingText ?? "Working" : children}
    </button>
  );
}

export function Msg({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="field-error">{state.error}</p>;
  if (state.ok) return <p role="status" className="body-6 font-medium text-ok">{state.ok}</p>;
  return null;
}

export function Field({
  label, name, type = "text", defaultValue, placeholder, error, hint, required, autoComplete, as, children, rows, idPrefix = "f",
}: {
  label: string; name: string; type?: string; defaultValue?: string; placeholder?: string; error?: string; hint?: string;
  required?: boolean; autoComplete?: string; as?: "select" | "textarea"; children?: React.ReactNode; rows?: number;
  /** Set when the same form appears more than once on a page, so every id stays unique. */
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${name}`;
  const common = { id, name, defaultValue, required, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-e` : hint ? `${id}-h` : undefined, className: "field" };
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {as === "select" ? (
        <select {...common}>{children}</select>
      ) : as === "textarea" ? (
        <textarea {...common} rows={rows ?? 4} placeholder={placeholder} />
      ) : (
        <input {...common} type={type} placeholder={placeholder} autoComplete={autoComplete} />
      )}
      {error ? <p id={`${id}-e`} className="field-error">{error}</p> : hint ? <p id={`${id}-h`} className="hint">{hint}</p> : null}
    </div>
  );
}
