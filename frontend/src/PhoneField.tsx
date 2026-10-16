import { t } from "./i18n";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  type CountryCode,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import {
  formatPhone,
  changePhoneCountry,
  editPhone,
  possiblePhone,
} from "./phone";
import { getLocale } from "./i18n";
const nameCatalogs = new Map<string, Intl.DisplayNames>();
function countryName(code: string) {
  const locale = getLocale();
  let names = nameCatalogs.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: "region" });
    nameCatalogs.set(locale, names);
  }
  return names.of(code) || code;
}
const countries = getCountries().sort((a, b) =>
  countryName(a).localeCompare(countryName(b), getLocale()),
);
const flag = (country: string) =>
  String.fromCodePoint(...[...country].map((c) => 127397 + c.charCodeAt(0)));
export function PhoneField({
  label,
  country,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  country: string;
  value: string;
  onChange: (country: string, value: string) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    caret = useRef<number | null>(null),
    [touched, setTouched] = useState(false),
    current = formatPhone(value, country),
    display = current.display,
    example = getExampleNumber(
      current.country as CountryCode,
      examples,
    )?.formatNational(),
    invalid = touched && !!value && !possiblePhone(value, country);
  useLayoutEffect(() => {
    if (caret.current !== null && document.activeElement === input.current) {
      input.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });
  return (
    <fieldset className="phone-field">
      <legend>{label}</legend>
      <div className="phone-controls">
        <label className="phone-country">
          <span className="sr-only">
            {t("País e código internacional de")} {label}
          </span>
          <select
            disabled={disabled}
            value={current.country}
            onChange={(e) => {
              const next = changePhoneCountry(
                value,
                current.country,
                e.target.value,
              );
              setTouched(false);
              onChange(next.country, next.value);
            }}
            aria-label={t("País e código internacional de {0}", [label])}
          >
            {countries.map((code) => (
              <option key={code} value={code}>
                {flag(code)} {countryName(code)} +{getCountryCallingCode(code)}
              </option>
            ))}
          </select>
        </label>
        <label className="phone-number" htmlFor={id}>
          {!current.value.startsWith("+") && (
            <span className="phone-prefix">
              +{getCountryCallingCode(current.country as CountryCode)}
            </span>
          )}
          <input
            id={id}
            ref={input}
            type="tel"
            aria-label={t("{0}: código de área e número", [label])}
            aria-describedby={`${id}-help`}
            aria-invalid={invalid || undefined}
            onBlur={() => setTouched(true)}
            autoComplete="tel-national"
            inputMode="tel"
            required
            disabled={disabled}
            value={display}
            placeholder={example || t("Código de área e número")}
            maxLength={50}
            onChange={(e) => {
              const next = editPhone(
                e.target.value,
                country,
                display,
                e.target.selectionStart ?? e.target.value.length,
                (e.nativeEvent as InputEvent).inputType || "insertText",
              );
              caret.current = next.cursor;
              onChange(next.country, next.value);
            }}
          />
        </label>
      </div>
      <p
        id={`${id}-help`}
        className={invalid ? "form-error" : "help"}
        role={invalid ? "alert" : undefined}
      >
        {invalid
          ? t(
              "Confira o código de área e a quantidade de dígitos para o país selecionado.",
            )
          : t(
              "A formatação acompanha o país. {0}Você também pode colar um número com +DDI.",
              [example ? t("Exemplo: {0}. ", [example]) : ""],
            )}
      </p>
    </fieldset>
  );
}
