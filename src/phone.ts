import { collect, isEmpty } from "./collect.js";
import { compose } from "./compose.js";
import { config, todayWib, weekday } from "./config.js";
import { monevUrl } from "./portal.js";
import { dayOffReply, sendTelegram, telegramReplies } from "./telegram.js";

/**
 * Mode HP (tanpa laptop, cocok untuk GitHub Actions):
 * susun isi dari aktivitas asli, lalu kirim ke Telegram sebagai 3 pesan siap salin + link form.
 * Kamu yang membuka link di HP, menempel, menambahkan lokasi, mencentang, dan mengirim.
 *
 *   tsx src/phone.ts            run utama (default 21.00 WIB)
 *   tsx src/phone.ts --late     run susulan (22.30 WIB): hanya jalan kalau kamu membalas bot setelah run utama
 *
 * Sengaja tidak mencetak isi laporan ke log, karena log GitHub Actions di repo publik bisa dilihat orang lain.
 */

const args = process.argv.slice(2);
const late = args.includes("--late");
const dateIdx = args.indexOf("--date");
const date = dateIdx >= 0 && args[dateIdx + 1] ? args[dateIdx + 1] : todayWib();
const MAIN_RUN_HOUR_WIB = Number(process.env.PHONE_MAIN_HOUR_WIB ?? 21);

async function main() {
  const wd = weekday(date);
  if (wd === 0 || wd === 6 || config.offDays.has(date)) return console.log("Hari libur, dilewati.");

  if (late) {
    // Hanya balasan yang masuk setelah run utama yang memicu draf ulang.
    const since = new Date(`${date}T${String(MAIN_RUN_HOUR_WIB).padStart(2, "0")}:00:00+07:00`);
    const fresh = await telegramReplies(date, since);
    if (!fresh.length) return console.log("Tidak ada balasan baru sejak run utama, selesai.");
  }

  const activity = await collect(date);
  console.log(`Sumber: ${activity.commits.length} commit, ${activity.github.length} PR/review, ` +
    `${activity.replies.length} balasan, ${activity.slack.length} Slack.`);

  const off = dayOffReply(activity.replies);
  if (off) {
    await sendTelegram(`Monev ${date}: kamu menulis "${off}", jadi tidak dibuatkan isi.\n` +
      `Pilih status Sakit/Izin dan lampirkan bukti di portal:\n${monevUrl(date)}`);
    return;
  }

  // Hari yang tipis (misal hanya satu merge, tanpa commit atau balasan) belum cukup untuk 3 kolom
  // tanpa mengarang. Minta cerita singkat dulu; run 22.30 menyusun isinya kalau kamu membalas.
  const thin = !activity.commits.length && !activity.replies.length && !activity.slack.length &&
    !activity.manual.trim() && activity.github.length <= 1;
  if (thin && !isEmpty(activity) && !late) {
    await sendTelegram(`🗓️ Monev ${date}: yang tercatat di GitHub hari ini baru sedikit.\n\n` +
      activity.github.map((g) => `• ${g}`).join("\n") + `\n\n` +
      `Balas pesan ini dengan kegiatanmu yang lain hari ini (meeting, belajar, diskusi, review, WFO) sebelum 22.30, ` +
      `nanti isinya dikirim ke sini. Balas "izin" atau "sakit" kalau tidak masuk.`);
    return;
  }

  if (isEmpty(activity)) {
    await sendTelegram(`⚠️ Monev ${date}: belum ada aktivitas yang tercatat di GitHub hari ini.\n\n` +
      `Balas pesan ini dengan kegiatanmu hari ini (meeting, belajar, diskusi, WFO) sebelum 22.30, ` +
      `nanti isinya dikirim ke sini. Balas "izin" atau "sakit" kalau tidak masuk.`);
    return;
  }

  const log = await compose(activity);
  const label = late ? "versi baru (dengan balasanmu)" : "siap diisi";
  await sendTelegram(
    `📝 Monev ${date} ${label}\n\n` +
    `1. Buka form: ${monevUrl(date)}\n` +
    `2. Tekan-tahan tiap pesan di bawah → Salin → tempel ke kolomnya\n` +
    `3. Tambahkan lokasi → centang pernyataan → Simpan dan Kirim\n\n` +
    `Mau ubah? Balas pesan ini dengan koreksinya sebelum 22.30.`,
  );
  await sendTelegram(log.uraian_aktivitas);
  await sendTelegram(log.pembelajaran);
  await sendTelegram(log.kendala);
  console.log("Terkirim ke Telegram: 4 pesan.");
}

main().catch(async (err) => {
  console.error((err as Error).message);
  await sendTelegram(`❗ Monev ${date}: gagal menyusun isi (${(err as Error).message}).\nIsi manual: ${monevUrl(date)}`)
    .catch(() => {});
  process.exitCode = 1;
});
