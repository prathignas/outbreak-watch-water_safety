import { expect, test, type Page } from "@playwright/test";
import { preEnter } from "./helpers";

/* Layout check: every page, light and dark, at the screens people use. Prints PASS/FAIL per check
 * and saves screenshots to e2e/screens/ (git-ignored). Run: npx playwright test e2e/layout.spec.ts */

type Size = { name: string; width: number; height: number; scale?: number };
const SIZES: Size[] = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1536x864", width: 1536, height: 864 },
  { name: "1600x900", width: 1600, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "3840x2160", width: 3840, height: 2160 },
  { name: "1366x768@1.25", width: 1366, height: 768, scale: 1.25 },
  { name: "1366x768@1.5", width: 1366, height: 768, scale: 1.5 },
  { name: "1536x864@1.25", width: 1536, height: 864, scale: 1.25 },
  { name: "1536x864@1.5", width: 1536, height: 864, scale: 1.5 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
];
const THEMES = ["light", "dark"] as const;
const PAGES = ["home", "map", "alert", "proof", "data", "report", "demo"] as const;
const DIR = process.env.SHOTS_DIR ?? "e2e/screens";

interface Measure {
  sidebarScrolls: boolean;
  sidebarHidden: string[];
  hScroll: boolean;
  pageVScroll: boolean;
  mainVScroll: boolean;
  outside: string[];
  clipped: string[];
  overlaps: string[];
  columns: { sideBySide: boolean } | null;
  centred: { ok: boolean; detail: string };
}

/** Everything is measured in the browser, from the rendered boxes. */
async function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const label = (el: Element) => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${text ? ` "${text}"` : ""}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && !el.closest(".sr-only, [aria-hidden=true] .sr-only");
    };

    const nav = document.querySelector<HTMLElement>("nav[aria-label=Main]:not(.fixed)");
    const navShown = !!nav && getComputedStyle(nav).display !== "none";
    const sidebarHidden: string[] = [];
    if (navShown) {
      for (const el of nav!.querySelectorAll("a, button")) {
        const r = el.getBoundingClientRect();
        if (r.top < -0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.right > vw + 0.5) sidebarHidden.push(label(el));
      }
    }
    const scroller = document.querySelector<HTMLElement>("[data-scroller]");
    const wrapper = document.querySelector<HTMLElement>("[data-content]");

    // Anything on screen that pokes out of the viewport sideways (vertical overflow is what the scroller is for).
    const outside: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.closest(".maplibregl-map, svg, [data-radix-popper-content-wrapper]")) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) outside.push(label(el));
    }

    // Text cut off: a box that clips its own text.
    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, a, button, span, label, dd, dt, td, th")) {
      if (!visible(el) || el.closest(".maplibregl-map, svg, .sr-only")) continue;
      const s = getComputedStyle(el);
      const clipsX = s.overflowX !== "visible" || s.textOverflow === "ellipsis";
      const clipsY = s.overflowY !== "visible";
      if ((clipsX && el.scrollWidth > el.clientWidth + 1) || (clipsY && el.scrollHeight > el.clientHeight + 1 && s.overflowY !== "auto" && s.overflowY !== "scroll")) {
        clipped.push(label(el));
      }
    }
    // Cards (and their direct contents) overflowing a card that clips.
    for (const card of document.querySelectorAll<HTMLElement>("section.edge")) {
      if (!visible(card)) continue;
      const s = getComputedStyle(card);
      if (s.overflowY === "hidden" && card.scrollHeight > card.clientHeight + 1) clipped.push(`card ${label(card.querySelector("h1,h2,h3") ?? card)}`);
    }

    // Overlap: top-level cards on the page must not cover each other.
    const cards = [...document.querySelectorAll<HTMLElement>("main section.edge")].filter((c) => visible(c) && !c.parentElement?.closest("section.edge"));
    const overlaps: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 2 && h > 2) overlaps.push(`${label(cards[i].querySelector("h2,h3") ?? cards[i])} / ${label(cards[j].querySelector("h2,h3") ?? cards[j])}`);
      }
    }

    // Alerts: list and detail side by side from 1280 px.
    const list = document.querySelector("section[aria-label^='Alert list']");
    const detail = document.querySelector("#detail-h")?.closest("section");
    const columns = list && detail && visible(list) && visible(detail)
      ? { sideBySide: detail.getBoundingClientRect().left >= list.getBoundingClientRect().right - 1 && Math.abs(detail.getBoundingClientRect().top - list.getBoundingClientRect().top) < root * 2 }
      : null;

    // Content centred in the scroll area and never wider than its rem cap.
    let centred = { ok: true, detail: "" };
    if (wrapper && scroller) {
      const parent = wrapper.parentElement!;
      const ps = getComputedStyle(parent);
      const pr = parent.getBoundingClientRect(), wr = wrapper.getBoundingClientRect();
      const left = wr.left - (pr.left + parseFloat(ps.paddingLeft));
      const right = pr.right - parseFloat(ps.paddingRight) - (wr.right - (scroller.offsetWidth - scroller.clientWidth));
      const cap = parseFloat(getComputedStyle(wrapper).maxWidth);
      centred = { ok: Math.abs(left - right) <= 2 + (scroller.offsetWidth - scroller.clientWidth) && wr.width <= cap + 1, detail: `left ${left.toFixed(0)} right ${right.toFixed(0)} width ${wr.width.toFixed(0)}/${cap.toFixed(0)}` };
    }

    return {
      sidebarScrolls: navShown ? nav!.scrollHeight > nav!.clientHeight + 1 || getComputedStyle(nav!).overflowY !== "hidden" : false,
      sidebarHidden,
      hScroll: document.documentElement.scrollWidth > vw + 1 || (!!scroller && scroller.scrollWidth > scroller.clientWidth + 1),
      pageVScroll: document.documentElement.scrollHeight > vh + 1,
      mainVScroll: !!scroller && scroller.scrollHeight > scroller.clientHeight + 1,
      outside: outside.slice(0, 5),
      clipped: clipped.slice(0, 5),
      overlaps: overlaps.slice(0, 5),
      columns,
      centred,
    };
  });
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

async function open(page: Page, which: (typeof PAGES)[number], alertPath: string) {
  if (which === "demo") {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "City water health today" })).toBeVisible();
    await page.keyboard.press("Shift+D");
    await expect(page.getByRole("dialog", { name: "Demo controls" })).toBeVisible();
  } else {
    await page.goto({ home: "/", map: "/map", alert: alertPath, proof: "/proof", data: "/data", report: "/report" }[which]);
    await expect(page.locator("main h1").first()).toBeVisible();
  }
  await settle(page);
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.name} ${theme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale ?? 1 });

      test("layout", async ({ page }) => {
        await preEnter(page, theme);
        await page.goto("/alerts");
        const first = page.locator('a[href^="/alerts/"]').first();
        await expect(first).toBeVisible({ timeout: 40_000 });
        const alertPath = (await first.getAttribute("href"))!;

        const desktop = size.width >= 768;
        for (const which of PAGES) {
          await open(page, which, alertPath);
          await page.screenshot({ path: `${DIR}/${which}-${size.name}-${theme}.png` });
          const m = await measure(page);
          const checks: Array<[string, boolean, string?]> = [
            ["sidebar does not scroll", !desktop || !m.sidebarScrolls],
            ["sidebar buttons + logo fully visible", m.sidebarHidden.length === 0, m.sidebarHidden.join(", ")],
            ["no horizontal scroll", !m.hScroll],
            ["no page (body) scroll", !m.pageVScroll],
            ["nothing outside the viewport", m.outside.length === 0, m.outside.join(", ")],
            ["no text cut off", m.clipped.length === 0, m.clipped.join(", ")],
            ["no overlapping cards", m.overlaps.length === 0, m.overlaps.join(", ")],
            ["content centred, width capped", m.centred.ok, m.centred.detail],
          ];
          if (which === "home" && size.width >= 1366 && size.height >= 768) checks.push(["Home fits one screen", !m.mainVScroll && !m.pageVScroll]);
          if (which === "alert" && size.width >= 1280) checks.push(["alert columns side by side", !!m.columns?.sideBySide]);
          for (const [name, ok, detail] of checks) {
            console.log(`${ok ? "PASS" : "FAIL"}  ${size.name} ${theme} ${which}: ${name}${!ok && detail ? ` (${detail})` : ""}`);
            expect.soft(ok, `${size.name} ${theme} ${which}: ${name} ${detail ?? ""}`).toBe(true);
          }
        }
      });
    });
  }
}
