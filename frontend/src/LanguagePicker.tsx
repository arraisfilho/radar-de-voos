import { Globe, LoaderCircle } from "lucide-react";
import { useLanguage, usePendingLanguage, setLanguage, type Language, t } from "./i18n";
/**
 * Language names without flags. `labeled` shows "Idioma" as a visible row label.
 * While a catalog downloads, the select shows the choice beside a spinner; it
 * stays enabled, since disabling it would drop the focus.
 */
export function LanguagePicker({ labeled = false }: { labeled?: boolean }) {
  const language = useLanguage(),
    pending = usePendingLanguage();
  const spinner = pending && <LoaderCircle size={16} className="spin" aria-hidden="true" />;
  return (
    <label className={labeled ? "language-picker language-row" : "language-picker"}>
      {labeled ? (
        <>
          <span className="language-row-label">{t("Idioma")}</span>
          {spinner}
        </>
      ) : (
        <>
          {spinner || <Globe size={16} aria-hidden="true" />}
          <span className="sr-only">{t("Idioma")}</span>
        </>
      )}
      <select
        value={pending ?? language}
        aria-busy={!!pending || undefined}
        onChange={(e) => void setLanguage(e.target.value as Language)}
      >
        <option value="pt" lang="pt-BR">Português</option>
        <option value="en" lang="en">English</option>
        <option value="es" lang="es">Español</option>
      </select>
    </label>
  );
}
