import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { t } from "./i18n";
import { Button } from "./ui";

/** Up to four alert e-mails (sign-up, profile and administration). */
export function EmailFields({
  values,
  onChange,
  compact = false,
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
  /** Legend; defaults to "E-mails para receber alertas". */
  label?: ReactNode;
}) {
  return (
    <fieldset className="email-fields">
      <legend>{label ?? t("E-mails para receber alertas")}</legend>
      {!compact && (
        <p className="help">
          {t("Cadastre até quatro endereços. Os alertas serão enviados a todos eles.")}
        </p>
      )}
      {values.map((value, i) => (
        <div className="email-row" key={i}>
          <label>
            <span>{t("E-mail {0}", [i + 1])}</span>
            <input
              type="email"
              required
              autoComplete={i === 0 ? "email" : "off"}
              maxLength={254}
              placeholder={t("voce@exemplo.com")}
              value={value}
              onChange={(e) => onChange(values.map((v, n) => (n === i ? e.target.value : v)))}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Remover e-mail {0}", [i + 1])}
            onClick={() => onChange(values.filter((_, n) => n !== i))}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
      ))}
      {values.length < 4 && (
        <Button type="button" variant="ghost" onClick={() => onChange([...values, ""])}>
          <Plus size={16} aria-hidden="true" />
          {values.length ? t("Adicionar outro e-mail") : t("Adicionar e-mail")}
        </Button>
      )}
    </fieldset>
  );
}
