import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "./ui";
import { t } from "./i18n";
import type { LeavePrompt } from "./navigationGuard";

export function NavigationPrompt() {
  const [pending, setPending] = useState<{
    proceed: () => void;
    cancel: () => void;
    prompt?: LeavePrompt;
  } | null>(null);
  // The text of the last request stays while the dialog fades out.
  const prompt = useRef<LeavePrompt | undefined>(undefined);
  useEffect(() => {
    const ask = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      prompt.current = detail.prompt;
      setPending(detail);
    };
    window.addEventListener("radar:leave-form", ask);
    return () => window.removeEventListener("radar:leave-form", ask);
  }, []);
  function stay() {
    pending?.cancel();
    setPending(null);
  }
  return (
    <Modal
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) stay();
      }}
      title={prompt.current?.title || t("Descartar alterações?")}
      description={prompt.current?.description || t("Há informações não salvas neste formulário.")}
    >
      <div className="dialog-actions">
        <Button variant="outline" onClick={stay}>
          {prompt.current?.stay || t("Continuar editando")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            const next = pending;
            setPending(null);
            next?.proceed();
          }}
        >
          {prompt.current?.leave || t("Descartar e sair")}
        </Button>
      </div>
    </Modal>
  );
}
