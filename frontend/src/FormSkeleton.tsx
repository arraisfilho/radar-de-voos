import { t } from "./i18n";

/**
 * The trip form while its code downloads, laid out like it; the page heading
 * stays outside, on screen from the start. `steps={false}` for the alert
 * settings, which open on their fields; `compact` for the "Filtros da viagem"
 * card: leg tabs and fields, saved by the pending-changes bar (no action bar).
 * Only the signed-in app uses it, so it ships with the app's code.
 */
export function FormSkeleton({ compact = false, steps = !compact }: { compact?: boolean; steps?: boolean }) {
  return (
    <div className="form-skeleton" role="status">
      <span className="sr-only">{t("Carregando…")}</span>
      {steps && (
        <>
          <div className="form-skeleton-steps" aria-hidden="true">
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton" />
          </div>
          <div className="form-skeleton-heading" aria-hidden="true">
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-line" style={{ width: "min(420px, 80%)" }} />
          </div>
        </>
      )}
      {compact && <span className="skeleton skeleton-field" aria-hidden="true" />}
      {["min(120px, 40%)", "min(180px, 60%)", "min(150px, 50%)"].map((width) => (
        <div key={width} className="form-skeleton-field" aria-hidden="true">
          <span className="skeleton skeleton-line" style={{ width }} />
          <span className="skeleton skeleton-field" />
        </div>
      ))}
      {!compact && <span className="skeleton skeleton-button form-skeleton-action" aria-hidden="true" />}
    </div>
  );
}
