import { expect, test } from "@playwright/test";
import { DEMO_KEY, enter, openDemo } from "./helpers";

/* Inject -> open alert -> acknowledge -> resolve -> add note, with no login page anywhere.
 * Runs against whichever mode the dev server is in (mock by default; real with VITE_API_MODE=real). */
test("demo flow works with no login page", async ({ page }) => {
  const unauthorized: string[] = [];
  page.on("response", (r) => { if (r.status() === 401) unauthorized.push(`${r.request().method()} ${r.url()}`); });
  const gate = page.getByRole("heading", { name: "Enter the demo" });
  await enter(page);

  await openDemo(page);
  const dialog = page.getByRole("dialog", { name: "Demo controls" });
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect(dialog.getByRole("status")).toContainText(/reset/i, { timeout: 60_000 });
  await dialog.getByRole("button", { name: "Inject outbreak" }).click();
  await expect(dialog.getByRole("status")).toContainText(/outbreak placed/i, { timeout: 60_000 });
  await page.keyboard.press("Escape");
  await expect(gate).toHaveCount(0);

  await page.goto("/alerts");
  const first = page.locator('a[href^="/alerts/"]').first();
  await expect(first).toBeVisible({ timeout: 40_000 });
  await first.click();
  await expect(page).toHaveURL(/\/alerts\/.+/);

  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(page.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("dialog", { name: "Add a note" }).getByRole("textbox").fill("Checked the tank");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Checked the tank").first()).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resolve", exact: true })).toBeDisabled();

  await page.reload();
  await expect(gate).toHaveCount(0);
  expect(unauthorized, "no 401 at any step").toEqual([]);
  expect(DEMO_KEY).toBeTruthy();
});

/* Regression: no error ever sends the officer to a login page. */
test("errors other than a refused key keep the officer on the page", async ({ page }) => {
  test.skip(process.env.E2E_MODE === "mock", "page.route cannot see requests the mock service worker answers");
  await enter(page);
  await page.goto("/alerts");
  const first = page.locator('a[href^="/alerts/"]').first();
  await expect(first).toBeVisible({ timeout: 40_000 });
  await first.click();
  const ack = page.getByRole("button", { name: "Acknowledge", exact: true });
  const gate = page.getByRole("heading", { name: "Enter the demo" });

  const failures: Array<{ status: number; body: string }> = [
    { status: 500, body: '{"message":"boom"}' },
    { status: 403, body: '{"message":"nope"}' },
    { status: 400, body: '{"message":"Enter your name","error":"OFFICER_NAME_REQUIRED"}' },
    { status: 401, body: '{"message":"Session expired somewhere else"}' },
  ];
  for (const f of failures) {
    await page.route("**/alerts/*/ack", (route) => route.fulfill({ status: f.status, contentType: "application/json", body: f.body }));
    await ack.click();
    await expect(page.getByRole("status").filter({ hasText: /\S/ }).last()).toBeVisible();
    await expect(gate).toHaveCount(0);
    await page.unroute("**/alerts/*/ack");
  }
  await page.route("**/alerts/*/ack", (route) => route.abort());
  await ack.click();
  await expect(gate).toHaveCount(0);
  await page.unroute("**/alerts/*/ack");

  // Even a refused key only shows a message; there is no login page.
  await page.route("**/alerts/*/ack", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"The demo key is missing or wrong.","error":"UNAUTHORIZED"}' }));
  await ack.click();
  await expect(page.getByText(/refused the demo key/)).toBeVisible();
  await expect(page).toHaveURL(/\/alerts\/.+/);
});
