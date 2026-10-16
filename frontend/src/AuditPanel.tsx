import { t, getLocale } from "./i18n";
import { useQuery } from "@tanstack/react-query";
import { Card } from "./ui";
type Access = {
  id: number;
  created: number;
  event: string;
  ip: string;
  browser: string;
  system: string;
  user_agent: string;
  actor_name?: string | null;
  account_name: string | null;
  login: string | null;
};
export function AuditPanel({ admin = false, expanded = false }: { admin?: boolean; expanded?: boolean }) {
  const query = useQuery<Access[]>({
    queryKey: ["audit", admin],
    queryFn: async () => {
      const result = await fetch(admin ? "/api/admin/audit" : "/api/audit", {
        cache: "no-store",
      });
      if (!result.ok) throw Error(t("Não foi possível carregar os acessos"));
      return result.json();
    },
    refetchInterval: 30000,
  });
  const labels: Record<string, string> = {
    admin_account_created:t("Cadastro criado pelo administrador"),
    admin_account_updated:t("Cadastro alterado pelo administrador"),
    admin_password_reset:t("Senha redefinida pelo administrador"),
    login_success: t("Login realizado"),
    login_failed: t("Login recusado"),
    login_throttled: t("Tentativas limitadas"),
    register_success: t("Cadastro realizado"),
    bootstrap_success: t("Administrador criado"),
    recovery_requested: t("Recuperação solicitada"),
    password_reset: t("Senha redefinida"),
    logout: t("Logout realizado"),
  };
  return (
    <Card className="audit-panel">
      <details open={expanded || undefined}>
        <summary>
          {admin ? t("Auditoria de acessos") : t("Seus acessos recentes")}
        </summary>
        <p className="help">
          {t(
            "IP da conexão e navegador/sistema informados pelo dispositivo. Não identificam com certeza uma pessoa ou o modelo do aparelho. Retenção padrão: 90 dias, até 20 mil registros.",
          )}
        </p>
        {query.isError ? (
          <p role="alert">{t("Não foi possível carregar os acessos")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {admin && <th>{t("Conta")}</th>}
                  <th>{t("Data e hora")}</th>
                  <th>{t("Evento")}</th>
                  <th>IP</th>
                  <th>{t("Dispositivo")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.map((entry) => (
                  <tr key={entry.id}>
                    {admin && (
                      <td>
                        {entry.account_name || t("Não identificado")}
                        <small>{entry.login}</small>
                      </td>
                    )}
                    <td>
                      {new Date(entry.created * 1000).toLocaleString(
                        getLocale(),
                      )}
                    </td>
                    <td>{labels[entry.event] || entry.event}{admin&&entry.actor_name&&<small>{t("Por: {0}",[entry.actor_name])}</small>}</td>
                    <td>{entry.ip}</td>
                    <td>
                      <details>
                        <summary>
                          {entry.browser} · {entry.system}
                        </summary>
                        <small>{entry.user_agent}</small>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </Card>
  );
}
