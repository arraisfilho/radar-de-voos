import { useEffect, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage, t } from "./i18n";
import { api, type Session } from "./authApi";
import { LanguagePicker } from "./LanguagePicker";
import { Button } from "./ui";
import { SystemVersion } from "./SystemVersion";
import { AppIcon } from "./AppIcon";
import { ShellSkeleton } from "./Skeleton";
import { usePageTitle } from "./pageTitle";
// Each screen loads on demand: signed-in visits skip the entry forms and the
// phone number library; entry visits skip the dashboard.
const Dashboard = lazy(() => import("./App"));
const SignIn = lazy(() => import("./SignIn").then((module) => ({ default: module.SignIn })));
const RecoveryForm = lazy(() => import("./RecoveryForm").then((module) => ({ default: module.RecoveryForm })));

/** Entry card while the session is checked or an entry screen downloads. */
function EntryStatus({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <LanguagePicker />
      </div>
      <section className="auth-card card" aria-busy={!error}>
        <div className="auth-intro">
          <AppIcon size="lg" />
          <h1>{t("Radar de Voos")}</h1>
        </div>
        {/* Distinct keys: the alert enters as a new node and is announced. */}
        {error ? (
          <div key="error" className="auth-status" role="alert">
            <p>{error}</p>
            <Button className="full" size="large" onClick={onRetry}>
              {t("Tentar novamente")}
            </Button>
          </div>
        ) : (
          <div key="checking" className="auth-status" role="status">
            <p>{t("Verificando sessão…")}</p>
            <div className="auth-skeleton" aria-hidden="true">
              <span className="skeleton skeleton-field" />
              <span className="skeleton skeleton-field" />
              <span className="skeleton skeleton-button" />
            </div>
          </div>
        )}
      </section>
      <footer className="auth-footer">
        <SystemVersion />
      </footer>
    </main>
  );
}

export function AuthGate() {
  const language = useLanguage();
  const [recovery, setRecovery] = useState(() => location.hash.startsWith("#reset="));
  const [resetToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get("reset") || "");
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState("");
  const client = useQueryClient();
  // The sign-in form appears only once we know there is no session.
  function loadSession() {
    setError("");
    fetch("/api/auth/session")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setSession)
      .catch(() => setError(t("Não foi possível conectar ao radar.")));
  }
  useEffect(loadSession, []);
  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((fresh) => api("/profile/language", fresh.token, { language }, "PUT"))
      .catch(() => {
        if (active) setError(t("Não foi possível salvar o idioma dos alertas."));
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, language]);
  // Entry screens and the dashboard set their own titles.
  usePageTitle(!session && !recovery ? undefined : null);
  async function logout() {
    try {
      const refreshed: Session = await fetch("/api/auth/session", {
        cache: "no-store",
      }).then((r) => {
        if (!r.ok) throw Error(t("Não foi possível encerrar a sessão"));
        return r.json();
      });
      await api("/auth/logout", refreshed.token, {});
    } catch (e) {
      setError(t((e as Error).message));
      return;
    }
    client.clear();
    const fresh: Session = await fetch("/api/auth/session").then((r) => r.json());
    setSession(fresh);
  }
  if (recovery)
    return (
      <Suspense fallback={<EntryStatus />}>
        <RecoveryForm
          token={resetToken}
          onBack={() => {
            if (resetToken) location.replace("/");
            else setRecovery(false);
          }}
        />
      </Suspense>
    );
  // Signed in, the dashboard owns the only toast region and shows these errors.
  if (session?.user)
    return (
      <Suspense fallback={<ShellSkeleton />}>
        <Dashboard onLogout={logout} alert={error} onDismissAlert={() => setError("")} />
      </Suspense>
    );
  if (!session) return <EntryStatus error={error} onRetry={loadSession} />;
  return (
    <Suspense fallback={<EntryStatus />}>
      <SignIn session={session} onSignedIn={setSession} onRecover={() => setRecovery(true)} />
    </Suspense>
  );
}
