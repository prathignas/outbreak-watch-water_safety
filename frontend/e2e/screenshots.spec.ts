import { expect, test, type Page } from "@playwright/test";
import { DEMO_KEY, preEnter } from "./helpers";

/* Pixel check: every screen at 1920x1080 (light and dark) and 390x844 (phone). Writes e2e/screenshots/. */
const SIZES = [
  { name: "desktop-light", width: 1920, height: 1080, theme: "light" as const },
  { name: "desktop-dark", width: 1920, height: 1080, theme: "dark" as const },
  { name: "phone-light", width: 390, height: 844, theme: "light" as const },
];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}

async function injectWater(page: Page) {
  await page.evaluate(async (key) => {
    await fetch("/demo/inject", { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Auth": key, "X-Officer-Name": "Asha Rao" }, body: JSON.stringify({ cause: "water", wardId: 18 }) });
  }, DEMO_KEY);
  // Wait for the app's 10-second poll to pick the new alerts up.
  await page.waitForTimeout(11_000);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    const shot = (page: Page, screen: string, fullPage = false) =>
      page.screenshot({ path: `e2e/screenshots/${screen}-${size.name}.png`, fullPage });

    test("screens", async ({ page }) => {
      await preEnter(page, size.theme);
      await page.goto("/");
      await expect(page.getByText(/of wards calm/).first()).toBeVisible();
      await injectWater(page);
      await page.getByRole("link", { name: "Home" }).first().click();
      await settle(page);
      await shot(page, "home", size.width < 768);

      await page.getByRole("link", { name: "Map" }).first().click();
      await expect(page.locator(".maplibregl-canvas")).toBeVisible();
      await page.waitForTimeout(3000);
      await shot(page, "map", size.width < 768);

      await page.getByRole("link", { name: "Alerts" }).first().click();
      const nw3 = page.getByRole("region", { name: "Alert list, newest first" }).getByRole("link", { name: /zone NW3/ }).first();
      await expect(nw3).toBeVisible();
      await settle(page);
      await shot(page, "alerts", size.width < 768);
      await nw3.click();
      await expect(page.getByRole("heading", { name: "Why the detector alerted" })).toBeVisible();
      await settle(page);
      await shot(page, "alert-detail", true);

      await page.getByRole("link", { name: "Proof" }).first().click();
      await expect(page.getByRole("heading", { name: /Where fusion does not help/ })).toBeVisible();
      await settle(page);
      await shot(page, "proof", true);

      await page.getByRole("link", { name: "Data" }).first().click();
      await expect(page.getByRole("heading", { name: "What is real and what is simulated" })).toBeVisible();
      await settle(page);
      await shot(page, "data", true);

      await page.keyboard.press("Shift+D");
      await expect(page.getByRole("dialog", { name: "Demo controls" })).toBeVisible();
      await settle(page);
      await shot(page, "demo-panel");
      await page.keyboard.press("Escape");

      await page.goto("/missing-page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await settle(page);
      await shot(page, "404");
    });
  });
}
