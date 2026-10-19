import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { t } from "./i18n";
import { tripTitle, legDates } from "./tripSummary";
import type { SearchRecord } from "./types";
/** Pages only when the trips do not fit the sidebar; never fewer than this many per page. */
const MIN_PAGE = 3;
/** Room kept between the trip list and the sidebar footer (list margin and footer padding). */
const FOOTER_GAP = 28;

/**
 * How many trips fit in `room` (the height the trip rows may take), counting every row as tall
 * as the tallest one seen. A fixed row height keeps the answer independent of which trips are
 * shown, so a resize settles on one page size instead of alternating between two.
 */
export function fittingTrips(room: number, rowHeight: number, total: number): number {
  if (rowHeight <= 0) return Math.min(total, 5);
  return Math.min(total, Math.max(MIN_PAGE, Math.floor(room / rowHeight)));
}

/**
 * Page size from one measurement: the visible row heights, the free space under the list
 * (negative when the sidebar scrolls) and the tallest row seen so far. The room is the
 * visible rows plus the free space, the same whichever trips are shown.
 */
export function pageSizeFor(heights: number[], free: number, tallestSeen: number, total: number) {
  const tallest = Math.max(tallestSeen, ...heights);
  const room = heights.reduce((sum, height) => sum + height, 0) + free;
  return { size: fittingTrips(room, tallest, total), tallest };
}
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
  const [pageSize, setPageSize] = useState(5);
  const root = useRef<HTMLDivElement>(null),
    tallestRow = useRef(0);
  const ids = searches.map((s) => s.id).join(",");
  // Measure the room the sidebar leaves for trips; tall windows show them all, short ones page.
  // Only a sidebar resize or a new list measures again: a page change never does, which
  // could otherwise loop between two page sizes.
  useLayoutEffect(() => {
    tallestRow.current = 0;
    const list = root.current,
      sidebar = list?.closest<HTMLElement>(".sidebar"),
      footer = sidebar?.querySelector<HTMLElement>(".sidebar-bottom");
    if (!list || !sidebar || !footer || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!sidebar.clientHeight) return;
      const rows = [...list.querySelectorAll<HTMLElement>(".sidebar-trip")];
      if (!rows.length) return;
      const heights = rows.map((row) => row.offsetHeight + 2);
      const overflow = sidebar.scrollHeight - sidebar.clientHeight;
      const free = overflow > 0 ? -overflow : footer.offsetTop - list.offsetTop - list.offsetHeight - FOOTER_GAP;
      const { size: next, tallest } = pageSizeFor(heights, free, tallestRow.current, searches.length);
      tallestRow.current = tallest;
      setPageSize((size) => (size === next ? size : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, [ids]);
  useEffect(() => {
    const index = searches.findIndex((s) => s.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [selectedId, ids, pageSize]);
  const pages = Math.max(1, Math.ceil(searches.length / pageSize)),
    current = Math.min(page, pages - 1);
  const select = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Modified clicks keep the browser behavior (new tab, copy link).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(id);
  };
  return (
    <div className="sidebar-searches" ref={root}>
      <div className="sidebar-section-head">
        <h2 className="sidebar-section-title">{t("Suas viagens")}</h2>
        {pages > 1 && (
          <nav className="sidebar-pagination" aria-label={t("Páginas das buscas")}>
            {/* aria-disabled keeps the focus on the arrow after reaching the first or last page. */}
            <button
              type="button"
              aria-disabled={current === 0}
              onClick={() => current > 0 && setPage(current - 1)}
              aria-label={t("Buscas anteriores")}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span aria-live="polite">
              {current + 1}/{pages}
            </span>
            <button
              type="button"
              aria-disabled={current === pages - 1}
              onClick={() => current < pages - 1 && setPage(current + 1)}
              aria-label={t("Próximas buscas")}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </nav>
        )}
        <span className="sidebar-quota">
          {searches.length}/{limit}
        </span>
      </div>
      {searches
        .slice(current * pageSize, (current + 1) * pageSize)
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
      <button type="button" className="add-search" onClick={onNew}>
        <Plus size={18} aria-hidden="true" />
        {t("Nova viagem")}
      </button>
    </div>
  );
}
