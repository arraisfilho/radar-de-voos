import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, PlaneTakeoff, Plus } from "lucide-react";
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
  return (
    <div className="sidebar-searches">
      <p className="eyebrow">
        {t("SUAS BUSCAS")}
        <span>
          {searches.length}/{limit}
        </span>
      </p>
      {searches
        .slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
        .map((s) => {
          const summary = tripTitle(s.config);
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={selectedId === s.id ? "current" : ""}
              aria-current={selectedId === s.id ? "page" : undefined}
              title={`${summary.title} · ${t("Ida")}: ${legDates(s.config.outbound)}${s.config.inbound ? ` · ${t("Volta")}: ${legDates(s.config.inbound)}` : ""}`}
            >
              <PlaneTakeoff size={15} aria-hidden="true" />
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
              <i
                className={s.active ? "active-dot" : "paused-dot"}
                aria-hidden="true"
              />
              <span className="sr-only">
                {s.active ? t("Ativo") : t("Pausado")}
              </span>
            </button>
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
            <ChevronLeft size={16} />
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
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
      <button className="add-search" onClick={onNew}>
        <Plus size={16} />
        {t("Nova busca")}
      </button>
    </div>
  );
}
