import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./ui";
import { t } from "./i18n";

/**
 * "Atualizar" on the trip page. After a refresh (or a collection that just started) it counts
 * down to the moment the server accepts another one; the server enforces the same wait.
 */
export function RefreshButton({
  refreshAfter,
  serverNow,
  collecting,
  onRefresh,
}: {
  refreshAfter?: number;
  serverNow: number;
  collecting: boolean;
  onRefresh: () => Promise<void> | void;
}) {
  // serverNow comes with the state; a one-second timer advances it between polls.
  const [now, setNow] = useState(serverNow);
  const [busy, setBusy] = useState(false);
  const wait = Math.max(0, Math.ceil((refreshAfter || 0) - now));
  useEffect(() => setNow(serverNow), [serverNow, refreshAfter]);
  useEffect(() => {
    if (!wait) return;
    const timer = setInterval(() => setNow((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [wait > 0]);
  const disabled = busy || collecting || wait > 0;
  const label = collecting ? t("Atualizando…") : wait > 0 ? t("Atualizar em {0} s", [wait]) : t("Atualizar");
  return (
    <Button
      variant="outline"
      size="small"
      className="refresh-button"
      aria-disabled={disabled}
      title={wait > 0 ? t("Uma atualização manual por viagem a cada 60 segundos.") : undefined}
      onClick={async () => {
        if (disabled) return;
        setBusy(true);
        try {
          await onRefresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {collecting || busy ? (
        <LoaderCircle size={15} className="spin" aria-hidden="true" />
      ) : (
        <RefreshCw size={15} aria-hidden="true" />
      )}
      {/* No live region: the countdown would be read every second; the toast says when it starts. */}
      <span className="refresh-label">{label}</span>
    </Button>
  );
}
