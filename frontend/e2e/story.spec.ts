import { expect, test } from "@playwright/test";
import { enter, openDemo } from "./helpers";

test("full story: enter, inject a water outbreak, see it, read it, acknowledge, resolve, reset", async ({ page }) => {
  await enter(page);
  await expect(page.getByRole("note").filter({ hasText: "Health signals are simulated" })).toBeVisible();

  // Nothing in water zone NW3 before the injection.
  await page.getByRole("link", { name: "Alerts" }).first().click();
  const list = page.getByRole("region", { name: "Alert list, newest first" });
  await expect(list.getByRole("link").first()).toBeVisible();
  await expect(list.getByRole("link", { name: /zone NW3/ })).toHaveCount(0);

  // Inject a water outbreak in ward 18 (Bagalakunte, water zone NW3).
  await openDemo(page);
  const dialog = page.getByRole("dialog", { name: "Demo controls" });
  await dialog.getByRole("button", { name: "Water" }).click();
  await dialog.getByRole("combobox", { name: "Ward" }).click();
  await page.getByRole("option", { name: "Bagalakunte (ward 18)" }).click();
  await dialog.getByRole("button", { name: "Inject outbreak" }).click();
  await expect(dialog.getByRole("status")).toContainText("Water outbreak placed in Bagalakunte");
  await page.keyboard.press("Escape");

  // The alert appears in the queue after the short delay.
  const fresh = list.getByRole("link", { name: /zone NW3/ }).first();
  await expect(fresh).toBeVisible({ timeout: 30_000 });
  const wardName = (await fresh.locator("span.block.truncate").textContent())!.trim();

  // ...and on the map: in the alert list beside the map, and drawn on the map canvas.
  await page.getByRole("link", { name: "Map" }).first().click();
  await expect(page.getByRole("region", { name: /Map of 243 wards/ })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const mapList = page.getByRole("region", { name: "Wards on alert or watch" }).or(page.locator("section[aria-labelledby=list-h]"));
  await expect(mapList.getByRole("button", { name: new RegExp(`${wardName}.*Alert`) })).toBeVisible();
  await mapList.getByRole("button", { name: new RegExp(wardName) }).click();
  await page.getByRole("link", { name: "Open its alert" }).click();

  // Read the evidence.
  await expect(page.getByRole("heading", { level: 2, name: wardName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why the detector alerted" })).toBeVisible();
  await expect(page.locator("section[aria-labelledby=ev-h] li").first()).toContainText("normal for a");
  await expect(page.getByText("Triage hint, not a diagnosis")).toBeVisible();
  await expect(page.getByText(/suspected zone NW3/)).toBeVisible();

  // Acknowledge, add a note, resolve.
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Acknowledged" })).toBeVisible();
  await expect(page.getByText("Acknowledged by E2E Officer")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Note", { exact: true }).fill("Asked BWSSB to check the NW3 supply line.");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Asked BWSSB to check the NW3 supply line.")).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByText("Resolved by E2E Officer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();

  // Reset: the injected outbreak and its alert are gone.
  await openDemo(page);
  await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Demo reset");
  await page.keyboard.press("Escape");
  await page.goto("/alerts");
  await expect(page.getByRole("region", { name: "Alert list, newest first" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Alert list, newest first" }).getByRole("link", { name: /zone NW3/ })).toHaveCount(0);
});

test("fast-forward moves the demo clock one day", async ({ page }) => {
  await enter(page);
  await expect(page.getByText("Wed, 8 Jul 2026")).toBeVisible();
  await openDemo(page);
  await page.getByRole("dialog").getByRole("button", { name: "Fast-forward a day" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Moved to 9 Jul");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Thu, 9 Jul 2026")).toBeVisible();
  await openDemo(page);
  await page.getByRole("dialog").getByRole("button", { name: "Reset" }).click();
});
