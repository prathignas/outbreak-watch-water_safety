import { expect, type Page } from "@playwright/test";

export const DEMO_KEY = "watch-demo";

/** Opens the app. There is no login page: the demo key comes from the build. */
export async function enter(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "City water health today" })).toBeVisible();
}

/** Sets the session and theme before load (for page-by-page checks). */
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
