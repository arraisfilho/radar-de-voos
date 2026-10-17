import { SunMoon } from "lucide-react";
import { setAppearance, useAppearance, type Appearance } from "./appearance";
import { t } from "./i18n";

/** Sistema, Claro or Escuro, beside the language picker and in its style. */
export function AppearancePicker({ labeled = false }: { labeled?: boolean }) {
  const appearance = useAppearance();
  return (
    <label className={labeled ? "language-picker language-row" : "language-picker"}>
      {labeled ? (
        <span className="language-row-label">{t("Aparência")}</span>
      ) : (
        <>
          <SunMoon size={16} aria-hidden="true" />
          <span className="sr-only">{t("Aparência")}</span>
        </>
      )}
      <select value={appearance} onChange={(e) => setAppearance(e.target.value as Appearance)}>
        <option value="system">{t("Sistema")}</option>
        <option value="light">{t("Claro")}</option>
        <option value="dark">{t("Escuro")}</option>
      </select>
    </label>
  );
}
