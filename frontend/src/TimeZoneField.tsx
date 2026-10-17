import { useId } from "react";
import { t, getLocale } from "./i18n";
import { Button } from "./ui";

export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat(getLocale(), { timeZone: value }).format(); return !!value.trim(); }
  catch { return false; }
}
/** IANA time zone with suggestions, the device zone as a shortcut and the error next to the field. */
export function TimeZoneField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const zones = [...new Set(["UTC", value, device, ...((Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") || [])])];
  // An empty field is caught by `required`; a typed name must exist.
  const invalid = !!value.trim() && !validTimeZone(value);
  const helpId = id + "-help", errorId = id + "-error";
  return <div className="timezone-field">
    <label className="field-label" htmlFor={id}>{t("Fuso horário")}</label>
    <input id={id} required maxLength={80} list={id + "-zones"} disabled={disabled} value={value} placeholder="America/Sao_Paulo"
      autoCapitalize="off" spellCheck={false}
      aria-invalid={invalid || undefined} aria-describedby={invalid ? `${errorId} ${helpId}` : helpId}
      onChange={e => {
        e.currentTarget.setCustomValidity(validTimeZone(e.target.value) ? "" : t("Escolha um fuso horário válido."));
        onChange(e.target.value);
      }} />
    <datalist id={id + "-zones"}>{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</datalist>
    {invalid && <p className="field-error" id={errorId}>{t("Escolha um fuso horário válido.")}</p>}
    <p className="field-help" id={helpId}>{t("Fuso do dispositivo: {0}", [device])}</p>
    <Button type="button" variant="outline" size="small" disabled={disabled} onClick={() => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      input?.setCustomValidity("");
      onChange(device);
    }}>{t("Usar fuso do dispositivo")}</Button>
  </div>;
}
