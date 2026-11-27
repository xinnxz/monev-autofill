import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { config } from "./config.js";
import type { Logbook } from "./compose.js";
import type { Coords } from "./location.js";

/**
 * Batas tegas agent ini: mengisi Kehadiran dan tiga kolom teks, lalu BERHENTI.
 * Lokasi, checkbox pernyataan, dan tombol submit selalu dilakukan oleh peserta sendiri.
 */

const FIELDS: { key: keyof Logbook; label: string; order: number }[] = [
  { key: "uraian_aktivitas", label: "Uraian aktivitas", order: 0 },
  { key: "pembelajaran", label: "Pembelajaran yang diperoleh", order: 1 },
  { key: "kendala", label: "Kendala yang dialami", order: 2 },
];

export const monevUrl = (date: string) => config.monevUrl.replace("{date}", date);

export async function openBrowser(opts: { headless?: boolean; coords?: Coords } = {}): Promise<BrowserContext> {
  const origin = new URL(config.monevUrl.replace("{date}", "x")).origin;
  return chromium.launchPersistentContext(config.profileDir, {
    channel: config.browserChannel === "chromium" ? undefined : config.browserChannel,
    headless: opts.headless ?? false,
    viewport: opts.headless ? { width: 1280, height: 900 } : null,
    args: opts.headless ? [] : ["--start-maximized"],
    // Lokasi asli dari perangkat (Windows Location), diberikan hanya ke portal monev.
    ...(opts.coords ? {
      geolocation: { latitude: opts.coords.latitude, longitude: opts.coords.longitude, accuracy: opts.coords.accuracy },
      permissions: [],
    } : {}),
  }).then(async (ctx) => {
    if (opts.coords) await ctx.grantPermissions(["geolocation"], { origin });
    return ctx;
  });
}

export type SubmitResult = { ok: boolean; status: string; screenshot?: string };

/**
 * Setelah fillForm: tambahkan lokasi, centang pernyataan, lalu Simpan dan Kirim.
 * Dipanggil HANYA setelah peserta mengonfirmasi isi (y) di terminal.
 * dry = semua langkah kecuali menekan tombol kirim, plus screenshot untuk dicek.
 */
export async function submitForm(page: Page, date: string, shotPath: string, dry = false): Promise<SubmitResult> {
  const addLoc = page.getByText(/tambahkan lokasi/i).first();
  if (await addLoc.count()) {
    await addLoc.click();
    await page.waitForTimeout(4000);
  }
  const statement = page.getByLabel(/menyatakan telah meninjau/i).first();
  if (!(await statement.isChecked().catch(() => false))) await statement.check();

  await page.screenshot({ path: shotPath, fullPage: true });
  const sendBtn = page.getByRole("button", { name: /simpan dan kirim/i });
  if (dry) {
    return { ok: await sendBtn.isEnabled(), status: `dry-run (tombol kirim ${await sendBtn.isEnabled() ? "aktif" : "nonaktif"})`, screenshot: shotPath };
  }

  await sendBtn.click();
  // Tunggu portal memproses lalu baca status dari kalender.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);
  await page.goto(monevUrl(date).replace("view=edit", "view=detail"), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const status = await dayStatus(page, date);
  await page.screenshot({ path: shotPath, fullPage: true });
  return { ok: /menunggu|disetujui/i.test(status), status: status || "tidak terbaca", screenshot: shotPath };
}

/** Cari textarea lewat label; kalau markup berubah, jatuh ke urutan textarea di halaman. */
async function field(page: Page, label: string, order: number): Promise<Locator> {
  const byLabel = page.getByLabel(label, { exact: false }).first();
  if (await byLabel.count()) return byLabel;
  return page.locator("textarea:visible").nth(order);
}

export type FillResult = "filled" | "already-filled" | "holiday" | "login-required" | "form-not-found";

/** "2026-11-27" → "27 November 2026", format tombol kalender portal. */
const portalDate = (date: string) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })
    .format(new Date(`${date}T12:00:00+07:00`));

/** Status hari dari kalender portal, misal "Belum Diisi", "Menunggu Persetujuan", "Jadwal libur posisi". */
async function dayStatus(page: Page, date: string): Promise<string> {
  const label = await page.locator(`button[aria-label*=", ${portalDate(date)}, "]`).first()
    .getAttribute("aria-label", { timeout: 5_000 }).catch(() => null);
  return label?.split(", ").slice(2).join(", ") ?? "";
}

export async function fillForm(page: Page, date: string, log: Logbook): Promise<FillResult> {
  await page.goto(monevUrl(date), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const textareas = page.locator("textarea:visible");
  try {
    await textareas.first().waitFor({ timeout: 20_000 });
  } catch {
    const looksLikeLogin =
      /login|masuk|auth|sso/i.test(page.url()) || (await page.locator("input[type=password]").count()) > 0;
    if (looksLikeLogin) return "login-required";
    // Laporan yang sudah dikirim dialihkan portal ke tampilan detail.
    if (page.url().includes("view=detail")) return "already-filled";
    if (/libur/i.test(await dayStatus(page, date))) return "holiday";
    return "form-not-found";
  }
  if (/libur/i.test(await dayStatus(page, date))) return "holiday";

  // Jangan menimpa laporan yang sudah ada isinya.
  const first = await field(page, FIELDS[0].label, 0);
  if ((await first.inputValue()).trim().length > 0) return "already-filled";

  await ensureHadir(page);
  for (const f of FIELDS) {
    const loc = await field(page, f.label, f.order);
    await loc.fill(log[f.key]);
  }
  return "filled";
}

async function ensureHadir(page: Page): Promise<void> {
  // Kehadiran adalah dropdown (div[role=combobox]) dengan nilai default "Hadir".
  const combo = page.locator("[role=combobox]").filter({ hasText: /\S/ }).first();
  if (!(await combo.count())) return;
  const current = (await combo.innerText().catch(() => "")).trim();
  if (/^hadir$/i.test(current)) return;
  await combo.click();
  await page.getByRole("option", { name: "Hadir", exact: true }).click();
}

/** Tunggu sampai peserta menutup jendela (atau batas waktu), supaya proses tidak menutup form yang sedang ditinjau. */
export async function waitUntilClosed(ctx: BrowserContext, maxMinutes = 90): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => ctx.on("close", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, maxMinutes * 60_000)),
  ]);
}
