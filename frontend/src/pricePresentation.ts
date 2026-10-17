import { t } from "./i18n";
import { formatMoney, formatNumber } from "./format";

/** "Preço mantido", "Preço subiu" or the saving: "Economia de R$ 192 (14,77%)". */
export function priceChangeLabel(previous: number | null, current: number, currency: string): string {
  if (previous === null) return "";
  if (previous === current) return t("Preço mantido");
  if (previous < current) return t("Preço subiu");
  const saving = previous - current;
  const amount = formatMoney(saving, currency);
  if ((saving / previous) * 100 < 0.01) return t("Economia de {0}", [amount]);
  return t("Economia de {0} ({1}%)", [amount, formatNumber((saving / previous) * 100, 2)]);
}
