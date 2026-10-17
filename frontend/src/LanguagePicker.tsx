import { Globe } from "lucide-react";
import { useLanguage, setLanguage, type Language, t } from "./i18n";
/** Language names without flags. `labeled` shows "Idioma" as a visible row label. */
export function LanguagePicker({ labeled = false }: { labeled?: boolean }) {
  const language = useLanguage();
  return (
    <label className={labeled ? "language-picker language-row" : "language-picker"}>
      {labeled ? (
        <span className="language-row-label">{t("Idioma")}</span>
      ) : (
        <>
          <Globe size={16} aria-hidden="true" />
          <span className="sr-only">{t("Idioma")}</span>
        </>
      )}
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        <option value="pt" lang="pt-BR">Português</option>
        <option value="en" lang="en">English</option>
        <option value="es" lang="es">Español</option>
      </select>
    </label>
  );
}
