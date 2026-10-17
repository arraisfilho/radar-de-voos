import { t } from "./i18n";
import type { User } from "./types";

/** The body of PUT /api/profile: every contact and preference, as the API replaces them together. */
export const contactsBody = (user: User) => ({
  additional_phones: user.additional_phones || [],
  timezone: user.timezone,
  quiet_hours: user.quiet_hours,
  quiet_start: user.quiet_start,
  quiet_end: user.quiet_end,
  name: user.name,
  telegram_username: user.telegram_username,
  emails: user.emails,
  whatsapp_use_login: user.whatsapp_use_login,
  whatsapp_country: user.whatsapp_country,
  whatsapp_phone: user.whatsapp_phone,
});

/** The same body with a WhatsApp number of its own (the number typed in the trip review). */
export const whatsappNumberBody = (user: User, country: string, phone: string) => ({
  ...contactsBody(user),
  whatsapp_use_login: false,
  whatsapp_country: country,
  whatsapp_phone: phone,
});

/** The error of a trip creation; after the review saved a WhatsApp number, it says the number stayed. */
export const creationFailure = (message: string, numberSaved: boolean) =>
  numberSaved ? t("O número de WhatsApp foi salvo no perfil, mas a viagem não foi criada: {0}", [message]) : message;
