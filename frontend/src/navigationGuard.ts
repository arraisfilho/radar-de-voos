import { useEffect, useRef } from "react";

const checks = new Set<() => boolean>();
let saving = false;
export function hasUnsavedChanges() {
  return !saving && [...checks].some((check) => check());
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
  window.dispatchEvent(
    new CustomEvent("radar:leave-form", { detail: { proceed, cancel } }),
  );
}
export function useUnsavedChanges(dirty: boolean) {
  const current = useRef(dirty);
  current.current = dirty;
  useEffect(() => {
    const check = () => current.current;
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
