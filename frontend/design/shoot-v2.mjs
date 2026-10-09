import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync(new URL("./mockups-v2/", import.meta.url), { recursive: true });
const browser = await chromium.launch();
const shots = [["home", "light", 1920, 1080, false], ["home", "dark", 1920, 1080, false], ["alerts", "light", 1920, 1080, false], ["alerts", "dark", 1920, 1080, false],
  ["home", "light", 390, 844, true], ["home", "dark", 390, 844, true], ["home", "light", 390, 844, "full"]];
for (const [screen, theme, w, h, phone] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1 });
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(new URL(`./mockups-v2.html?screen=${screen}&theme=${theme}${phone ? "&phone=1" : ""}${phone === "full" ? "&full=1" : ""}`, import.meta.url).href);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const out = new URL(`./mockups-v2/${screen}-${theme}${phone === "full" ? "-phone-full" : phone ? "-phone" : ""}.png`, import.meta.url).pathname;
  await page.screenshot({ path: out, fullPage: screen === "alerts" || phone === "full" });
  console.log("wrote", out);
  await page.close();
}
await browser.close();
