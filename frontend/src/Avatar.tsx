import { clsx } from "clsx";
import { getLocale } from "./i18n";

/** Monogram for the account avatar: first and last initials. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((word) => Array.from(word)[0] || "").join("").toLocaleUpperCase(getLocale()) || "?";
}

/** Decorative monogram; the name is always written next to it. */
export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span className={clsx("avatar", size === "lg" && "avatar-lg")} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
