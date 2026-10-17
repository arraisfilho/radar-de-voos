import { useEffect, useRef, useState } from "react";
import { confirmNavigation, hasUnsavedChanges } from "./navigationGuard";

export type View =
  | "home"
  | "searches"
  | "history"
  | "alerts"
  | "settings"
  | "admin"
  | "notfound";
export type AppRoute = {
  view: View;
  searchId?: string;
  editor?: "new" | "edit" | "alerts";
  step?: number;
  leg?: "outbound" | "inbound";
  panel?: "flights" | "alerts";
  section?: "deliveries" | "channels" | "users" | "audit" | "retention";
  channel?: string;
  userId?: string;
  userAction?: "new" | "edit" | "password" | "monitorings";
  monitorId?: string;
  deliveryId?: string;
};
export type Navigate = (
  next: AppRoute | ((current: AppRoute) => AppRoute),
  replace?: boolean,
) => void;
const sections = {
  envios: "deliveries",
  canais: "channels",
  usuarios: "users",
  auditoria: "audit",
  retencao: "retention",
} as const;
const sectionPaths = {
  deliveries: "envios",
  channels: "canais",
  users: "usuarios",
  audit: "auditoria",
  retention: "retencao",
};
const actions = {
  editar: "edit",
  senha: "password",
  monitoramentos: "monitorings",
} as const;

export function parseRoute(path: string, query = ""): AppRoute {
  let p: string[];
  try {
    p = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { view: "notfound" };
  }
  const params = new URLSearchParams(query);
  const stage = {
    step: Math.min(
      2,
      Math.max(0, Math.floor(Number(params.get("etapa"))) || 0),
    ),
    leg:
      params.get("trecho") === "volta"
        ? ("inbound" as const)
        : ("outbound" as const),
  };
  if (!p.length || (p[0] === "viagens" && p.length === 1))
    return { view: "home" };
  if (p[0] === "viagens") {
    if (p[1] === "nova" && p.length === 2)
      return { view: "home", editor: "new", ...stage };
    if (p[1] && p.length <= 3) {
      const base: AppRoute = { view: "searches", searchId: p[1] };
      if (p.length === 2) return base;
      if (p[2] === "editar") return { ...base, editor: "edit", ...stage };
      if (p[2] === "notificacoes") return { ...base, editor: "alerts" };
      if (p[2] === "historico") return { ...base, view: "history" };
      if (p[2] === "alertas") return { ...base, panel: "alerts" };
    }
  }
  if (p.length === 1 && p[0] === "historico") return { view: "history" };
  if (p.length === 1 && p[0] === "alertas") return { view: "alerts" };
  if (p.length === 1 && p[0] === "perfil") return { view: "settings" };
  if (p[0] === "admin") {
    if (p.length === 1) return { view: "admin", section: "deliveries" };
    const section = sections[p[1] as keyof typeof sections];
    if (!section) return { view: "notfound" };
    const base: AppRoute = { view: "admin", section };
    if (p.length === 2) return base;
    if (
      section === "channels" &&
      p.length === 3 &&
      ["email", "whatsapp", "telegram"].includes(p[2])
    )
      return { ...base, channel: p[2] };
    if (section === "deliveries" && p.length === 3)
      return { ...base, deliveryId: p[2] };
    if (section === "users") {
      if (p.length === 3 && p[2] === "novo")
        return { ...base, userAction: "new" };
      const userAction = actions[p[3] as keyof typeof actions];
      if (
        p[2] &&
        userAction &&
        (p.length === 4 || (p.length === 5 && userAction === "monitorings"))
      )
        return { ...base, userId: p[2], userAction, monitorId: p[4] };
    }
  }
  return { view: "notfound" };
}

export function routePath(r: AppRoute): string {
  const id = encodeURIComponent;
  let path = "/viagens";
  if (r.view === "admin") {
    const section = r.section || "deliveries";
    path = "/admin/" + sectionPaths[section];
    if (section === "channels") path += "/" + (r.channel || "email");
    if (section === "deliveries" && r.deliveryId)
      path += "/" + id(r.deliveryId);
    if (section === "users") {
      if (r.userAction === "new") path += "/novo";
      else if (r.userId && r.userAction) {
        path +=
          "/" +
          id(r.userId) +
          "/" +
          { edit: "editar", password: "senha", monitorings: "monitoramentos" }[
            r.userAction
          ];
        if (r.userAction === "monitorings" && r.monitorId)
          path += "/" + id(r.monitorId);
      }
    }
  } else if (r.editor === "new") path += "/nova";
  else if (r.searchId && ["searches", "history"].includes(r.view)) {
    path += "/" + id(r.searchId);
    if (r.editor === "edit") path += "/editar";
    else if (r.editor === "alerts") path += "/notificacoes";
    else if (r.view === "history") path += "/historico";
    else if (r.panel === "alerts") path += "/alertas";
  } else
    path = (
      {
        home: "/viagens",
        history: "/historico",
        alerts: "/alertas",
        settings: "/perfil",
        searches: "/viagens",
        notfound: "/404",
      } as const
    )[r.view];
  if (r.editor === "new" || r.editor === "edit") {
    const q = new URLSearchParams();
    if (r.step) q.set("etapa", String(r.step));
    if (r.leg === "inbound") q.set("trecho", "volta");
    if (q.size) path += "?" + q;
  }
  return path;
}

export function useNavigation() {
  const read = () =>
    parseRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<AppRoute>(read);
  const pendingScroll = useRef<number | null>(null);
  const restoreScroll = () => {
    if (pendingScroll.current == null) return;
    const top = pendingScroll.current;
    pendingScroll.current = null;
    requestAnimationFrame(() => window.scrollTo(0, top));
  };
  useEffect(() => {
    let index = window.history.state?.radarIndex || 0,
      reverting = false,
      approved = false;
    if (window.history.state?.radarIndex == null)
      window.history.replaceState(
        { ...window.history.state, radarIndex: index },
        "",
      );
    const restore = () => {
      const targetIndex = window.history.state?.radarIndex || 0;
      if (reverting) {
        reverting = false;
        return;
      }
      if (!approved && hasUnsavedChanges() && index !== targetIndex) {
        const delta = targetIndex - index;
        reverting = true;
        window.history.go(-delta);
        confirmNavigation(() => {
          approved = true;
          window.history.go(delta);
        });
        return;
      }
      approved = false;
      index = targetIndex;
      pendingScroll.current = window.history.state?.radarScroll || 0;
      setRoute(read());
      requestAnimationFrame(() =>
        window.scrollTo(0, window.history.state?.radarScroll || 0),
      );
    };
    const moved = () => {
      index = window.history.state?.radarIndex || 0;
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("radar:moved", moved);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("radar:moved", moved);
    };
  }, []);
  const navigate: Navigate = (next, replace = false) => {
    const current = read(),
      resolved = typeof next === "function" ? next(current) : next;
    const url = routePath(resolved);
    if (url === window.location.pathname + window.location.search) return;
    confirmNavigation(() => {
      const top =
        current.editor &&
        current.editor === resolved.editor &&
        current.step === resolved.step &&
        current.searchId === resolved.searchId
          ? window.scrollY
          : 0;
      window.history.replaceState(
        { ...window.history.state, radarScroll: window.scrollY },
        "",
      );
      window.history[replace ? "replaceState" : "pushState"](
        {
          radar: true,
          radarScroll: top,
          radarIndex:
            (window.history.state?.radarIndex || 0) + (replace ? 0 : 1),
        },
        "",
        url,
      );
      window.dispatchEvent(new Event("radar:moved"));
      pendingScroll.current = top;
      setRoute(resolved);
      requestAnimationFrame(() => {
        window.scrollTo(0, top);
        if (!top)
          document
            .querySelector<HTMLElement>("main h1")
            ?.focus({ preventScroll: true });
      });
    });
  };
  return { route, navigate, restoreScroll };
}
