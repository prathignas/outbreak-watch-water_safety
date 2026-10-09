import { expect, test, type Page } from "@playwright/test";
import { preEnter } from "./helpers";

/* Mock mode follows the real current day in India (Asia/Kolkata), not the machine's timezone.
 * Run against a mock-mode dev server: E2E_MODE=mock. */
test.skip(process.env.E2E_MODE !== "mock", "mock mode only (the mock's demo clock)");
test.use({ timezoneId: "America/Los_Angeles" });

const fmtShort = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const daysBack = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

async function newestAlertDay(page: Page) {
  await page.goto("/alerts");
  const first = page.locator('a[href^="/alerts/"]').first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  return (await first.innerText()).replace(/\s+/g, " ");
}

for (const c of [
  // 20:00 UTC = 13:00 in Los Angeles on 9 Oct, but already 01:30 on 10 Oct in India.
  { name: "LA evening is the next day in India", at: "2026-10-09T20:00:00Z", ist: "2026-10-10", shown: "Sat, 10 Oct 2026" },
  { name: "another day entirely", at: "2026-12-25T06:00:00Z", ist: "2026-12-25", shown: "Fri, 25 Dec 2026" },
]) {
  test(`top bar and data follow the IST day: ${c.name}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(c.at));
    await preEnter(page);
    await page.goto("/");
    await expect(page.getByText(c.shown)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "City water health today" })).toBeVisible();
    // Alerts end at the IST day: the newest alert is dated within the last week, never in the future.
    const text = await newestAlertDay(page);
    const recent = Array.from({ length: 8 }, (_, i) => fmtShort(daysBack(c.ist, i)));
    expect(recent.some((d) => text.includes(d)), `newest alert "${text}" should be dated in ${recent.join(", ")}`).toBe(true);
  });
}

test("past midnight IST the open tab moves to the new day", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-09T18:29:00Z")); // 23:59 IST
  await preEnter(page);
  await page.goto("/");
  await expect(page.getByText("Fri, 9 Oct 2026")).toBeVisible({ timeout: 60_000 });
  await page.clock.setFixedTime(new Date("2026-10-09T18:31:00Z")); // 00:01 IST, 10 Oct
  await expect(page.getByText("Sat, 10 Oct 2026")).toBeVisible({ timeout: 30_000 }); // next 10 s poll
});
