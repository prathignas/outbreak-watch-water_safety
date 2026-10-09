import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { applyTheme, initialTheme } from "@/app/theme";
// Fonts are bundled with the app (no Google Fonts, no OS fallback), so Windows and Mac render the same text.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "./index.css";

async function boot() {
  applyTheme(initialTheme());
  // Mock mode: MSW answers every API route in the browser. Dead code in a real-mode build.
  if (import.meta.env.VITE_API_MODE !== "real") {
    const { startMockApi } = await import("@/mock/browser");
    await startMockApi();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
