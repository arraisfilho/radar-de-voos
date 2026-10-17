import { t } from "./i18n";

/**
 * Count with the right noun form: the singular key only for exactly one, as
 * Portuguese, English and Spanish read it ("1 viagem", "0 viagens"). Both keys
 * take the count as {0}, written as `shown` when given (formatNumber: "2.000").
 */
export function plural(count: number, one: string, other: string, shown: string | number = count): string {
  return t(count === 1 ? one : other, [shown]);
}
