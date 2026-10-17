import { useEffect, useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { t } from "./i18n";
import { tripTitle, legDates } from "./tripSummary";
import type { SearchRecord } from "./types";
const PAGE_SIZE = 5;
export function SidebarSearches({
  searches,
  selectedId,
  limit,
  pending,
  onSelect,
  onNew,
}: {
  searches: SearchRecord[];
  selectedId?: string;
  limit: number;
  pending: Set<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [page, setPage] = useState(0);
  const ids = searches.map((s) => s.id).join(",");
  useEffect(() => {
    const index = searches.findIndex((s) => s.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
  }, [selectedId, ids]);
  const pages = Math.max(1, Math.ceil(searches.length / PAGE_SIZE)),
    current = Math.min(page, pages - 1);
  const select = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Modified clicks keep the browser behavior (new tab, copy link).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(id);
  };
  return (
    <div className="sidebar-searches">
      <h2 className="sidebar-section-title">
        {t("Suas viagens")}
        <span>
          {searches.length}/{limit}
        </span>
      </h2>
      {searches
        .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
        .map((s) => {
          const summary = tripTitle(s.config);
          return (
            <a
              key={s.id}
              href={`/viagens/${encodeURIComponent(s.id)}`}
              onClick={(event) => select(event, s.id)}
              className={selectedId === s.id ? "sidebar-trip current" : "sidebar-trip"}
              aria-current={selectedId === s.id ? "page" : undefined}
              title={`${summary.title} · ${t("Ida")}: ${legDates(s.config.outbound)}${s.config.inbound ? ` · ${t("Volta")}: ${legDates(s.config.inbound)}` : ""}`}
            >
              <i
                className={s.active ? "sidebar-trip-dot is-active" : "sidebar-trip-dot"}
                aria-hidden="true"
              />
              <span className="sidebar-trip-text">
                <span className="sidebar-trip-name">
                  {summary.title}
                  {pending.has(s.id) && (
                    <span
                      className="draft-marker"
                      aria-label={t("Alterações pendentes")}
                    >
                      {" "}
                      *
                    </span>
                  )}
                </span>
                {summary.secondaryRoute && (
                  <small className="sidebar-secondary-route">
                    {summary.secondaryRoute}
                  </small>
                )}
                <small className="sidebar-trip-dates">
                  <span>
                    {t("Ida")} {legDates(s.config.outbound, true)}
                  </span>
                  {s.config.inbound && (
                    <span>
                      {t("Volta")} {legDates(s.config.inbound, true)}
                    </span>
                  )}
                </small>
              </span>
              <span className="sr-only">
                {s.active ? t("Ativo") : t("Pausado")}
              </span>
            </a>
          );
        })}
      {pages > 1 && (
        <nav
          className="sidebar-pagination"
          aria-label={t("Páginas das buscas")}
        >
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            aria-label={t("Buscas anteriores")}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span aria-live="polite">
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
            aria-label={t("Próximas buscas")}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
      <button type="button" className="add-search" onClick={onNew}>
        <Plus size={18} aria-hidden="true" />
        {t("Nova viagem")}
      </button>
    </div>
  );
}
