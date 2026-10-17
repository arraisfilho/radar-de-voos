import { Plane } from "lucide-react";
import { clsx } from "clsx";

/** App icon: white plane on the brand gradient squircle. Decorative. */
export function AppIcon({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span className={clsx("app-icon", size !== "md" && `app-icon-${size}`, className)} aria-hidden="true">
      <Plane strokeWidth={2.2} />
    </span>
  );
}
