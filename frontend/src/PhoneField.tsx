import { t } from "./i18n";
import { useId, useLayoutEffect, useRef, useState } from "react";
import {
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
import { PhoneCountryPicker } from "./PhoneCountryPicker";
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
        <div className="phone-country">
          <PhoneCountryPicker country={current.country} label={label} disabled={disabled} onChange={(country) => {
            const next = changePhoneCountry(value, current.country, country);
            setTouched(false);
            onChange(next.country, next.value);
          }} />
        </div>
        <label className="phone-number" htmlFor={id}>
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
        className={invalid ? "field-error" : "help"}
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
