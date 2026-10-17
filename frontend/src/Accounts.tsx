import { useEffect, useState, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLanguage, useLanguageReady, t } from "./i18n";
import { api, type Session } from "./authApi";
import { LanguagePicker } from "./LanguagePicker";
import { AppearancePicker } from "./AppearancePicker";
import { Button } from "./ui";
import { SystemVersion } from "./SystemVersion";
import { AppIcon } from "./AppIcon";
import { ShellSkeleton } from "./Skeleton";
import { usePageTitle } from "./pageTitle";
// Each screen loads on demand: signed-in visits skip the entry forms and the
// phone number library; entry visits skip the dashboard. The gate can start a
// download early, with the same import as the screen.
const loadDashboard = () => import("./App");
const loadSignIn = () => import("./SignIn");
const loadRecovery = () => import("./RecoveryForm");
const Dashboard = lazy(loadDashboard);
const SignIn = lazy(() => loadSignIn().then((module) => ({ default: module.SignIn })));
const RecoveryForm = lazy(() => loadRecovery().then((module) => ({ default: module.RecoveryForm })));

/** Entry card while the session is checked or an entry screen downloads. */
function EntryStatus({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <LanguagePicker />
        <AppearancePicker />
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

/** The entry card without text while the first catalog downloads, so an English
 * or Spanish visit never shows Portuguese first. */
function EntryPlaceholder() {
  return (
    <main className="auth-page">
      <section className="auth-card card" aria-busy="true">
        <div className="auth-intro">
          <AppIcon size="lg" />
        </div>
        <div className="auth-skeleton" aria-hidden="true">
          <span className="skeleton skeleton-field" />
          <span className="skeleton skeleton-field" />
          <span className="skeleton skeleton-button" />
        </div>
      </section>
    </main>
  );
}

export function AuthGate() {
  const language = useLanguage(),
    ready = useLanguageReady();
  const [recovery, setRecovery] = useState(() => location.hash.startsWith("#reset="));
  const [resetToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get("reset") || "");
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState("");
  const client = useQueryClient();
  // The sign-in form appears only once we know there is no session. Errors stay
  // untranslated until shown, so a catalog that arrives later still applies.
  function loadSession() {
    setError("");
    fetch("/api/auth/session")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setSession)
      .catch(() => setError("Não foi possível conectar ao radar."));
  }
  useEffect(loadSession, []);
  useEffect(() => {
    if (!session?.user) return;
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((fresh) => api("/profile/language", fresh.token, { language }, "PUT"))
      .catch(() => {
        if (active) setError("Não foi possível salvar o idioma dos alertas.");
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, language]);
  // While the first catalog downloads, the next screen downloads too.
  useEffect(() => {
    if (ready) return;
    const next: (() => Promise<unknown>) | null = recovery
      ? loadRecovery
      : session && (session.user ? loadDashboard : loadSignIn);
    next?.().catch(() => {}); // The screen reports a failure when it renders.
  }, [ready, recovery, session]);
  // Entry screens and the dashboard set their own titles; none before the texts.
  usePageTitle(ready && !session && !recovery ? undefined : null);
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
      setError((e as Error).message);
      return;
    }
    client.clear();
    // Recovery codes kept in memory for the profile (TwoFactorSettings.tsx) go with the session.
    window.dispatchEvent(new Event("radar:signed-out"));
    const fresh: Session = await fetch("/api/auth/session").then((r) => r.json());
    setSession(fresh);
  }
  // In English or Spanish the first catalog is still downloading: a card without
  // text meanwhile, while the session and the next screen download alongside.
  if (!ready) return <EntryPlaceholder />;
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
        <Dashboard onLogout={logout} alert={error && t(error)} onDismissAlert={() => setError("")} />
      </Suspense>
    );
  if (!session) return <EntryStatus error={error && t(error)} onRetry={loadSession} />;
  return (
    <Suspense fallback={<EntryStatus />}>
      <SignIn session={session} onSignedIn={setSession} onRecover={() => setRecovery(true)} />
    </Suspense>
  );
}
