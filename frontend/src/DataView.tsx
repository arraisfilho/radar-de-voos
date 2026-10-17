import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, RotateCw, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { t } from "./i18n";
import { plural } from "./plural";
import { Button, Modal } from "./ui";
import "./data-view.css";

/** Phones (up to 767 px) get filter sheets and stacked table rows. */
const COMPACT = "(max-width: 767px)";
function subscribe(notify: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(COMPACT);
  media.addEventListener?.("change", notify);
  return () => media.removeEventListener?.("change", notify);
}
const compactNow = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(COMPACT).matches;
/** True on phones. Server rendering and engines without matchMedia get the wide layout. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, compactNow, () => false);
}

/**
 * Filters of a table: a toolbar on larger screens; on phones a "Filtros"
 * button with the count of active filters opens the same fields in a sheet.
 * The fields apply together, with "Aplicar" or Enter. The buttons stay
 * enabled while the list reloads, so the focus never drops to the page.
 */
export function FilterBar({
  title,
  active,
  onApply,
  onReset,
  children,
}: {
  /** Names the toolbar and the sheet ("Filtrar envios"). */
  title: string;
  /** Filters currently applied. */
  active: number;
  onApply: () => void;
  onReset: () => void;
  /** The fields, each a .field label. */
  children: ReactNode;
}) {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const form = (
    <form
      className="filter-bar"
      role="search"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
        setOpen(false);
      }}
    >
      <div className="filter-fields">{children}</div>
      <div className="filter-actions">
        <Button
          type="button"
          variant="ghost"
          size="small"
          onClick={() => {
            onReset();
            setOpen(false);
          }}
        >
          {t("Limpar filtros")}
        </Button>
        <Button type="submit" size="small">
          {t("Aplicar")}
        </Button>
      </div>
    </form>
  );
  if (!compact) return form;
  return (
    <div className="filter-trigger">
      <Button variant="outline" size="small" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        {t("Filtros")}
        {active > 0 && (
          <>
            <span className="filter-count" aria-hidden="true">
              {active}
            </span>
            <span className="sr-only">{plural(active, "{0} filtro ativo", "{0} filtros ativos")}</span>
          </>
        )}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={title} description={t("Escolha os critérios e toque em Aplicar.")}>
        {form}
      </Modal>
    </div>
  );
}

/**
 * "Página 2 de 5" with previous and next; only the summary when everything
 * fits one page. The buttons are never disabled, so the focus stays on them
 * while the next page loads (the list keeps the previous rows meanwhile); at
 * the first and last page they are aria-disabled and do nothing.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  label,
  summary,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** Names the navigation ("Páginas de envios"). */
  label: string;
  /** Count or note shown before the page number. */
  summary?: ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pages <= 1 && page === 0) return summary ? <p className="pager-summary is-alone">{summary}</p> : null;
  const first = page === 0,
    last = page + 1 >= pages;
  return (
    <nav className="pager" aria-label={label}>
      {summary && <span className="pager-summary">{summary}</span>}
      <span className="pager-page">{t("Página {0} de {1}", [page + 1, pages])}</span>
      <span className="pager-buttons">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("Página anterior")}
          aria-disabled={first || undefined}
          onClick={() => !first && onPage(page - 1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("Próxima página")}
          aria-disabled={last || undefined}
          onClick={() => !last && onPage(page + 1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </Button>
      </span>
    </nav>
  );
}

/**
 * True while the click that ends a text selection reaches a clickable row:
 * selecting a subject or an address to copy it does not open the row.
 */
export function selectingText(): boolean {
  return typeof window !== "undefined" && !!window.getSelection?.()?.toString();
}

/**
 * Name of a secondary field ("Canal", "Data e hora") shown inside its cell
 * when table rows stack on phones; wider screens hide it, since the column
 * header names the field there. The cell takes the class `cell-field`.
 */
export function CellLabel({ children }: { children: ReactNode }) {
  return <span className="cell-label">{children}</span>;
}

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div className="table-skeleton" role="status">
      <span className="sr-only">{label || t("Carregando…")}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton skeleton-table-row" aria-hidden="true" />
      ))}
    </div>
  );
}

/**
 * A list that could not load: the reason and a retry, in place of the list.
 * `level` 2 when it sits right under the page <h1> (task pages), 3 inside a card.
 */
export function LoadError({ message, onRetry, level = 3 }: { message: string; onRetry?: () => void; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="empty-state load-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <Heading>{t("Não foi possível carregar")}</Heading>
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RotateCw size={16} aria-hidden="true" />
          {t("Tentar novamente")}
        </Button>
      )}
    </div>
  );
}

/** An empty list: icon, title and a short explanation; `level` as in LoadError. */
export function EmptyRows({
  icon: Icon,
  title,
  children,
  level = 3,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="empty-state">
      <Icon aria-hidden="true" />
      <Heading>{title}</Heading>
      {children && <p>{children}</p>}
    </div>
  );
}
