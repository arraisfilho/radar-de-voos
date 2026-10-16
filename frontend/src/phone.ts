import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parseIncompletePhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
const sharedDefaults: Record<string, CountryCode> = {
  "1": "US",
  "7": "RU",
  "44": "GB",
  "39": "IT",
  "61": "AU",
  "64": "NZ",
  "47": "NO",
  "358": "FI",
  "590": "GP",
  "262": "RE",
  "599": "CW",
};
export function formatPhone(value: string, country: string) {
  const selected = country as CountryCode;
  const clean = parseIncompletePhoneNumber(value);
  if (!clean.startsWith("+"))
    return {
      country,
      value: clean,
      display: new AsYouType(selected).input(clean),
    };
  const formatter = new AsYouType(selected);
  const international = formatter.input(clean);
  const code = formatter.getCallingCode();
  if (!code) return { country, value: clean, display: international };
  const candidates = getCountries().filter(
    (c) => getCountryCallingCode(c) === code,
  );
  const detected =
    formatter.getCountry() ||
    (getCountryCallingCode(selected) === code
      ? selected
      : sharedDefaults[code] ||
        (candidates.length === 1 ? candidates[0] : undefined));
  if (!detected) return { country, value: clean, display: international };
  const number = formatter.getNumber();
  const national = number
    ? parseIncompletePhoneNumber(number.formatNational())
    : clean.slice(code.length + 1);
  return {
    country: detected,
    value: national,
    display: new AsYouType(detected).input(national),
  };
}
export function changePhoneCountry(
  value: string,
  previousCountry: string,
  country: string,
) {
  return formatPhone(
    formatPhone(value, previousCountry).value.replace(/\D/g, ""),
    country,
  );
}
export function editPhone(
  raw: string,
  country: string,
  previousDisplay: string,
  cursor: number,
  inputType: string,
) {
  const count = (text: string) => text.replace(/\D/g, "").length;
  // Deleting a formatting character must still allow deleting a digit.
  if (
    inputType.startsWith("delete") &&
    count(raw) === count(previousDisplay) &&
    raw.length < previousDisplay.length
  ) {
    const indices = [...raw.matchAll(/\d/g)].map((match) => match.index!);
    const digit =
      inputType === "deleteContentBackward"
        ? indices.filter((index) => index < cursor).at(-1)
        : indices.find((index) => index >= cursor);
    if (digit !== undefined) {
      raw = raw.slice(0, digit) + raw.slice(digit + 1);
      if (digit < cursor) cursor--;
    }
  }
  const next = formatPhone(raw, country);
  let digits = count(raw.slice(0, cursor));
  if (raw.trim().startsWith("+") && !next.value.startsWith("+"))
    digits = Math.max(0, digits - (count(raw) - count(next.value)));
  let position = 0;
  if (digits > 0) {
    let seen = 0;
    position = next.display.length;
    for (let i = 0; i < next.display.length; i++)
      if (/\d/.test(next.display[i]) && ++seen === digits) {
        position = i + 1;
        break;
      }
  }
  return { ...next, cursor: position };
}
export function possiblePhone(value: string, country: string) {
  return !!parsePhoneNumberFromString(
    value,
    country as CountryCode,
  )?.isPossible();
}
