/** Tampilan terminal bergaya "hacker": hijau di atas hitam, banner ASCII, kotak bergaris. */

const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
export const green = esc("92");
export const dim = esc("32");
export const cyan = esc("96");
export const red = esc("91");
export const yellow = esc("93");
export const bold = esc("1");

const BANNER = String.raw`
 ███╗   ███╗ ██████╗ ███╗   ██╗███████╗██╗   ██╗
 ████╗ ████║██╔═══██╗████╗  ██║██╔════╝██║   ██║
 ██╔████╔██║██║   ██║██╔██╗ ██║█████╗  ██║   ██║
 ██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══╝  ╚██╗ ██╔╝
 ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║███████╗ ╚████╔╝
 ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝  ╚═══╝ `;

export function banner(date: string) {
  console.log(green(BANNER));
  console.log(dim(` monev-autofill · laporan harian MagangHub · ${date}
`));
}

/** Baris log bergaya terminal: [*] info, [+] sukses, [!] peringatan, [x] gagal. */
export const log = {
  info: (s: string) => console.log(`${cyan("[*]")} ${dim(s)}`),
  ok: (s: string) => console.log(`${green("[+]")} ${green(s)}`),
  warn: (s: string) => console.log(`${yellow("[!]")} ${yellow(s)}`),
  err: (s: string) => console.log(`${red("[x]")} ${red(s)}`),
};

const width = () => Math.min(process.stdout.columns || 100, 110) - 4;

function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if ((line + " " + word).trim().length > w) { out.push(line); line = word; }
      else line = (line ? line + " " : "") + word;
    }
    out.push(line);
  }
  return out;
}

/** Kotak bergaris dengan judul, isi dibungkus sesuai lebar terminal. */
export function box(title: string, body: string) {
  const w = width();
  const head = `┌─[ ${title} ]${"─".repeat(Math.max(0, w - title.length - 5))}┐`;
  console.log(green(head));
  for (const l of wrap(body, w - 2)) console.log(green("│ ") + l.padEnd(w - 2) + green(" │"));
  console.log(green(`└${"─".repeat(w)}┘`));
}

export const prompt = (q: string) => `
${green("monev")} ${dim("❯")} ${bold(q)} `;

/** Animasi loading bergaya sci-fi. Di luar terminal interaktif, cukup cetak satu baris. */
export function spinner(text: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const glyphs = "01ABCDEF#$%&*<>/\|";
  const tty = !!process.stdout.isTTY;
  let msg = text;
  let i = 0;
  const started = Date.now();
  const noise = () => Array.from({ length: 6 }, () => glyphs[Math.floor(Math.random() * glyphs.length)]).join("");
  const render = () => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`\r\x1b[2K${cyan(frames[i++ % frames.length])} ${dim(msg)} ${dim(noise())} ${dim(`${secs}s`)}`);
  };
  const timer = tty ? setInterval(render, 90) : null;
  if (!tty) console.log(`${cyan("[*]")} ${dim(text)}`);
  const end = (line: string) => {
    if (timer) clearInterval(timer);
    if (tty) process.stdout.write("\r\x1b[2K");
    if (line) console.log(line);
  };
  return {
    update: (t: string) => { msg = t; if (!tty) console.log(`${cyan("[*]")} ${dim(t)}`); },
    ok: (t: string) => end(`${green("[+]")} ${green(t)}`),
    fail: (t: string) => end(`${red("[x]")} ${red(t)}`),
    stop: () => end(""),
  };
}
