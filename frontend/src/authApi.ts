import { getLanguage, t } from "./i18n";
import type { User } from "./types";

export type Session = {
  user: User | null;
  token: string;
  can_bootstrap: boolean;
  registration_open?: boolean;
};

/** Error of an account request: the translated message and the HTTP status. */
export type ApiError = Error & { status?: number };

/** HTTP status of a failed account request, when the server answered. */
export const errorStatus = (error: unknown) => (error as ApiError | null)?.status;

/** Account requests outside the dashboard; errors come back translated, with their status. */
export async function api(path: string, token: string, body: unknown, method = "POST") {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-radar-token": token,
      "x-radar-language": getLanguage(),
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(
        t(
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((d: { msg: string }) => t(d.msg.replace(/^Value error, /, ""))).join(" · ")
              : t("Não foi possível concluir a ação"),
        ),
      ),
      { status: r.status },
    );
  return data;
}
