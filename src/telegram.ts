import { config } from "./config.js";

/**
 * Balasan peserta ke bot Telegram pada tanggal itu (WIB), dipakai sebagai catatan aktivitas.
 * Telegram menyimpan pesan yang belum diambil selama ±24 jam, jadi balas di hari yang sama.
 */
export async function telegramReplies(date: string, after?: Date): Promise<string[]> {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return [];
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["message","callback_query"]`);
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
    .filter((m) => !after || m.date * 1000 > after.getTime())
    .map((m) => m.text!.trim());
}

/** Kirim satu pesan teks polos (mudah disalin dengan tekan-tahan di HP). */
export async function sendTelegram(text: string): Promise<void> {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diisi");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
}

/** Balasan seperti "izin", "sakit", "libur", "cuti" berarti agent tidak mengisi hari itu. */
export const dayOffReply = (replies: string[]) =>
  replies.find((r) => /^(izin|sakit|libur|cuti|off)\b/i.test(r));

async function tg<T>(method: string, body: unknown): Promise<T> {
  const { token } = config.telegram;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
  return json.result;
}

export const telegramReady = () => !!(config.telegram.token && config.telegram.chatId);

/** Kirim draf dengan tombol ✅ Kirim / ❌ Batal. Mengembalikan id pesan untuk diperbarui nanti. */
export async function sendConfirm(text: string, nonce: string): Promise<number> {
  const msg = await tg<{ message_id: number }>("sendMessage", {
    chat_id: config.telegram.chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Kirim", callback_data: `monev:${nonce}:send` },
        { text: "❌ Batal", callback_data: `monev:${nonce}:cancel` },
      ]],
    },
  });
  return msg.message_id;
}

/** Tunggu tap tombol untuk nonce ini, hanya dari chat milik peserta. Berhenti kalau signal dibatalkan. */
export async function waitConfirm(nonce: string, signal: AbortSignal): Promise<"send" | "cancel" | null> {
  // Antrean update sengaja tidak dikonfirmasi (tanpa offset) supaya balasan teks
  // seperti "izin" tetap terbaca oleh telegramReplies.
  while (!signal.aborted) {
    let updates: { update_id: number; callback_query?: { id: string; data?: string; message?: { chat: { id: number } } } }[] = [];
    try {
      updates = await tg("getUpdates", { allowed_updates: ["callback_query", "message"] });
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      const cb = u.callback_query;
      if (!cb?.data?.startsWith(`monev:${nonce}:`)) continue;
      if (String(cb.message?.chat.id) !== config.telegram.chatId) continue;
      await tg("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
      return cb.data.endsWith(":send") ? "send" : "cancel";
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

/** Ganti pesan konfirmasi (hapus tombolnya) setelah diputuskan, di terminal atau di Telegram. */
export async function closeConfirm(messageId: number, text: string): Promise<void> {
  await tg("editMessageText", { chat_id: config.telegram.chatId, message_id: messageId, text }).catch(() => {});
}
