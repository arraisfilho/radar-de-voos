import { useState } from "react";
import { Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "./i18n";
import { api, type Session } from "./authApi";
import { Button, Card } from "./ui";
import { PhoneField } from "./PhoneField";
import { PasswordField } from "./PasswordField";
import { EmailFields } from "./EmailFields";
import { LanguagePicker } from "./LanguagePicker";
import { SystemVersion } from "./SystemVersion";
import { AppIcon } from "./AppIcon";
import { usePageTitle } from "./pageTitle";
import type { User } from "./types";

/**
 * Sign-in, sign-up and the first administrator. Loaded on demand, so signed-in
 * visits never download the phone number library at startup.
 */
export function SignIn({
  session,
  onSignedIn,
  onRecover,
}: {
  session: Session;
  onSignedIn: (session: Session) => void;
  onRecover: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"login" | "register" | "admin">("login");
  const [name, setName] = useState(""),
    [country, setCountry] = useState("BR"),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [emails, setEmails] = useState<string[]>([]);
  const client = useQueryClient();
  usePageTitle(mode === "login" ? t("Entrar") : mode === "admin" ? t("Configurar administrador") : t("Criar conta"));
  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <LanguagePicker />
      </div>
      <Card className="auth-card">
        <div className="auth-intro">
          <AppIcon size="lg" />
          <h1>{t("Radar de Voos")}</h1>
          <h2 className="auth-heading">
            {mode === "login" ? t("Entre no seu radar") : mode === "admin" ? t("Cadastre o administrador") : t("Crie sua conta")}
          </h2>
          <p>
            {mode === "login"
              ? t("Suas viagens e alertas em um só lugar.")
              : mode === "admin"
                ? t("Gerencie o serviço de e-mail e mantenha suas buscas existentes.")
                : t("Escolha suas viagens. Nós acompanhamos os preços.")}
          </p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const user: User = await api(
                mode === "login" ? "/auth/login" : mode === "admin" ? "/auth/bootstrap" : "/auth/register",
                session.token,
                {
                  name,
                  country,
                  phone,
                  password,
                  emails,
                  whatsapp_use_login: true,
                  whatsapp_country: country,
                },
              );
              client.clear();
              setPassword("");
              onSignedIn({
                ...session,
                user,
                can_bootstrap: mode === "admin" ? false : session.can_bootstrap,
              });
            } catch (e) {
              setError(t((e as Error).message));
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode !== "login" && (
            <label>
              {t("Seu nome")}
              <input
                required
                autoComplete="name"
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          <PhoneField
            label={t("Celular de acesso")}
            country={country}
            value={phone}
            onChange={(c, p) => {
              setCountry(c);
              setPhone(p);
            }}
          />
          <PasswordField
            key={mode}
            label={t("Senha")}
            required
            minLength={mode === "login" ? 1 : 10}
            maxLength={200}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode !== "login" && <p className="help">{t("Use pelo menos dez caracteres.")}</p>}
          {mode !== "login" && (
            <details className="optional-contacts">
              <summary>{t("Adicionar e-mails para alertas (opcional)")}</summary>
              <EmailFields values={emails} onChange={setEmails} />
            </details>
          )}
          {mode === "admin" && (
            <p className="help">{t("Se já cadastrou esse telefone, use a senha da conta existente.")}</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button className="full" size="large" type="submit" disabled={busy}>
            {busy ? t("Aguarde…") : mode === "login" ? t("Entrar") : mode === "admin" ? t("Criar administrador") : t("Criar conta")}
          </Button>
        </form>
        {mode === "login" && (
          <div className="auth-links">
            <Button type="button" variant="ghost" onClick={onRecover}>
              {t("Esqueci minha senha")}
            </Button>
          </div>
        )}
        {session.registration_open !== false ? (
          <div className="auth-switch">
            <span>{mode === "login" ? t("Ainda não tem conta?") : t("Já tem uma conta?")}</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setPassword("");
              }}
            >
              {mode === "login" ? t("Criar conta") : t("Entrar")}
            </Button>
          </div>
        ) : (
          <p className="auth-note">{t("Solicite seu cadastro ao administrador.")}</p>
        )}
        {session.can_bootstrap && mode !== "admin" && (
          <button
            type="button"
            className="bootstrap-link"
            onClick={() => {
              setMode("admin");
              setError("");
            }}
          >
            <Shield size={16} aria-hidden="true" />
            {t("Configurar administrador")}
          </button>
        )}
        {mode === "admin" && (
          <p className="auth-note">{t("Esta configuração inicial só está disponível neste computador.")}</p>
        )}
      </Card>
      <footer className="auth-footer">
        <SystemVersion />
      </footer>
    </main>
  );
}
