import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

/**
 * Pertanyaan yang kamu ketik ke Claude Code pada tanggal itu (WIB), dari riwayat lokal
 * ~/.claude/projects/<folder>/*.jsonl. Hanya folder yang diizinkan, hanya pesanmu
 * (bukan jawaban Claude), dipotong pendek, dan rahasia disamarkan sebelum dikirim ke Gemini.
 */

const MAX_PROMPTS = 15;
const MAX_CHARS = 200;

const SECRET_PATTERNS: RegExp[] = [
  /AQ\.[A-Za-z0-9_-]{20,}/g,                       // Google API key (format baru)
  /AIza[0-9A-Za-z_-]{30,}/g,                        // Google API key
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,               // OpenAI / Stripe / Anthropic dsb.
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                  // GitHub token
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,                 // Slack token
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,                 // Telegram bot token
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email
  /\b[A-Za-z0-9_-]{40,}\b/g,                         // string acak panjang lain
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((t, re) => t.replace(re, "[disamarkan]"), text);
}

/** Folder proyek Claude Code memakai path dengan pemisah diganti "-", misal E--DATA-Ngoding-Dash. */
const matchesAllowed = (dirName: string, allowed: string[]) =>
  allowed.some((a) => dirName.toLowerCase().endsWith(`-${a.toLowerCase()}`) || dirName.toLowerCase() === a.toLowerCase());

function promptText(entry: any): string | null {
  if (entry?.type !== "user" || entry.isMeta || entry.isSidechain) return null;
  if (entry.origin && entry.origin.kind !== "human") return null;
  if (entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return null;
  const c = entry.message?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b: any) => b?.type === "tool_result")) return null;
    text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
  }
  // Teks tempelan (komentar reviewer, log terminal, chat orang lain) bukan kata-katamu: buang.
  text = text.replace(/<pasted_content[^>]*>[\s\S]*?(<\/pasted_content>|$)/gi, " ");
  // Tempelan tanpa tag yang khas: komentar review GitHub dan log terminal.
  if (/\bcommented\b|Comment on lines? R\d+|^PS [A-Z]:\\/m.test(text)) return null;
  text = text
    .replace(/<([a-z_-]+)[^>]*>[\s\S]*?<\/\1>/gi, " ") // blok sistem/command yang dibungkus tag
    .replace(/<\/?[a-z_-]+[^>]*\/?>/gi, " ")             // sisa tag tunggal
    .replace(/\[Request interrupted[^\]]*\]/gi, " ")
    .replace(/^"[\s\S]*"$/, " ")                         // kutipan utuh dari orang lain
    .replace(/\s+/g, " ")
    .trim();
  if (/^(The summarized conversation|This session is being continued)/i.test(text)) return null;
  // Perintah pendek ("Ya, update", "lanjut langkah 6") tidak memberi informasi.
  if (!text || text.startsWith("/") || text.length < 25 || text.split(" ").length < 5) return null;
  return text;
}

export function claudeCodePrompts(date: string): string[] {
  const allowed = config.claudeCode.projects;
  if (!allowed.length) return [];
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(root)) return [];
  const exclude = config.claudeCode.exclude ? new RegExp(config.claudeCode.exclude, "i") : null;
  const wib = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });

  const found: { ts: string; text: string }[] = [];
  for (const dir of fs.readdirSync(root)) {
    if (!matchesAllowed(dir, allowed)) continue;
    const full = path.join(root, dir);
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith(".jsonl")) continue;
      const p = path.join(full, file);
      // Lewati file yang tidak tersentuh sejak tanggal itu.
      if (wib.format(fs.statSync(p).mtime) < date) continue;
      const fromFile: { ts: string; text: string }[] = [];
      let excluded = false;
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        if (!line.includes('"type":"user"')) continue;
        let entry: any;
        try { entry = JSON.parse(line); } catch { continue; }
        const text = promptText(entry);
        if (!text) continue;
        // Satu sesi dibuang utuh kalau ada pertanyaan yang cocok pola pengecualian:
        // obrolan di luar pekerjaan biasanya satu sesi penuh, bukan satu pesan.
        if (exclude?.test(text)) { excluded = true; break; }
        if (entry.timestamp && wib.format(new Date(entry.timestamp)) === date) {
          fromFile.push({ ts: entry.timestamp, text });
        }
      }
      if (!excluded) found.push(...fromFile);
    }
  }

  const seen = new Set<string>();
  const all = found
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((f) => redact(f.text))
    .map((t) => (t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}…` : t))
    .filter((t) => !seen.has(t) && seen.add(t));
  if (all.length <= MAX_PROMPTS) return all;
  // Ambil merata sepanjang hari, bukan hanya pagi.
  const step = all.length / MAX_PROMPTS;
  return Array.from({ length: MAX_PROMPTS }, (_, i) => all[Math.floor(i * step)]);
}
