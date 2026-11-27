import { config, todayWib, weekday } from "./config.js";
import { monevUrl } from "./portal.js";
import { htmlEscape } from "./telegram.js";

/**
 * Mode pengingat (tanpa laptop, tanpa GitHub, tanpa Gemini): cukup bot Telegram.
 * Dijalankan beberapa kali sehari (default 16.00, 19.00, 21.00 WIB). Berhenti mengingatkan
 * setelah kamu tap "✅ Sudah" atau membalas "sudah" hari itu.
 *
 *   tsx src/remind.ts [--level 1|2|3] [--date YYYY-MM-DD]
 */

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const date = arg("--date") ?? todayWib();
const level = Math.min(3, Math.max(1, Number(arg("--level") ?? 1)));

const { token, chatId } = config.telegram;
const api = async <T>(method: string, body: unknown): Promise<T> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
};

const wibDate = (unix: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(unix * 1000));

/** Sudah ditandai selesai hari ini? (tap tombol atau balasan teks "sudah"/"done"). */
async function alreadyDone(): Promise<boolean> {
  // Antrean sengaja tidak dikonfirmasi supaya tetap terbaca oleh run berikutnya (Telegram menyimpannya ±24 jam).
  const updates = await api<{
    callback_query?: { id: string; data?: string; message?: { chat: { id: number }; date: number } };
    message?: { chat: { id: number }; date: number; text?: string };
  }[]>("getUpdates", { allowed_updates: ["message", "callback_query"] });

  for (const u of updates) {
    const cb = u.callback_query;
    if (cb?.data === `remind:${date}:done` && String(cb.message?.chat.id) === chatId) {
      await api("answerCallbackQuery", { callback_query_id: cb.id, text: "Sip, dicatat ✅" }).catch(() => {});
      return true;
    }
    const m = u.message;
    if (m?.text && String(m.chat.id) === chatId && wibDate(m.date) === date &&
        /^(sudah|udah|done|beres|ok sudah)\b/i.test(m.text.trim())) return true;
  }
  return false;
}

const MESSAGES = [
  (d: string) => `⏰ <b>Monev ${d}</b>\n<code>status : belum ditandai selesai</code>\n\nJangan lupa isi laporan harian hari ini.`,
  (d: string) => `⚠️ <b>Monev ${d} — pengingat kedua</b>\n<code>status : belum ditandai selesai</code>\n\nKalau sudah diisi, tap ✅ Sudah supaya bot berhenti mengingatkan.`,
  (d: string) => `🚨 <b>Monev ${d} — pengingat terakhir</b>\n<code>status : belum ditandai selesai</code>\n\nHari kosong bisa memotong uang saku. Isi sekarang sebelum tengah malam.`,
];

async function main() {
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi");
  const wd = weekday(date);
  if (wd === 0 || wd === 6 || config.offDays.has(date)) return console.log("Hari libur, tidak ada pengingat.");
  if (await alreadyDone()) return console.log("Sudah ditandai selesai hari ini.");

  await api("sendMessage", {
    chat_id: chatId,
    text: `${MESSAGES[level - 1](htmlEscape(date))}\n\n<code>&gt;_ ${htmlEscape(monevUrl(date))}</code>`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: "📝 Buka form", url: monevUrl(date) },
        { text: "✅ Sudah", callback_data: `remind:${date}:done` },
      ]],
    },
  });
  console.log(`Pengingat level ${level} terkirim.`);
}

main().catch((err) => { console.error((err as Error).message); process.exitCode = 1; });
