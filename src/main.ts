import { execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { collect, isEmpty } from "./collect.js";
import { compose, LogbookSchema, type Logbook } from "./compose.js";
import { config, ROOT, todayWib, weekday } from "./config.js";
import { windowsLocation } from "./location.js";
import { notify } from "./notify.js";
import { dayOffReply } from "./telegram.js";
import { fillForm, monevUrl, openBrowser, submitForm, waitUntilClosed } from "./portal.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const dateIdx = args.indexOf("--date");
const date = dateIdx >= 0 && args[dateIdx + 1] ? args[dateIdx + 1] : todayWib();

/**
 * Mode --auto (dipicu Task Scheduler saat login, buka kunci, Wi-Fi tersambung, dan tiap 30 menit):
 * hanya jalan di jendela jam AUTO_START_HOUR–24.00 WIB, kalau ada internet, dan tidak mengganggu berulang:
 * form dibuka sekali; kalau belum dikirim, dibuka lagi paling cepat AUTO_REOPEN_HOURS kemudian.
 */
const auto = flag("--auto");
const markerPath = path.join(config.draftsDir, `${date}.status.json`);
type Marker = { result: string; at: number };

function readMarker(): Marker | null {
  try { return JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { return null; }
}
function writeMarker(result: string) {
  fs.mkdirSync(config.draftsDir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({ result, at: Date.now() }));
}

async function autoGate(): Promise<boolean> {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date()));
  const start = Number(process.env.AUTO_START_HOUR ?? 15);
  if (hour < start) { console.log(`[auto] ${hour}.00 < ${start}.00, belum waktunya.`); return false; }

  const m = readMarker();
  const reopenMs = Number(process.env.AUTO_REOPEN_HOURS ?? 2) * 3_600_000;
  if (m && ["submitted", "holiday", "off", "notified-empty"].includes(m.result)) {
    console.log(`[auto] hari ini sudah selesai (${m.result}).`); return false;
  }
  if (m && Date.now() - m.at < reopenMs) { console.log(`[auto] baru dijalankan, tunggu.`); return false; }

  try {
    await fetch("https://monev.maganghub.kemnaker.go.id", { method: "HEAD", signal: AbortSignal.timeout(8000) });
  } catch {
    console.log("[auto] belum ada internet, coba lagi di pemicu berikutnya."); return false;
  }
  return true;
}

async function main() {
  if (auto && !(await autoGate())) return;

  if (flag("--test-notify")) {
    await notify("Tes monev-autofill", "Kalau pesan ini sampai, notifikasi sudah siap.");
    return;
  }

  // 1. Hari kerja saja; libur/izin/sakit dilewati.
  const wd = weekday(date);
  if ((wd === 0 || wd === 6) && !flag("--force")) return console.log(`${date} akhir pekan, dilewati.`);
  if (config.offDays.has(date)) {
    if (auto) writeMarker("off");
    await notify(`Monev ${date}: hari libur/izin`, "Agent tidak mengisi apa pun. Kalau sakit/izin, pilih statusnya sendiri di portal.");
    return;
  }

  // 2. Kumpulkan aktivitas asli.
  const activity = await collect(date);
  console.log(`Aktivitas ${date}: ${activity.commits.length} commit, ${activity.github.length} PR/review, ` +
    `${activity.notes.length} dokumen, ${activity.replies.length} balasan Telegram, ${activity.claude.length} pertanyaan Claude Code, ${activity.slack.length} pesan Slack, ` +
    `catatan manual ${activity.manual ? "ada" : "tidak ada"}.`);
  if (flag("--collect-only")) return console.log(JSON.stringify(activity, null, 2));

  const off = dayOffReply(activity.replies);
  if (off) {
    if (auto) writeMarker("off");
    await notify(`Monev ${date}: dicatat "${off}"`,
      `Agent tidak mengisi laporan hari ini. Jangan lupa pilih status Sakit/Izin dan lampirkan bukti di portal:\n${monevUrl(date)}`);
    return;
  }

  fs.mkdirSync(config.draftsDir, { recursive: true });
  const draftPath = path.join(config.draftsDir, `${date}.json`);
  // Mode auto selalu menyusun ulang supaya aktivitas yang lebih sore ikut masuk.
  const hasDraft = fs.existsSync(draftPath) && !flag("--redraft") && !auto;

  if (isEmpty(activity) && !hasDraft) {
    if (auto) {
      // Masih sore: mungkin nanti ada aktivitas. Peringatan dikirim sekali, mulai jam 21.00.
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(new Date()));
      if (hour < 21) return console.log("[auto] belum ada aktivitas, cek lagi nanti.");
      writeMarker("notified-empty");
    }
    await notify(`⚠️ Monev ${date} belum terisi`,
      `Tidak ada aktivitas tercatat (GitHub, dokumen, Slack, balasan Telegram). Agent tidak mengarang isi.\n` +
      `Balas bot ini dengan kegiatanmu hari ini lalu jalankan "npm start" di laptop, atau isi langsung:\n${monevUrl(date)}`);
    return;
  }

  // 3. Susun draf (dipakai ulang kalau sudah ada untuk tanggal ini, termasuk yang kamu tulis sendiri).
  let log: Logbook;
  if (hasDraft) {
    log = LogbookSchema.parse(JSON.parse(fs.readFileSync(draftPath, "utf8")));
  } else {
    log = await compose(activity);
    fs.writeFileSync(draftPath, JSON.stringify(log, null, 2));
  }
  const preview =
    `URAIAN AKTIVITAS\n${log.uraian_aktivitas}\n\nPEMBELAJARAN\n${log.pembelajaran}\n\nKENDALA\n${log.kendala}`;
  if (flag("--draft-only")) return console.log(preview);

  if (flag("--confirm")) return confirmAndSubmit(log, draftPath);

  // 4. Isi form di Chrome, lalu serahkan ke peserta.
  const ctx = await openBrowser();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const result = await fillForm(page, date, log);
  if (auto) writeMarker(result === "already-filled" ? "submitted" : result);

  switch (result) {
    case "filled":
      await notify(`📝 Monev ${date} siap ditinjau`,
        `Form sudah terisi di Chrome laptop. Sisa langkahmu: cek isi → "Tambahkan lokasi" → centang pernyataan → Kirim.\n\n` +
        `Kalau sedang tidak di laptop, salin teks ini ke portal:\n${monevUrl(date)}\n\n${preview}`);
      await waitUntilClosed(ctx);
      break;
    case "already-filled":
      console.log("Laporan tanggal ini sudah ada isinya, tidak ditimpa.");
      await ctx.close();
      break;
    case "holiday":
      console.log("Portal menandai tanggal ini sebagai jadwal libur, dilewati.");
      await ctx.close();
      break;
    case "login-required":
      await notify(`🔑 Monev ${date}: sesi login habis`,
        `Jalankan "npm run login" di laptop, lalu "npm start". Atau isi manual dengan teks ini:\n${monevUrl(date)}\n\n${preview}`);
      await waitUntilClosed(ctx, 30);
      break;
    case "form-not-found":
      await notify(`❗ Monev ${date}: form tidak ditemukan`,
        `Tampilan portal mungkin berubah. Jalankan "npm run inspect". Teks siap salin:\n${monevUrl(date)}\n\n${preview}`);
      await waitUntilClosed(ctx, 30);
      break;
  }
}

/** Tampilkan draf + lokasi, minta konfirmasi y/n/e, lalu kirim tanpa jendela Chrome. */
async function confirmAndSubmit(initial: Logbook, draftPath: string): Promise<void> {
  let log = initial;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, (a) => r(a.trim().toLowerCase())));

  console.log("\nMengambil lokasi dari Windows...");
  const coords = windowsLocation();
  if (!coords) {
    rl.close();
    console.log("❌ Lokasi tidak tersedia. Aktifkan Settings → Privacy & security → Location " +
      "(termasuk 'Let desktop apps access your location'), lalu jalankan lagi.");
    if (auto) writeMarker("no-location");
    return;
  }

  for (;;) {
    console.log(`\n══════ Monev ${date} ══════\n`);
    console.log(`URAIAN AKTIVITAS\n${log.uraian_aktivitas}\n\nPEMBELAJARAN\n${log.pembelajaran}\n\nKENDALA\n${log.kendala}\n`);
    console.log(`Lokasi: ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)} (±${coords.accuracy} m)`);
    const a = await ask(`\nKirim laporan ini${flag("--dry") ? " (DRY-RUN, tidak benar-benar dikirim)" : ""}? [y = kirim / e = edit / n = batal] `);
    if (a === "e") {
      const txt = draftPath.replace(/\.json$/, ".txt");
      fs.writeFileSync(txt, `## URAIAN AKTIVITAS\n${log.uraian_aktivitas}\n\n## PEMBELAJARAN\n${log.pembelajaran}\n\n## KENDALA\n${log.kendala}\n`);
      console.log("Edit di Notepad, simpan, lalu tutup Notepad...");
      execFileSync("notepad.exe", [txt]);
      const parts = fs.readFileSync(txt, "utf8").split(/^## .+$/m).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 3) {
        log = { uraian_aktivitas: parts[0], pembelajaran: parts[1], kendala: parts[2] };
        fs.writeFileSync(draftPath, JSON.stringify(log, null, 2));
      } else console.log("Format berubah (harus ada 3 judul ##), perubahan diabaikan.");
      const short = Object.entries(log).filter(([, v]) => v.length < 100).map(([k]) => k);
      if (short.length) console.log(`⚠️ Kurang dari 100 karakter: ${short.join(", ")}`);
      continue;
    }
    if (a !== "y") {
      rl.close();
      console.log("Dibatalkan. Tidak ada yang dikirim.");
      if (auto) writeMarker("declined");
      return;
    }
    if (Object.values(log).some((v) => v.length < 100)) { console.log("Ada kolom < 100 karakter, edit dulu (e)."); continue; }
    break;
  }
  rl.close();

  console.log("Mengirim di latar belakang...");
  const ctx = await openBrowser({ headless: true, coords });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const filled = await fillForm(page, date, log);
    if (filled !== "filled") {
      const msg: Record<string, string> = {
        "already-filled": "Laporan tanggal ini sudah terkirim sebelumnya.",
        holiday: "Portal menandai tanggal ini sebagai jadwal libur.",
        "login-required": 'Sesi login habis. Jalankan "npm run login", lalu ulangi.',
        "form-not-found": 'Form tidak ditemukan. Jalankan "npm run inspect".',
      };
      console.log(`ℹ️ ${msg[filled]}`);
      if (auto) writeMarker(filled === "already-filled" ? "submitted" : filled);
      return;
    }
    fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
    const shot = path.join(ROOT, "logs", `${date}${flag("--dry") ? "-dry" : ""}.png`);
    const res = await submitForm(page, date, shot, flag("--dry"));
    console.log(res.ok ? `✅ ${res.status}` : `❌ Belum berhasil: ${res.status}`);
    console.log(`Screenshot: ${res.screenshot}`);
    if (auto && res.ok && !flag("--dry")) writeMarker("submitted");
    if (res.ok && !flag("--dry")) await notify(`✅ Monev ${date} terkirim`, `Status portal: ${res.status}`);
  } finally {
    await ctx.close();
  }
}

main().catch(async (err) => {
  console.error(err);
  await notify(`❗ Monev ${date}: agent gagal`, `${err instanceof Error ? err.message : err}\nIsi manual: ${monevUrl(date)}`)
    .catch(() => {});
  process.exitCode = 1;
});
