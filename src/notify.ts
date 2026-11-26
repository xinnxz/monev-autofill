import { config } from "./config.js";

/** Kirim ke semua kanal yang dikonfigurasi. Gagal di satu kanal tidak menghentikan yang lain. */
export async function notify(title: string, body: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const { token, chatId } = config.telegram;

  if (token && chatId) {
    jobs.push(fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `${title}\n\n${body}`, disable_web_page_preview: true }),
    }).then(async (r) => { if (!r.ok) throw new Error(`telegram ${r.status}: ${await r.text()}`); }));
  }
  if (config.ntfyTopic) {
    jobs.push(fetch(`https://ntfy.sh/${encodeURIComponent(config.ntfyTopic)}`, {
      method: "POST",
      headers: { Title: encodeURIComponent(title), Priority: "high", Tags: "memo" },
      body,
    }).then((r) => { if (!r.ok) throw new Error(`ntfy ${r.status}`); }));
  }
  if (!jobs.length) console.warn("[notify] Belum ada kanal notifikasi di .env");

  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === "rejected") console.error("[notify]", r.reason);
  }
  console.log(`[notify] ${title}`);
}
