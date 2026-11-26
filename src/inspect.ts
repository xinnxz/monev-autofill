import { monevUrl, openBrowser } from "./portal.js";
import { todayWib } from "./config.js";

// Baca-saja: daftar field form beserta labelnya, untuk memastikan selector cocok.
const ctx = await openBrowser();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(monevUrl(process.argv[2] ?? todayWib()));
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(3000);

const fields = await page.evaluate(() =>
  [...document.querySelectorAll("input, textarea, select, [role=combobox], button")].map((el) => {
    const e = el as HTMLInputElement;
    const label =
      (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) ||
      e.getAttribute("aria-label") ||
      (e.getAttribute("aria-labelledby") &&
        document.getElementById(e.getAttribute("aria-labelledby")!)?.textContent) ||
      e.placeholder || e.textContent?.trim().slice(0, 40) || "";
    return { tag: el.tagName.toLowerCase(), type: e.type, name: e.name, label, visible: !!e.offsetParent };
  }).filter((f) => f.visible),
);
console.log(`URL: ${page.url()}`);
console.table(fields);
await ctx.close();
