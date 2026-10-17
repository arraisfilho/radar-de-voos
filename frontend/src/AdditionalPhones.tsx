import { useEffect, useRef, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { t } from "./i18n";
import { PhoneField } from "./PhoneField";
import { Button } from "./ui";
export type PhoneContact = { country: string; phone: string };
/** Up to four extra alert numbers (profile and administration). */
export function AdditionalPhones({
  values,
  onChange,
  disabled = false,
  defaultCountry = "BR",
  label,
  compact = false,
}: {
  values: PhoneContact[];
  onChange: (values: PhoneContact[]) => void;
  disabled?: boolean;
  defaultCountry?: string;
  /** Legend; defaults to "Outros números para alertas". */
  label?: ReactNode;
  /** Without the help line (the profile keeps it behind its info button). */
  compact?: boolean;
}) {
  // "Adicionar telefone" moves the focus to the new number.
  const box = useRef<HTMLFieldSetElement>(null),
    added = useRef(false);
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const fields = box.current?.querySelectorAll<HTMLInputElement>('input[type="tel"]');
    fields?.[fields.length - 1]?.focus();
  }, [values.length]);
  return (
    <fieldset className="extra-phones" ref={box}>
      <legend>{label ?? t("Outros números para alertas")}</legend>
      {!compact && (
        <p className="help">
          {t(
            "Até quatro números adicionais. Não alteram o telefone de acesso. O envio por WhatsApp depende da integração do canal.",
          )}
        </p>
      )}
      {values.map((item, i) => (
        <div className="extra-phone-row" key={i}>
          <PhoneField
            label={t("Telefone adicional {0}", [i + 1])}
            country={item.country}
            value={item.phone}
            disabled={disabled}
            onChange={(country, phone) => onChange(values.map((v, n) => (n === i ? { country, phone } : v)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t("Remover telefone {0}", [i + 1])}
            onClick={() => onChange(values.filter((_, n) => n !== i))}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
      ))}
      {values.length < 4 && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            added.current = true;
            onChange([...values, { country: values[0]?.country || defaultCountry, phone: "" }]);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          {t("Adicionar telefone")}
        </Button>
      )}
    </fieldset>
  );
}
