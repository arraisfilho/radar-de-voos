import { useSyncExternalStore } from "react";
export type Language = "pt" | "en" | "es";
type Catalog = Record<string, string>;
// Portuguese keys are the texts; en and es are chunks of their own (vite.config.ts),
// with literal specifiers so Vite emits them. When a chunk fails and main.tsx
// reloads the page instead, the import resolves `undefined`.
const loaders: Record<"en" | "es", () => Promise<{ default: Catalog } | undefined>> = {
  en: () => import("virtual:messages/en"),
  es: () => import("virtual:messages/es"),
};
const catalogs: Partial<Record<"en" | "es", Catalog>> = {};
export function detectLanguage(value: string): Language {
  const code = value.toLowerCase().split(/[-_]/)[0];
  return code === "pt" || code === "es" ? code : "en";
}
function initial(): Language {
  try {
    const saved = localStorage.getItem("radar-language");
    if (saved === "pt" || saved === "en" || saved === "es") return saved;
  } catch {}
  return detectLanguage(navigator.language || "en");
}
let language = initial();
// `language` is the one applied (texts, locale, server); `pending` is downloading
// for a switch; `ready` is false while the first catalog downloads; `reloading`
// means main.tsx is reloading the page for a failed chunk.
let pending: Language | null = null;
let ready = language === "pt";
let reloading = false;
let requests = 0;
const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const getLanguage = () => language;
const getPending = () => pending;
const getReady = () => ready;
export const getLocale = () =>
  ({ pt: "pt-BR", en: "en-US", es: "es-ES" })[language];
/** BCP 47 tag for <html lang>: the language of the texts shown, Portuguese until
 * its catalog arrives. Page titles are set per route (pageTitle.ts). */
function applyDocumentLanguage() {
  const shown = language !== "pt" && catalogs[language] ? language : "pt";
  if (typeof document !== "undefined")
    document.documentElement.lang = ({ pt: "pt-BR", en: "en", es: "es" })[shown];
}
applyDocumentLanguage();
function persist(value: Language) {
  try {
    localStorage.setItem("radar-language", value);
  } catch {}
}
const download = (next: "en" | "es") =>
  loaders[next]().then((module) => {
    if (!module) reloading = true;
    return module && (catalogs[next] = module.default);
  });
function markReady() {
  ready = true;
  applyDocumentLanguage();
  notify();
}
function apply(next: Language) {
  language = next;
  pending = null;
  markReady();
}
function clearPending() {
  pending = null;
  notify();
}
// A failed first download keeps the language, so the server and the drafts still
// get it; only this visit falls back to the Portuguese texts.
if (language !== "pt")
  download(language).then((catalog) => {
    if (catalog) markReady();
  }, markReady);
/** Portuguese or a catalog at hand applies at once; otherwise on arrival, if this is
 * still the newest request. A failure keeps the current language and saves it
 * again, unless a reload is loading the new choice. The promise settles with this
 * request and never rejects. */
export function setLanguage(next: Language): Promise<void> {
  const request = ++requests;
  persist(next);
  if (next === "pt" || catalogs[next]) {
    apply(next);
    return Promise.resolve();
  }
  pending = next;
  notify();
  return download(next).then(
    (catalog) => {
      if (request !== requests) return;
      // Without a catalog the page is reloading; if beforeunload cancels it, no spinner stays.
      if (catalog) apply(next);
      else clearPending();
    },
    () => {
      if (request !== requests) return;
      if (!reloading) persist(language);
      clearPending();
    },
  );
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage);
}
export function usePendingLanguage() {
  return useSyncExternalStore(subscribe, getPending);
}
export function useLanguageReady() {
  return useSyncExternalStore(subscribe, getReady);
}
export function t(key: string, values: unknown[] = []): string {
  const text = language === "pt" ? key : catalogs[language]?.[key] || key;
  return text.replace(/\{(\d+)\}/g, (_, index) =>
    String(values[Number(index)] ?? ""),
  );
}
