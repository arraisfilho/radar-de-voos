import { useId } from "react";
import { t, getLocale } from "./i18n";
import { Button } from "./ui";

export function validTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat(getLocale(), { timeZone: value }).format(); return !!value.trim(); }
  catch { return false; }
}
export function TimeZoneField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const zones = [...new Set(["UTC", value, device, ...((Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") || [])])];
  return <div className="timezone-field">
    <label htmlFor={id}>{t("Fuso horário")}</label>
    <input id={id} required maxLength={80} list={id + "-zones"} disabled={disabled} value={value} placeholder="America/Sao_Paulo" onChange={e => {
      e.currentTarget.setCustomValidity(validTimeZone(e.target.value) ? "" : t("Escolha um fuso horário válido."));
      onChange(e.target.value);
    }} />
    <datalist id={id + "-zones"}>{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</datalist>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      input?.setCustomValidity("");
      onChange(device);
    }}>{t("Usar fuso do dispositivo")}</Button>
    <p className="help">{t("Fuso do dispositivo: {0}", [device])}</p>
  </div>;
}
