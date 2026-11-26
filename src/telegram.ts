import { config } from "./config.js";

/**
 * Balasan peserta ke bot Telegram pada tanggal itu (WIB), dipakai sebagai catatan aktivitas.
 * Telegram menyimpan pesan yang belum diambil selama ±24 jam, jadi balas di hari yang sama.
 */
export async function telegramReplies(date: string): Promise<string[]> {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return [];
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message"]`);
  const json = (await res.json()) as {
    ok: boolean;
    result: { message?: { chat: { id: number }; date: number; text?: string } }[];
  };
  if (!json.ok) return [];
  return json.result
    .map((u) => u.message)
    .filter((m): m is NonNullable<typeof m> => !!m?.text && String(m.chat.id) === chatId)
    .filter((m) => !m.text!.startsWith("/"))
    .filter((m) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(m.date * 1000)) === date)
    .map((m) => m.text!.trim());
}

/** Balasan seperti "izin", "sakit", "libur", "cuti" berarti agent tidak mengisi hari itu. */
export const dayOffReply = (replies: string[]) =>
  replies.find((r) => /^(izin|sakit|libur|cuti|off)\b/i.test(r));
