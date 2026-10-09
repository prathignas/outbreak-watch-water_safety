import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync(new URL("./mockups/", import.meta.url), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const screen of ["overview", "detail"]) for (const theme of ["light", "dark"]) {
  await page.goto(new URL(`./mockups.html?screen=${screen}&theme=${theme}`, import.meta.url).href);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const out = new URL(`./mockups/${screen}-${theme}.png`, import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: screen === "detail" });
  console.log("wrote", out);
}
await browser.close();
