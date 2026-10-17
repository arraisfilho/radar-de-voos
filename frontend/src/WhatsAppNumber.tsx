import { t } from "./i18n";
import { PhoneField } from "./PhoneField";
import { Button } from "./ui";

/** The number typed in the trip review; the form keeps it across stages and saves it. */
export type NumberDraft = { country: string; phone: string; error: string; busy: boolean };

/**
 * The WhatsApp number typed in the trip review. "Salvar no perfil" saves it at once; otherwise
 * "Criar monitoramento" saves it first. Left empty, the trip is created without WhatsApp.
 * Enter saves the number, never the trip.
 */
export function WhatsAppNumber({
  value,
  onChange,
  onSave,
}: {
  value: NumberDraft;
  onChange: (next: NumberDraft) => void;
  onSave: () => void;
}) {
  return (
    <div
      className="whatsapp-inline"
      onKeyDown={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
        event.preventDefault();
        if (value.phone && !value.busy) onSave();
      }}
    >
      <PhoneField
        label={t("Número do WhatsApp")}
        country={value.country}
        value={value.phone}
        required={false}
        disabled={value.busy}
        onChange={(country, phone) => onChange({ ...value, country, phone, error: "" })}
      />
      <Button type="button" variant="outline" size="small" disabled={value.busy || !value.phone} onClick={onSave}>
        {value.busy ? t("Salvando…") : t("Salvar no perfil")}
      </Button>
      {value.error && (
        <p className="field-error" role="alert">
          {value.error}
        </p>
      )}
    </div>
  );
}
