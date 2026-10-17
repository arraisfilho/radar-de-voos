import { useEffect, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "./ui";
import { t } from "./i18n";
import { focusPageHeading, restoreHeadingFocus } from "./navigation";

/**
 * An administration task (message details, account forms, monitorings) as a
 * page of its own: back control, title and content, as an iOS pushed screen.
 */
export function TaskPage({
  title,
  description,
  onBack,
  backLabel,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  onBack: () => void;
  /** Where "back" leads ("Voltar aos usuários"); "Voltar" when omitted. */
  backLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  // Task pages arrive inside lazily loaded views, after the shell rendered:
  // a pending heading focus from the navigation lands here once it exists,
  // and a loading title replaced by this one hands its focus over.
  useEffect(() => {
    focusPageHeading();
    restoreHeadingFocus();
  }, []);
  return (
    <section className={clsx("task-page", className)}>
      <header className="task-heading">
        <Button variant="ghost" size="small" className="task-back" onClick={onBack}>
          <ChevronLeft size={18} aria-hidden="true" />
          {backLabel || t("Voltar")}
        </Button>
        <h1 tabIndex={-1}>{title}</h1>
        {description && <p>{description}</p>}
      </header>
      <div className="task-body">{children}</div>
    </section>
  );
}
