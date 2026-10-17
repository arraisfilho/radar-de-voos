import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import messages from "./src/messages.json";
// Baseline: Safari/iOS 15.4+, Chrome/Edge/Android WebView 100+, Firefox 100+.
const browsers = ["es2020", "chrome100", "edge100", "firefox100", "safari15.4", "ios15.4"];
// virtual:messages/en and /es: {Portuguese text: translation}, one chunk per
// language that i18n.ts downloads on demand. messages.json stays the only source.
const translations = messages as Record<string, Record<"en" | "es", string>>;
const messageCatalogs: Plugin = {
  name: "radar-message-catalogs",
  resolveId(id) {
    if (id === "virtual:messages/en" || id === "virtual:messages/es") return "\0" + id;
  },
  load(id) {
    const language = /^\0virtual:messages\/(en|es)$/.exec(id)?.[1] as "en" | "es" | undefined;
    if (!language) return;
    const catalog = Object.fromEntries(Object.entries(translations).map(([key, text]) => [key, text[language]]));
    // A string literal parses faster than the same object literal.
    return `export default JSON.parse(${JSON.stringify(JSON.stringify(catalog))});`;
  },
};
export default defineConfig({
  plugins: [react(), messageCatalogs],
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
  build: {
    target: browsers,
    cssTarget: browsers,
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: { phone: ["libphonenumber-js"] } },
    },
  },
});
