import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Baseline: Safari/iOS 15.4+, Chrome/Edge/Android WebView 100+, Firefox 100+.
const browsers = ["es2020", "chrome100", "edge100", "firefox100", "safari15.4", "ios15.4"];
export default defineConfig({
  plugins: [react()],
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
