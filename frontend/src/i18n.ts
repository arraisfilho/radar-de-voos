import { useEffect, useSyncExternalStore } from "react";
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
export function setLanguage(next: Language) {
  language = next;
  try {
    localStorage.setItem("radar-language", next);
  } catch {}
  for (const notify of listeners) notify();
}
export function useLanguage() {
  const value = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getLanguage);
  useEffect(() => {
    document.documentElement.lang = value;
    document.title = t("Radar de Voos");
  }, [value]);
  return value;
}
export function t(key: string, values: unknown[] = []): string {
  const text = language === "pt" ? key : catalog[key]?.[language] || key;
  return text.replace(/\{(\d+)\}/g, (_, index) =>
    String(values[Number(index)] ?? ""),
  );
}
