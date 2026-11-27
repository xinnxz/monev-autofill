import { GoogleGenAI, type Content } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ROOT } from "./config.js";
import type { Activity } from "./collect.js";

export const MIN_CHARS = 100;

export const LogbookSchema = z.object({
  uraian_aktivitas: z.string(),
  pembelajaran: z.string(),
  kendala: z.string(),
});
export type Logbook = z.infer<typeof LogbookSchema>;

/** File latar proyek (opsional): membantu memahami istilah, BUKAN sumber aktivitas. */
function projectContext(): string {
  const file = path.resolve(ROOT, process.env.CONTEXT_FILE?.trim() || "konteks.md");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().slice(0, 12_000) : "";
}

const systemPrompt = () => {
  const ctx = projectContext();
  return `Kamu menyusun logbook harian program magang MagangHub Kemnaker untuk seorang peserta magang dengan posisi ${process.env.ROLE?.trim() || "Software Engineer"}.
${ctx ? `
<latar_proyek>
${ctx}
</latar_proyek>

Latar proyek di atas HANYA untuk memahami konteks: istilah, nama fitur, peran tim, dan tujuan pekerjaan. Pakai untuk menjelaskan MENGAPA aktivitas hari itu penting dan menulis pembelajaran yang lebih bermakna. Jangan pernah menulis isi latar proyek sebagai kegiatan yang dikerjakan hari itu.
` : ""}
Aturan:
- Tulis HANYA berdasarkan data aktivitas yang diberikan. Jangan menambah kegiatan, meeting, atau hasil yang tidak ada di data.
- Bahasa santai tapi sopan, seperti catatan harian biasa, tidak kaku dan tidak terlalu formal. Kalimat aktif tanpa subjek ("Ngerjain...", "Belajar..." atau "Mengerjakan..." boleh), satu paragraf pendek per kolom.
- Ubah istilah commit yang terlalu teknis menjadi kalimat yang bisa dipahami mentor non-teknis, tapi tetap sebut nama fitur atau tiket.
- Singkat saja: tiap kolom sekitar 120 sampai 250 karakter, cukup 2–3 kalimat. Tidak perlu menyebut semua detail, pilih yang paling penting. Minimal ${MIN_CHARS} karakter adalah syarat portal.
- uraian_aktivitas: apa yang dikerjakan hari itu.
- pembelajaran: hal yang dipelajari dari pekerjaan itu (teknik, arsitektur, proses tim).
- kendala: hambatan yang benar-benar terlihat di data (review yang harus diperbaiki, konflik merge, spec yang belum jelas, dsb). Kalau data tidak menunjukkan hambatan, tulis bagian pekerjaan yang paling menantang dan bagaimana menanganinya; jangan mengarang masalah.`;
};

function render(a: Activity): string {
  const parts = [`Tanggal: ${a.date}`];
  if (a.commits.length) {
    parts.push("## Commit git", ...a.commits.map((c) =>
      `- [${c.repo}] ${c.subject}${c.body ? `\n  ${c.body.replace(/\n/g, "\n  ")}` : ""}`));
  }
  if (a.github.length) parts.push("## Aktivitas GitHub (PR, review, diskusi)", ...a.github.map((g) => `- ${g}`));
  if (a.notes.length) parts.push("## Dokumen yang ditulis/diubah", ...a.notes.map((n) => `- ${n.title} (${n.file})`));
  if (a.slack.length) parts.push("## Pesan Slack", ...a.slack.map((s) => `- ${s}`));
  if (a.replies.length) parts.push("## Jawaban peserta di Telegram (\"hari ini ngapain?\")", ...a.replies.map((r) => `- ${r}`));
  if (a.claude.length) parts.push(
    "## Pertanyaan peserta ke asisten AI (Claude Code) hari itu",
    "Ini topik yang sedang dipelajari atau sedang menjadi kendala, BUKAN bukti pekerjaan selesai. Pakai terutama untuk kolom pembelajaran dan kendala; jangan menyebut nama asisten AI-nya.",
    ...a.claude.map((q) => `- ${q}`));
  if (a.manual.trim()) parts.push("## Catatan manual peserta", a.manual.trim());
  return parts.join("\n");
}

const tooShort = (l: Logbook) =>
  Object.entries(l).filter(([, v]) => v.trim().length < MIN_CHARS).map(([k]) => k);

/** Pesan progres (dipakai spinner di terminal). */
export let onStatus: (s: string) => void = (s) => console.warn(`[gemini] ${s}`);
export const setStatusHandler = (fn: (s: string) => void) => { onStatus = fn; };

export async function compose(activity: Activity): Promise<Logbook> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diisi di .env");
  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta", httpOptions: { timeout: 90_000 } });
  // Urutan model: utama → cadangan → lite (paling jarang sibuk). Duplikat dibuang.
  const models = [...new Set([
    process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
  ])];
  const contents: Content[] = [{ role: "user", parts: [{ text: render(activity) }] }];

  /** Server sibuk (429/503/timeout) → coba lagi dengan jeda, lalu pindah ke model cadangan. */
  const generate = async () => {
    let lastErr: unknown;
    for (const model of models) {
      const tries = 2;
      for (let attempt = 0; attempt < tries; attempt++) {
        try {
          return await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: systemPrompt(),
              responseMimeType: "application/json",
              responseJsonSchema: z.toJSONSchema(LogbookSchema),
              temperature: 0.4,
            },
          });
        } catch (err) {
          lastErr = err;
          const status = (err as { status?: number }).status;
          const transient = status === undefined || status === 429 || status >= 500;
          if (!transient) throw err;
          onStatus(`Gemini ${model} sibuk (${status ?? "timeout"}), percobaan ${attempt + 1}/${tries}`);
          await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await generate();
    const text = res.text;
    if (!text) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "tanpa teks";
      throw new Error(`Gemini tidak mengembalikan isi (${reason}).`);
    }
    const out = LogbookSchema.parse(JSON.parse(text));
    const short = tooShort(out);
    if (!short.length) return out;
    contents.push(
      { role: "model", parts: [{ text }] },
      { role: "user", parts: [{ text: `Kolom ${short.join(", ")} kurang dari ${MIN_CHARS} karakter. Perpanjang hanya dengan detail dari data, lalu kirim ulang ketiga kolom.` }] },
    );
  }
  throw new Error(`Isi logbook masih kurang dari ${MIN_CHARS} karakter setelah 2 percobaan.`);
}
