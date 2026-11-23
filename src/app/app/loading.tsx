/**
 * Shown the moment a dashboard link is clicked, while the page is prepared on the server. The sidebar (layout) stays
 * as it is; only this area changes. Shapes follow the usual page: a title, a row of figures and two cards.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite" data-testid="page-loading">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-3">
        <div className="skeleton h-8 w-56 max-w-full" />
        <div className="skeleton h-4 w-[28rem] max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="card flex flex-col gap-3">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
