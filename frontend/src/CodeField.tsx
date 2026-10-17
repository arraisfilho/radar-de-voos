import type { InputHTMLAttributes, Ref } from "react";
import { clsx } from "clsx";
import { t } from "./i18n";

/** The digits of a typed or pasted code, at most six: "123 456" → "123456". */
export function codeDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

/** The field after pasting: the digits of `pasted` in place of the selection, and the caret after them. */
export function pasteCode(value: string, pasted: string, start: number, end: number): { value: string; caret: number } {
  const digits = pasted.replace(/\D/g, "");
  const next = codeDigits(value.slice(0, start) + digits + value.slice(end));
  return { value: next, caret: Math.min(start + digits.length, next.length) };
}

/**
 * The six-digit code of an authenticator app: numeric keyboard, one-time-code
 * autofill, and a pasted "123 456" kept as "123456". A paste with digits goes in
 * place of the selection and is read whole, before maxLength would cut the last
 * digit; a paste without digits is left to the browser (and dropped by onChange).
 */
export function CodeField({
  label,
  value,
  onValue,
  className,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  label: string;
  value: string;
  onValue: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <label className={clsx("code-field", className)}>
      <span>{label}</span>
      <input
        // Completes the browser's "match the requested format" message.
        title={t("Digite os 6 dígitos do código.")}
        {...props}
        ref={ref}
        className="code-input"
        type="text"
        required
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(event) => onValue(codeDigits(event.target.value))}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!/\d/.test(pasted)) return;
          event.preventDefault();
          const input = event.currentTarget;
          const next = pasteCode(value, pasted, input.selectionStart ?? value.length, input.selectionEnd ?? value.length);
          onValue(next.value);
          // The new value puts the caret at the end; it goes back after the pasted digits.
          requestAnimationFrame(() => {
            if (document.activeElement === input) input.setSelectionRange(next.caret, next.caret);
          });
        }}
      />
    </label>
  );
}
