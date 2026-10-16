import { ArrowRight, Plus, Plane, Pause, Clock } from "lucide-react";
import { Card, Button } from "./ui";
import { t, getLocale } from "./i18n";
import { tripTitle, legDates } from "./tripSummary";
import type { SearchRecord } from "./types";
const price = (value: number, currency: string) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100);
export function Home({
  searches,
  onOpen,
  onNew,
  onHistory,
}: {
  searches: SearchRecord[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  if (!searches.length)
    return (
      <Card className="home-empty">
        <div className="home-empty-heading">
          <Plane size={32} />
          <h2>{t("Qual será sua próxima viagem?")}</h2>
        </div>
        <p className="home-empty-copy">
          <span>{t("Escolha uma rota e acompanhe os preços.")}</span>
          <span>{t("Nós avisamos quando surgir uma oportunidade.")}</span>
        </p>
        <div className="home-empty-actions">
          <Button onClick={onNew}>
            <Plus size={18} />
            {t("Criar primeiro monitoramento")}
          </Button>
          <Button variant="ghost" onClick={onHistory}>
            {t("Ver histórico")}
          </Button>
        </div>
      </Card>
    );
  return (
    <>
      <div className="home-summary">
        <span>
          {t("{0} ativas · {1} pausadas", [
            searches.filter((s) => s.active).length,
            searches.filter((s) => !s.active).length,
          ])}
        </span>
        <span>{t("Selecione uma viagem para ver os voos.")}</span>
      </div>
      <div className="home-grid">
        {searches.map((search) => {
          const summary = tripTitle(search.config);
          return (
            <button
              key={search.id}
              className="home-monitor card"
              onClick={() => onOpen(search.id)}
            >
              <span
                className={`home-status ${search.active ? "active" : "paused"}`}
              >
                {search.active ? <Plane size={14} /> : <Pause size={14} />}{" "}
                {search.active ? t("Ativo") : t("Pausado")}
              </span>
              <h2>{summary.title}</h2>
              {summary.secondaryRoute && (
                <p className="home-route">{summary.secondaryRoute}</p>
              )}
              <div className="home-dates">
                <span>
                  <strong>{t("Ida")}</strong> {legDates(search.config.outbound)}
                </span>
                {search.config.inbound && (
                  <span>
                    <strong>{t("Volta")}</strong>{" "}
                    {legDates(search.config.inbound)}
                  </span>
                )}
              </div>
              <div className="home-prices">
                {(["outbound", "inbound"] as const)
                  .filter(
                    (side) => side === "outbound" || search.config.inbound,
                  )
                  .map((side) => (
                    <span key={side}>
                      <small>
                        {side === "outbound"
                          ? t("Última ida observada")
                          : t("Última volta observada")}
                      </small>
                      <strong>
                        {search.summary?.[side]
                          ? price(
                              search.summary[side]!.price,
                              search.config.currency,
                            )
                          : "—"}
                      </strong>
                    </span>
                  ))}
              </div>
              <span className="home-card-action">
                {search.last_finished
                  ? t("Ver voos")
                  : t("Aguardando primeira coleta")}{" "}
                {search.last_finished ? (
                  <ArrowRight size={16} />
                ) : (
                  <Clock size={15} />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
