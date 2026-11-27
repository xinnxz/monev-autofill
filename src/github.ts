import { execFileSync } from "node:child_process";
import { config } from "./config.js";

/**
 * Aktivitas GitHub satu hari (WIB) dari Events API: push, PR, review, komentar.
 * Tidak butuh clone lokal, jadi bisa dipakai siapa saja yang punya akses repo-nya.
 */

export interface GithubActivity {
  commits: { repo: string; sha: string; subject: string; body: string }[];
  items: string[]; // PR dibuka/di-merge, review, komentar, branch baru
}

interface GhEvent {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: Record<string, any>;
}

function token(): string | undefined {
  if (config.github.token) return config.github.token;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function api<T>(tok: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as T;
}

const wibDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(iso));

const clip = (s: string | null | undefined, n = 220) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export async function githubActivity(date: string): Promise<GithubActivity> {
  const out: GithubActivity = { commits: [], items: [] };
  const user = config.github.user;
  const tok = token();
  if (!user || !tok) return out;

  // Events API: terbaru dulu, maksimal 300 event / 90 hari.
  const events: GhEvent[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await api<GhEvent[]>(tok, `/users/${user}/events?per_page=100&page=${page}`);
    events.push(...batch);
    const oldest = batch.at(-1)?.created_at;
    if (batch.length < 100 || (oldest && wibDate(oldest) < date)) break;
  }
  const today = events.filter((e) => wibDate(e.created_at) === date).reverse();

  // Payload PR di Events API tidak selalu memuat judul; ambil sekali per PR.
  const prTitles = new Map<string, string>();
  const prTitle = async (repo: string, num: number) => {
    const key = `${repo}#${num}`;
    if (!prTitles.has(key)) {
      const pr = await api<{ title: string }>(tok, `/repos/${repo}/pulls/${num}`).catch(() => ({ title: "" }));
      prTitles.set(key, pr.title);
    }
    return `${key}${prTitles.get(key) ? ` "${prTitles.get(key)}"` : ""}`;
  };

  const seenSha = new Set<string>();
  const reviewComments = new Map<string, string[]>();

  for (const e of today) {
    const repo = e.repo.name;
    const p = e.payload;
    try {
      switch (e.type) {
        case "PushEvent": {
          // Payload push tidak lagi berisi daftar commit; bandingkan before..head.
          if (!p.before || !p.head || /^0+$/.test(p.before)) break;
          const cmp = await api<{ commits: { sha: string; author: { login: string } | null; commit: { message: string } }[] }>(
            tok, `/repos/${repo}/compare/${p.before}...${p.head}`);
          for (const c of cmp.commits) {
            if (seenSha.has(c.sha) || c.author?.login?.toLowerCase() !== user.toLowerCase()) continue;
            const [subject, ...rest] = c.commit.message.split("\n");
            if (/^Merge (branch|remote-tracking|pull request)/.test(subject)) continue;
            seenSha.add(c.sha);
            out.commits.push({
              repo: repo.split("/")[1], sha: c.sha, subject,
              body: rest.filter((l) => !/^[\w-]+-By:/i.test(l.trim())).join("\n").trim(),
            });
          }
          break;
        }
        case "PullRequestEvent": {
          const what = p.action === "closed" ? (p.pull_request?.merged ? "Merge" : "Menutup") :
            p.action === "opened" ? "Membuka" : p.action === "reopened" ? "Membuka ulang" : null;
          if (what) out.items.push(`${what} PR ${await prTitle(repo, p.number ?? p.pull_request?.number)}`);
          break;
        }
        case "PullRequestReviewEvent": {
          const state = p.review?.state;
          const label = state === "approved" ? "Approve" : state === "changes_requested" ? "Meminta perubahan pada" : null;
          if (label) out.items.push(`${label} PR ${await prTitle(repo, p.pull_request?.number)}${p.review?.body ? `: ${clip(p.review.body)}` : ""}`);
          break;
        }
        case "PullRequestReviewCommentEvent":
        case "IssueCommentEvent": {
          const num = p.pull_request?.number ?? p.issue?.number;
          const key = await prTitle(repo, num);
          const list = reviewComments.get(key) ?? [];
          list.push(clip(p.comment?.body, 160));
          reviewComments.set(key, list);
          break;
        }
        case "CreateEvent":
          if (p.ref_type === "branch") out.items.push(`Membuat branch ${p.ref} di ${repo}`);
          if (p.ref_type === "repository") out.items.push(`Membuat repository ${repo}`);
          break;
      }
    } catch (err) {
      console.warn(`[github] ${e.type} dilewati (${(err as Error).message.split(" ")[1] ?? "error"})`);
    }
  }

  // Events API tidak lengkap (push kadang tidak tercatat), jadi baca juga commit langsung
  // dari PR milikmu yang aktif sekitar tanggal itu.
  try {
    const prev = new Date(`${date}T12:00:00+07:00`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const since = prev.toISOString().slice(0, 10);
    const search = await api<{ items: { number: number; repository_url: string }[] }>(
      tok, `/search/issues?q=${encodeURIComponent(`type:pr author:${user} updated:>=${since}`)}&per_page=20`);
    for (const pr of search.items) {
      const repo = pr.repository_url.split("/repos/")[1];
      const commits = await api<{ sha: string; author: { login: string } | null; commit: { message: string; author: { date: string } } }[]>(
        tok, `/repos/${repo}/pulls/${pr.number}/commits?per_page=100`);
      for (const c of commits) {
        if (seenSha.has(c.sha) || c.author?.login?.toLowerCase() !== user.toLowerCase()) continue;
        if (wibDate(c.commit.author.date) !== date) continue;
        const [subject, ...rest] = c.commit.message.split("\n");
        if (/^Merge (branch|remote-tracking|pull request)/.test(subject)) continue;
        seenSha.add(c.sha);
        out.commits.push({
          repo: repo.split("/")[1], sha: c.sha, subject,
          body: rest.filter((l) => !/^[\w-]+-By:/i.test(l.trim())).join("\n").trim(),
        });
      }
    }
  } catch (err) {
    console.warn(`[github] commit dari PR dilewati (${(err as Error).message.split(" ")[1] ?? "error"})`);
  }

  for (const [pr, comments] of reviewComments) {
    out.items.push(`Diskusi review di PR ${pr} (${comments.length} komentar), antara lain: ` +
      comments.slice(0, 5).map((c) => `"${c}"`).join("; "));
  }
  return out;
}
