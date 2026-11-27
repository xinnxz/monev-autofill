import "dotenv/config";
import path from "node:path";

const list = (v: string | undefined) =>
  (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

export const ROOT = path.resolve(import.meta.dirname, "..");

export const config = {
  repos: list(process.env.REPOS),
  gitAuthor: process.env.GIT_AUTHOR?.trim() ?? "",
  notesDirs: list(process.env.NOTES_DIRS),
  manualNotesDir: path.resolve(ROOT, process.env.MANUAL_NOTES_DIR || "./catatan"),
  github: {
    token: process.env.GITHUB_TOKEN?.trim(),
    user: process.env.GITHUB_USER?.trim(),
  },
  claudeCode: {
    projects: list(process.env.CLAUDE_CODE_PROJECTS),
    exclude: process.env.CLAUDE_CODE_EXCLUDE?.trim(),
  },
  slack: {
    token: process.env.SLACK_USER_TOKEN?.trim(),
    userId: process.env.SLACK_USER_ID?.trim(),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim(),
    chatId: process.env.TELEGRAM_CHAT_ID?.trim(),
  },
  ntfyTopic: process.env.NTFY_TOPIC?.trim(),
  monevUrl:
    process.env.MONEV_URL ||
    "https://monev.maganghub.kemnaker.go.id/dashboard/riwayat?date={date}&view=edit",
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  offDays: new Set(list(process.env.OFF_DAYS)),
  profileDir: path.join(ROOT, ".profile"),
  draftsDir: path.join(ROOT, "drafts"),
};

/** Tanggal hari ini di WIB, format YYYY-MM-DD. */
export function todayWib(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/** 0 = Minggu ... 6 = Sabtu, untuk tanggal YYYY-MM-DD. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00+07:00`).getUTCDay();
}
