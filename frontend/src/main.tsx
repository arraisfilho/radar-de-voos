import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "./style.css";
// Liquid Glass depois da base: só a camada de navegação. O CSS das páginas não redefine essas camadas.
import "./glass.css";
import { AuthGate } from "./Accounts";
import { ErrorBoundary } from "./ErrorBoundary";

// After a deploy, an open tab may ask for chunks that no longer exist. Reload
// once to pick up the new build; the timestamp stops a reload loop, and a
// repeated failure falls through to the error screen.
const RELOAD_KEY = "radar-chunk-reload";
const RELOAD_WINDOW = 10 * 60 * 1000;
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < RELOAD_WINDOW) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // Without storage there is no loop guard: show the error instead.
  }
  event.preventDefault();
  window.location.reload();
});

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary scope="root">
      <QueryClientProvider client={client}>
        <AuthGate />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
