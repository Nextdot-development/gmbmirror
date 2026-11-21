"use client";

/** Shown when a page in the app cannot load its data. Nothing is changed or overwritten. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card max-w-[560px]" role="alert">
      <h1 className="heading-6">We could not load your data</h1>
      <p className="body-6 mt-2 text-muted">Nothing was changed. This is usually a short connection problem. Try again in a moment.</p>
      <button type="button" className="btn btn-primary btn-sm mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
