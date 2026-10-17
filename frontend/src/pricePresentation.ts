import { getLocale, t } from "./i18n";

export function priceChangeLabel(previous: number | null, current: number, currency: string): string {
  if (previous === null) return "";
  if (previous === current) return t("Preço mantido");
  if (previous < current) return t("Preço subiu");
  const saving = previous - current;
  const amount = new Intl.NumberFormat(getLocale(), { style: "currency", currency }).format(saving / 100);
  if (saving / previous * 100 < 0.01) return t("Economia de {0}", [amount]);
  const percent = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(saving / previous * 100);
  return t("Economia de {0} ({1}%)", [amount, percent]);
}
