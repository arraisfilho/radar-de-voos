import { useEffect, useRef } from "react";

/** What the leave dialog says for one form; a missing part keeps the text about unsaved changes. */
export type LeavePrompt = { title?: string; description?: string; stay?: string; leave?: string };
type Check = { dirty: () => boolean; prompt: () => LeavePrompt | undefined };
const checks = new Set<Check>();
let saving = false;
export function hasUnsavedChanges() {
  return !saving && [...checks].some((check) => check.dirty());
}
export function afterSave(action: () => void) {
  saving = true;
  try {
    action();
  } finally {
    saving = false;
  }
}
export function confirmNavigation(proceed: () => void, cancel = () => {}) {
  if (!hasUnsavedChanges()) {
    proceed();
    return;
  }
  // Leaving discards every form with something to lose: a text of its own speaks only when
  // all of them have one; otherwise the text about unsaved changes, true for all of them.
  const dirty = [...checks].filter((check) => check.dirty());
  const prompt = dirty.every((check) => check.prompt()) ? dirty[0].prompt() : undefined;
  window.dispatchEvent(
    new CustomEvent("radar:leave-form", { detail: { proceed, cancel, prompt } }),
  );
}
/** Asks before leaving while `dirty`; `prompt` replaces the dialog's text for this form. */
export function useUnsavedChanges(dirty: boolean, prompt?: LeavePrompt) {
  const current = useRef(dirty),
    text = useRef(prompt);
  current.current = dirty;
  text.current = prompt;
  useEffect(() => {
    const check = { dirty: () => current.current, prompt: () => text.current };
    checks.add(check);
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      checks.delete(check);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);
}
