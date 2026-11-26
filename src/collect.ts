import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { githubActivity } from "./github.js";
import { telegramReplies } from "./telegram.js";

export interface Activity {
  date: string;
  commits: { repo: string; sha: string; subject: string; body: string }[];
  github: string[];
  notes: { file: string; title: string }[];
  manual: string;
  replies: string[];
  slack: string[];
}

export function isEmpty(a: Activity): boolean {
  return !a.commits.length && !a.github.length && !a.notes.length && !a.manual.trim() &&
    !a.replies.length && !a.slack.length;
}

/** Repo di daftar, atau subfolder 1 tingkat yang berisi .git. */
function resolveRepos(): string[] {
  const out: string[] = [];
  for (const dir of config.repos) {
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, ".git"))) { out.push(dir); continue; }
    for (const name of fs.readdirSync(dir)) {
      const sub = path.join(dir, name);
      if (fs.existsSync(path.join(sub, ".git"))) out.push(sub);
    }
  }
  return out;
}

function gitCommits(date: string): Activity["commits"] {
  if (!config.gitAuthor) return [];
  const SEP = "\u001e";
  const commits: Activity["commits"] = [];
  const seen = new Set<string>();
  for (const repo of resolveRepos()) {
    let raw = "";
    try {
      raw = execFileSync("git", [
        "-C", repo, "log", "--all", "--no-merges",
        `--author=${config.gitAuthor}`,
        `--since=${date} 00:00:00 +0700`, `--until=${date} 23:59:59 +0700`,
        `--pretty=format:%H%x1f%s%x1f%b${SEP}`,
      ], { encoding: "utf8" });
    } catch { continue; }
    for (const rec of raw.split(SEP)) {
      const [hash, subject, body = ""] = rec.trim().split("\u001f");
      if (!hash || !subject || seen.has(hash)) continue;
      seen.add(hash);
      commits.push({
        repo: path.basename(repo),
        sha: hash,
        subject,
        // Baris trailer (Co-Authored-By, Signed-off-by) bukan aktivitas.
        body: body.split("\n").filter((l) => !/^[\w-]+-By:/i.test(l.trim())).join("\n").trim(),
      });
    }
  }
  return commits;
}

function changedNotes(date: string): Activity["notes"] {
  const notes: Activity["notes"] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!ent.name.startsWith(".")) walk(p); continue; }
      if (!/\.md$/i.test(ent.name)) continue;
      const mtime = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })
        .format(fs.statSync(p).mtime);
      if (mtime !== date) continue;
      const heading = fs.readFileSync(p, "utf8").match(/^#\s+(.+)$/m)?.[1] ?? ent.name;
      notes.push({ file: ent.name, title: heading.trim() });
    }
  };
  for (const dir of config.notesDirs) if (fs.existsSync(dir)) walk(dir);
  return notes;
}

function manualNote(date: string): string {
  const p = path.join(config.manualNotesDir, `${date}.md`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function slackMessages(date: string): Promise<string[]> {
  const { token, userId } = config.slack;
  if (!token || !userId) return [];
  const q = encodeURIComponent(`from:<@${userId}> on:${date}`);
  const res = await fetch(`https://slack.com/api/search.messages?query=${q}&count=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    ok: boolean; error?: string;
    messages?: { matches: { text: string; channel?: { name?: string } }[] };
  };
  if (!json.ok) {
    console.warn(`[slack] dilewati: ${json.error}`);
    return [];
  }
  return (json.messages?.matches ?? []).map((m) => `#${m.channel?.name ?? "?"}: ${m.text}`);
}

export async function collect(date: string): Promise<Activity> {
  const local = gitCommits(date);
  const gh = await githubActivity(date).catch((err) => {
    console.warn(`[github] dilewati: ${(err as Error).message}`);
    return { commits: [], items: [] };
  });
  // Commit yang ada di lokal dan GitHub cukup dihitung sekali.
  const seen = new Set(local.map((c) => c.sha));
  const commits = [...local, ...gh.commits.filter((c) => !seen.has(c.sha))];

  return {
    date,
    commits,
    github: gh.items,
    notes: changedNotes(date),
    manual: manualNote(date),
    replies: await telegramReplies(date).catch(() => []),
    slack: await slackMessages(date),
  };
}
