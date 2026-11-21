"use client";
import { useActionState, useState } from "react";
import { draftActionContentAction, type DraftState } from "@/app/actions";
import { SubmitButton } from "./ui";

/** Claude-drafted content for an action plan. Shown for the owner to edit and copy; nothing is published. */
export function ActionDraft({ id, label, saved }: { id: string; label: string; saved?: { text: string; at: string; warnings: string[] } }) {
  const [s, action] = useActionState<DraftState, FormData>(draftActionContentAction, {});
  const text = s.text ?? saved?.text;
  const warnings = s.text ? s.warnings : saved?.warnings;
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <SubmitButton small variant="secondary" pending="Drafting with Claude">{text ? "Draft again with Claude" : `Draft ${label} with Claude`}</SubmitButton>
      </form>
      {s.error ? <p role="alert" className="field-error">{s.error}</p> : null}
      {text ? (
        <div className="mt-3">
          <label htmlFor="action-draft" className="label">Draft to review and edit</label>
          <textarea id="action-draft" className="field" rows={8} defaultValue={text} key={text} />
          {warnings?.length ? (
            <ul className="mt-2 flex flex-col gap-1" aria-label="Wording to reread">
              {warnings.map((w) => <li key={w} className="caption-1 text-warn">{w}</li>)}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
              const el = document.getElementById("action-draft") as HTMLTextAreaElement | null;
              try { await navigator.clipboard.writeText(el?.value ?? text); setCopied(true); } catch { el?.select(); }
            }}>{copied ? "Copied" : "Copy text"}</button>
            <span className="caption-2 text-muted">Review it before you use it. Nothing is posted to Google from here.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
