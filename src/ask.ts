import { collect } from "./collect.js";
import { config, todayWib, weekday } from "./config.js";
import { notify } from "./notify.js";

// Dijalankan sore/malam (default 21.00): tanya aktivitas yang tidak tercatat otomatis.
const date = process.argv[2] ?? todayWib();
const wd = weekday(date);

if (wd === 0 || wd === 6 || config.offDays.has(date)) {
  console.log(`${date} libur, tidak bertanya.`);
} else {
  const a = await collect(date);
  const found = [
    a.commits.length && `${a.commits.length} commit`,
    a.github.length && `${a.github.length} aktivitas PR/review`,
    a.notes.length && `${a.notes.length} dokumen`,
    a.slack.length && `${a.slack.length} pesan Slack`,
  ].filter(Boolean).join(", ");

  await notify(
    `🗓️ Monev ${date}: hari ini ngapain aja?`,
    `Balas pesan ini 1–2 baris, terutama yang tidak ada di GitHub (meeting, diskusi, belajar, WFO).\n` +
    `Contoh: "sprint planning dengan mentor, mempelajari kode service pembayaran".\n\n` +
    `Sudah tercatat otomatis: ${found || "belum ada"}.\n` +
    `Balas "izin" atau "sakit" kalau hari ini tidak masuk.\n` +
    `Form diisi pukul 23.00.`,
  );
}
