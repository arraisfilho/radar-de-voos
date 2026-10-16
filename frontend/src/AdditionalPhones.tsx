import { Plus, X } from "lucide-react";
import { t } from "./i18n";
import { PhoneField } from "./PhoneField";
import { Button } from "./ui";
export type PhoneContact = { country: string; phone: string };
export function AdditionalPhones({
  values,
  onChange,
  disabled = false,
  defaultCountry = "BR",
}: {
  values: PhoneContact[];
  onChange: (values: PhoneContact[]) => void;
  disabled?: boolean;
  defaultCountry?: string;
}) {
  return (
    <fieldset className="extra-phones">
      <legend>{t("Outros números para alertas")}</legend>
      <p className="help">
        {t(
          "Até quatro números adicionais. Não alteram o telefone de acesso. O envio por WhatsApp depende da integração do canal.",
        )}
      </p>
      {values.map((item, i) => (
        <div className="extra-phone-row" key={i}>
          <PhoneField
            label={t("Telefone adicional {0}", [i + 1])}
            country={item.country}
            value={item.phone}
            disabled={disabled}
            onChange={(country, phone) =>
              onChange(values.map((v, n) => (n === i ? { country, phone } : v)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            aria-label={t("Remover telefone {0}", [i + 1])}
            onClick={() => onChange(values.filter((_, n) => n !== i))}
          >
            <X size={16} />
          </Button>
        </div>
      ))}
      {values.length < 4 && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange([
              ...values,
              { country: values[0]?.country || defaultCountry, phone: "" },
            ])
          }
        >
          <Plus size={16} />
          {t("Adicionar telefone")}
        </Button>
      )}
    </fieldset>
  );
}
