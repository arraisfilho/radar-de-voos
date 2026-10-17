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
export const partyLabel = (p: Party) =>
  partyTotal(p) === p.adults
    ? t(p.adults === 1 ? "{0} adulto" : "{0} adultos", [p.adults])
    : t("{0} passageiros", [partyTotal(p)]);
export const validParty = (p: Party) =>
  partyTotal(p) <= 9 && (p.infants_on_lap || 0) <= p.adults;
