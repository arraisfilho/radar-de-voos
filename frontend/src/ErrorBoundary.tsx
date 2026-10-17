import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { t } from "./i18n";

type Props = {
  children: ReactNode;
  /** "root" replaces the whole screen; "view" keeps the shell and fills <main>. */
  scope?: "root" | "view";
  /** A new value clears the error, so navigating away recovers the view. */
  resetKey?: string;
  onHome?: () => void;
};
type State = { error: Error | null; resetKey?: string };

const reload = () => window.location.reload();

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.scope === "view")
      return (
        <section className="view-error card" role="alert">
          <div className="empty-state">
            <TriangleAlert aria-hidden="true" />
            <h2>{t("Não foi possível abrir esta página")}</h2>
            <p>{t("Recarregue para tentar de novo. Se o problema continuar, tente mais tarde.")}</p>
            <div className="view-error-actions">
              <button type="button" className="button button-primary button-large" onClick={reload}>
                <RotateCw size={18} aria-hidden="true" />
                {t("Recarregar")}
              </button>
              {this.props.onHome && (
                <button type="button" className="button button-ghost button-large" onClick={this.props.onHome}>
                  {t("Voltar às viagens")}
                </button>
              )}
            </div>
          </div>
        </section>
      );
    return (
      <main className="auth-page">
        <section className="auth-card card" role="alert">
          <div className="auth-intro">
            <span className="error-symbol" aria-hidden="true">
              <TriangleAlert size={30} />
            </span>
            <h1>{t("Algo deu errado")}</h1>
            <p>{t("O Radar de Voos encontrou um erro inesperado. Recarregue a página para continuar.")}</p>
          </div>
          <button type="button" className="button button-primary button-large full" onClick={reload}>
            <RotateCw size={18} aria-hidden="true" />
            {t("Recarregar")}
          </button>
        </section>
      </main>
    );
  }
}
