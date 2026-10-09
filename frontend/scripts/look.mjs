// Quick visual check: node scripts/look.mjs <path> <theme> <width> <height> <out> [full]
import { chromium } from "@playwright/test";
const [path = "/", theme = "light", w = "1920", h = "1080", out = "look.png", full] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
await page.addInitScript(([t]) => {
  sessionStorage.setItem("outbreak-watch-session", JSON.stringify({ demoKey: "watch-demo", officerName: "Asha Rao" }));
  localStorage.setItem("outbreak-watch-theme", t);
}, [theme]);
await page.goto(`http://localhost:5173${path}`);
await page.waitForTimeout(6000);
await page.screenshot({ path: out, fullPage: full === "full" });
await browser.close();
console.log("wrote", out);
