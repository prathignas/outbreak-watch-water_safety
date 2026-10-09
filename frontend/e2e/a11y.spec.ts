import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openDemo, preEnter } from "./helpers";

async function audit(page: Page, label: string) {
  // Entrance animations fade in from opacity 0; measured mid-fade, text contrast reads too low.
  // Looping animations (pulses) never finish, so only the finite ones are waited for.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity)
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The map tiles are a canvas drawn by MapLibre; the ward list beside the map is the accessible alternative.
    .exclude(".maplibregl-canvas")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(serious, `${label}\n${report}`).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => preEnter(page, theme));

    test("home", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText(/of wards calm/).first()).toBeVisible();
      await audit(page, "home");
    });
    test("map", async ({ page }) => {
      await page.goto("/map");
      await expect(page.locator(".maplibregl-canvas")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Wards on alert or watch" })).toBeVisible();
      await page.waitForTimeout(1500);
      await audit(page, "map");
    });
    test("alerts list and detail", async ({ page }) => {
      await page.goto("/alerts");
      const first = page.getByRole("region", { name: "Alert list, newest first" }).getByRole("link").first();
      await expect(first).toBeVisible();
      await audit(page, "alerts list");
      await first.click();
      await expect(page.getByRole("heading", { name: "Why the detector alerted" })).toBeVisible();
      await expect(page.getByRole("img", { name: /Complaints, last 8 weeks/ })).toBeVisible();
      await audit(page, "alert detail");
      await page.getByRole("button", { name: "Add note" }).click();
      await audit(page, "note dialog");
    });
    test("proof", async ({ page }) => {
      await page.goto("/proof");
      await expect(page.getByRole("heading", { name: "Where fusion does not help", exact: false })).toBeVisible();
      await audit(page, "proof");
    });
    test("data", async ({ page }) => {
      await page.goto("/data");
      await expect(page.getByRole("heading", { name: "What is real and what is simulated" })).toBeVisible();
      await audit(page, "data");
    });
    test("404 and demo panel", async ({ page }) => {
      await page.goto("/no-such-page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await audit(page, "404");
      await openDemo(page);
      await audit(page, "demo panel");
    });
  });
}

