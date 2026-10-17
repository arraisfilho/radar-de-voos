import { t } from "./i18n";
import { AppIcon } from "./AppIcon";

/**
 * Placeholder for a view while it loads. The shell around it stays mounted.
 * `heading={false}` when the real page title is already on screen.
 */
export function ViewSkeleton({ label, heading = true }: { label?: string; heading?: boolean }) {
  return (
    <div className="view-skeleton" role="status">
      <span className="sr-only">{label || t("Carregando…")}</span>
      {heading && (
        <div className="view-skeleton-heading" aria-hidden="true">
          <span className="skeleton skeleton-eyebrow" />
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" style={{ width: "min(420px, 80%)" }} />
        </div>
      )}
      <div className="view-skeleton-grid" aria-hidden="true">
        <span className="skeleton skeleton-card" />
        <span className="skeleton skeleton-card" />
        <span className="skeleton skeleton-card" />
      </div>
      <span className="skeleton skeleton-panel" aria-hidden="true" />
    </div>
  );
}

/** Shell-shaped placeholder shown while the signed-in app code downloads. */
export function ShellSkeleton() {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-hidden="true">
        <span className="brand">
          <AppIcon />
          <span>{t("Radar de Voos")}</span>
        </span>
        <div className="view-skeleton-heading">
          <span className="skeleton skeleton-line" style={{ width: "80%" }} />
          <span className="skeleton skeleton-line" style={{ width: "64%" }} />
          <span className="skeleton skeleton-line" style={{ width: "72%" }} />
        </div>
      </aside>
      <header className="mobile-header" aria-hidden="true">
        <span className="mobile-brand">
          <AppIcon size="sm" />
          <strong>{t("Radar de Voos")}</strong>
        </span>
      </header>
      <main className="main-content">
        <div className="main-inner">
          <ViewSkeleton label={t("Abrindo seu radar…")} />
        </div>
      </main>
      {/* Phones and tablets: the tab bar is part of the shell from the first frame. */}
      <div className="mobile-nav" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <span key={item} className="skeleton-tab">
            <span className="skeleton skeleton-circle skeleton-tab-icon" />
            <span className="skeleton skeleton-tab-label" />
          </span>
        ))}
      </div>
    </div>
  );
}
