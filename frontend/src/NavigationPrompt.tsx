import { useEffect, useState } from "react";
import { Button, Modal } from "./ui";
import { t } from "./i18n";

export function NavigationPrompt() {
  const [pending, setPending] = useState<{
    proceed: () => void;
    cancel: () => void;
  } | null>(null);
  useEffect(() => {
    const ask = (event: Event) => setPending((event as CustomEvent).detail);
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
      title={t("Descartar alterações?")}
      description={t("Há informações não salvas neste formulário.")}
    >
      <div className="dialog-actions">
        <Button variant="outline" onClick={stay}>
          {t("Continuar editando")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            const next = pending;
            setPending(null);
            next?.proceed();
          }}
        >
          {t("Descartar e sair")}
        </Button>
      </div>
    </Modal>
  );
}
