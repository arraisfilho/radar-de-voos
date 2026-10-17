import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js";

export type PhoneCountry = { code: CountryCode; name: string; callingCode: string; flag: string };
const catalogs = new Map<string, PhoneCountry[]>();
const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();

export function phoneCountries(locale: string): PhoneCountry[] {
  let countries = catalogs.get(locale);
  if (!countries) {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    countries = getCountries().map((code) => ({
      code,
      name: names.of(code) || code,
      callingCode: getCountryCallingCode(code),
      flag: String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))),
    })).sort((a, b) => a.name.localeCompare(b.name, locale));
    catalogs.set(locale, countries);
  }
  return countries;
}

export function filterPhoneCountries(countries: PhoneCountry[], query: string) {
  const term = normalize(query);
  if (!term || term === "+") return countries;
  const numeric = /^[+\d\s()-]+$/.test(term);
  const digits = term.replace(/\D/g, "").replace(/^00/, "");
  return countries.filter((country) => numeric
    ? !!digits && country.callingCode.startsWith(digits)
    : normalize(country.name).includes(term) || country.code.toLowerCase() === term);
}
