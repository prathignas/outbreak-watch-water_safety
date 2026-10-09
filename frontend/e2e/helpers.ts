import { expect, type Page } from "@playwright/test";

export const DEMO_KEY = "watch-demo";

/** Enters through the gate like a person would. */
export async function enter(page: Page, name = "E2E Officer") {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter the demo" })).toBeVisible();
  await page.getByLabel("Demo key").fill(DEMO_KEY);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByRole("heading", { name: "City water health today" })).toBeVisible();
}

/** Skips the gate (for page-by-page checks). */
export async function preEnter(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript(([t, key]) => {
    sessionStorage.setItem("outbreak-watch-session", JSON.stringify({ demoKey: key, officerName: "Asha Rao" }));
    localStorage.setItem("outbreak-watch-theme", t);
  }, [theme, DEMO_KEY]);
}

export async function openDemo(page: Page) {
  await page.keyboard.press("Shift+D");
  await expect(page.getByRole("dialog", { name: "Demo controls" })).toBeVisible();
}
