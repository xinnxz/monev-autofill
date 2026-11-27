import fs from "node:fs";
import path from "node:path";
import { collect, isEmpty } from "./collect.js";
import { compose, LogbookSchema, type Logbook } from "./compose.js";
import { config, todayWib, weekday } from "./config.js";
import { notify } from "./notify.js";
import { dayOffReply } from "./telegram.js";
import { fillForm, monevUrl, openBrowser, waitUntilClosed } from "./portal.js";

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

main().catch(async (err) => {
  console.error(err);
  await notify(`❗ Monev ${date}: agent gagal`, `${err instanceof Error ? err.message : err}\nIsi manual: ${monevUrl(date)}`)
    .catch(() => {});
  process.exitCode = 1;
});
