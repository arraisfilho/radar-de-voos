import { useId, useState, type InputHTMLAttributes, type Ref } from "react";
import { Eye, EyeOff } from "lucide-react";
import { t } from "./i18n";
import "./password-field.css";

/** `ref` reaches the <input> with the other props (a plain prop since React 19). */
export function PasswordField({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; ref?: Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return <div className="password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-control">
      <input {...props} id={id} type={visible ? "text" : "password"} />
      <button type="button" disabled={props.disabled} aria-controls={id} aria-pressed={visible}
        aria-label={visible ? t("Ocultar senha") : t("Mostrar senha")}
        onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
