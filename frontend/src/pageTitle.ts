import { useEffect } from "react";
import { t } from "./i18n";

/** "<Page> · Radar de Voos", or the app name alone. */
export function pageTitle(page?: string) {
  const app = t("Radar de Voos");
  return page ? `${page} · ${app}` : app;
}

/** Sets document.title. `null` leaves the title to a nested screen. */
export function usePageTitle(page?: string | null) {
  const title = page === null ? null : pageTitle(page);
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}
