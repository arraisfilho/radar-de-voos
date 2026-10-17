import { t } from "./i18n";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
export function Button({
  className,
  variant = "primary",
  size = "standard",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "standard" | "large" | "icon";
}) {
  return (
    <button
      className={twMerge(clsx("button", `button-${variant}`, `button-${size}`, className))}
      {...props}
    />
  );
}
export function ResponsiveDetails({ label, children }: { label: string; children: ReactNode }) {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 760px)").matches);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return <div className="responsive-details">
    <button type="button" className="responsive-details-trigger" hidden={!compact} aria-expanded={!compact || expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{label}<ChevronDown size={18} /></button>
    <div id={id} hidden={compact && !expanded}>{children}</div>
  </div>;
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?:string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${wide ? "dialog-wide" : ""} ${className}`}>
          <div className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("Fechar janela")}>
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
