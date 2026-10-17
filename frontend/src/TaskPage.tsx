import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "./ui";
import { t } from "./i18n";

export function TaskPage({
  title,
  description,
  onBack,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  onBack: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`task-page ${className}`}>
      <header className="task-heading">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={17} />
          {t("Voltar")}
        </Button>
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </header>
      <div className="task-body">{children}</div>
    </section>
  );
}
