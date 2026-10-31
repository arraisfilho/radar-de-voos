import { t } from "./i18n";
type Party = {
  adults: number;
  children?: number;
  infants_in_seat?: number;
  infants_on_lap?: number;
};
export const partyTotal = (p: Party) =>
  p.adults +
  (p.children || 0) +
  (p.infants_in_seat || 0) +
  (p.infants_on_lap || 0);
const adultsLabel = (n: number) => t(n === 1 ? "{0} adulto" : "{0} adultos", [n]);
export const partyLabel = (p: Party) =>
  partyTotal(p) === p.adults ? adultsLabel(p.adults) : t("{0} passageiros", [partyTotal(p)]);
/**
 * The source prices adults only: with children or infants, the fare was queried with children and
 * infants in seat as adults and infants on lap left out (backend/collector.py).
 */
export const estimatedFare = (p: Party) => partyTotal(p) > p.adults;
/** The party the estimate was queried with: "4 adultos". */
export const estimateParty = (p: Party) => adultsLabel(partyTotal(p) - (p.infants_on_lap || 0));
/** "Preço estimado para 4 adultos.", for one fare (an alert). */
export const estimateLabel = (p: Party) => t("Preço estimado para {0}.", [estimateParty(p)]);
/** What the estimate assumes for this party; empty for adults only. */
export function estimateNote(p: Party) {
  if (!estimatedFare(p)) return "";
  const asAdults = !p.infants_in_seat
    ? t("crianças contadas como adultos")
    : !p.children
      ? t("bebês com assento contados como adultos")
      : t("crianças e bebês com assento contados como adultos");
  if (!p.infants_on_lap) return t("Preço estimado: {0}. O valor final pode ser menor.", [asAdults]);
  return (p.children || 0) + (p.infants_in_seat || 0)
    ? t("Preço estimado: {0}; bebês no colo não incluídos no preço. O valor final pode ser diferente.", [asAdults])
    : t("Preço estimado: bebês no colo não incluídos no preço. O valor final pode ser maior.");
}
export const validParty = (p: Party) =>
  partyTotal(p) <= 9 && (p.infants_on_lap || 0) <= p.adults;
