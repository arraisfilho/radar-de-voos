import { useSyncExternalStore } from "react";
import messages from "./messages.json";
export type Language = "pt" | "en" | "es";
const catalog = messages as Record<string, { en: string; es: string }>;
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
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const getLocale = () =>
  ({ pt: "pt-BR", en: "en-US", es: "es-ES" })[language];
/** BCP 47 tag for <html lang>. Page titles are set per route (pageTitle.ts). */
function applyDocumentLanguage() {
  if (typeof document !== "undefined")
    document.documentElement.lang = ({ pt: "pt-BR", en: "en", es: "es" })[language];
}
applyDocumentLanguage();
export function setLanguage(next: Language) {
  language = next;
  try {
    localStorage.setItem("radar-language", next);
  } catch {}
  applyDocumentLanguage();
  for (const notify of listeners) notify();
}
export function useLanguage() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getLanguage);
}
export function t(key: string, values: unknown[] = []): string {
  const text = language === "pt" ? key : catalog[key]?.[language] || key;
  return text.replace(/\{(\d+)\}/g, (_, index) =>
    String(values[Number(index)] ?? ""),
  );
}
