import { useLanguage, setLanguage, type Language, t } from "./i18n";
export function LanguagePicker() {
  const language = useLanguage();
  return (
    <label className="language-picker">
      <span className="sr-only">{t("Idioma")}</span>
      <select
        aria-label={t("Idioma")}
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
      >
        <option value="pt">🇧🇷 Português</option>
        <option value="en">🇺🇸 English</option>
        <option value="es">🇪🇸 Español</option>
      </select>
    </label>
  );
}
