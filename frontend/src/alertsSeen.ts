import { useSyncExternalStore } from "react";

/**
 * The last visit to the alert center on this device, per account (server time, seconds): the
 * "Alertas" badge counts only what arrived after it. Without storage it lasts for this visit.
 */
const memory = new Map<string, number>();
const listeners = new Set<() => void>();
const key = (user: string) => "radar-alerts-seen:" + user;

export function alertsSeenAt(user: string): number | null {
  try {
    const value = Number(localStorage.getItem(key(user)));
    if (value > 0) return value;
  } catch {
    /* Storage is optional. */
  }
  return memory.get(user) ?? null;
}

export function markAlertsSeen(user: string, when: number) {
  if ((alertsSeenAt(user) ?? 0) >= when) return;
  memory.set(user, when);
  try {
    localStorage.setItem(key(user), String(when));
  } catch {
    /* Kept in memory. */
  }
  listeners.forEach((listener) => listener());
}

export function useAlertsSeen(user: string | undefined): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (user ? alertsSeenAt(user) : null),
    () => null,
  );
}

/** Alerts created after the last visit; a first visit on this device starts the count from now. */
export const unseenAlerts = (recent: number[] | undefined, seen: number | null) =>
  seen === null ? 0 : (recent || []).filter((created) => created > seen).length;
