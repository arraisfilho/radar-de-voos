import { getLocale } from "./i18n";
import codes from "../../config/currencies.json";
export const currencies: string[] = codes;
const euro =
  "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const countryCurrency: Record<string, string> = {
  US: "USD",
  BR: "BRL",
  CO: "COP",
  GB: "GBP",
  CA: "CAD",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  PE: "PEN",
  AU: "AUD",
  NZ: "NZD",
  CH: "CHF",
  JP: "JPY",
  CN: "CNY",
  IN: "INR",
  AE: "AED",
  KR: "KRW",
  ZA: "ZAR",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  TR: "TRY",
};
for (const country of euro) countryCurrency[country] = "EUR";
export function suggestCurrency(fallbackCountry?: string): string {
  for (const language of navigator.languages || [navigator.language]) {
    try {
      const region = new Intl.Locale(language).region;
      if (region && countryCurrency[region]) return countryCurrency[region];
    } catch {
      /* Try the next browser preference. */
    }
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones: Record<string, string> = {
    "America/Sao_Paulo": "BRL",
    "America/Fortaleza": "BRL",
    "America/Araguaina": "BRL",
    "America/Bogota": "COP",
    "America/New_York": "USD",
    "America/Chicago": "USD",
    "America/Denver": "USD",
    "America/Los_Angeles": "USD",
    "Europe/London": "GBP",
    "Europe/Paris": "EUR",
    "Europe/Berlin": "EUR",
    "Europe/Lisbon": "EUR",
    "Europe/Madrid": "EUR",
    "Asia/Tokyo": "JPY",
  };
  return zones[zone] || countryCurrency[fallbackCountry || ""] || "BRL";
}
export function currencyLabel(code: string): string {
  const name = new Intl.DisplayNames([getLocale()], { type: "currency" }).of(
    code,
  );
  return `${code} — ${name || code}`;
}
