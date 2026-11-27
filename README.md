# monev-autofill

Agent yang menyiapkan **logbook harian MagangHub (monev)** setiap hari kerja. Isinya diambil dari aktivitas kerja yang benar-benar kamu lakukan (GitHub, dokumen, Slack, dan jawabanmu di Telegram), lalu kamu tinggal meninjau dan submit (±20 detik).

> [!IMPORTANT]
> **Proyek komunitas, tidak berafiliasi dengan Kemnaker maupun MagangHub.**
> Agent ini **hanya membantu menyiapkan isian**. Ia tidak pernah mencentang pernyataan, mengisi lokasi, atau menekan *Kirim*, dan tidak mengarang aktivitas.
> Isi laporan sepenuhnya tanggung jawab peserta. Pastikan penggunaannya tidak melanggar ketentuan program dan perusahaan penempatanmu.
> Mohon jangan memodifikasinya untuk submit otomatis, memalsukan lokasi, atau mengisi aktivitas yang tidak dilakukan. Itu termasuk pelanggaran yang bisa berujung dikeluarkan dari program.

Ada dua mode:

| | **Mode HP** (disarankan) | **Mode laptop** |
|---|---|---|
| Jalan di | GitHub Actions (cloud), laptop boleh mati | Laptop (Task Scheduler) |
| Hasil | 4 pesan Telegram: link form + 3 kolom siap salin | Chrome terbuka dengan form sudah terisi |
| Sumber | GitHub, Slack, balasan Telegram, latar proyek | Semua, termasuk Claude Code & clone lokal |
| Langkahmu | Buka link di HP → tempel 3 kolom → lokasi → centang → kirim (±30 detik) | Cek → lokasi → centang → kirim |

## Mode HP (tanpa laptop)

```
21.00 WIB  GitHub Actions: kumpulkan aktivitas GitHub hari itu → Gemini → Telegram
           📝 pesan 1: link form tanggal itu + langkah
           📄 pesan 2–4: Uraian aktivitas / Pembelajaran / Kendala (tekan-tahan → Salin)
           Tidak ada aktivitas? → bot minta kamu membalas dengan kegiatanmu
22.30 WIB  Hanya kalau kamu membalas bot setelah 21.00: kirim versi baru dengan balasanmu
           (balasan "izin" / "sakit" → tidak dibuatkan isi)
```

Kamu **tidak wajib** membalas bot. Kalau ada aktivitas GitHub, isinya tetap dikirim jam 21.00.

### Setup Mode HP (sekali)

1. **Fork** repo ini (atau gunakan repo milikmu sendiri). Disarankan repo **private**, walaupun isi laporan memang tidak pernah dicetak ke log.
2. Buat **GitHub token** untuk akun yang dipakai kerja: github.com/settings/tokens → *Generate new token (classic)* → scope `repo` → kalau organisasi kantor memakai SSO, klik *Configure SSO → Authorize*.
3. Di repo hasil fork: *Settings → Secrets and variables → Actions*.

   **Secrets** (rahasia):

   | Nama | Isi |
   |---|---|
   | `GEMINI_API_KEY` | API key Gemini |
   | `TELEGRAM_BOT_TOKEN` | token bot dari @BotFather |
   | `TELEGRAM_CHAT_ID` | chat id kamu |
   | `ACTIVITY_GITHUB_TOKEN` | token dari langkah 2 |
   | `PROJECT_CONTEXT` | isi `konteks.md` (opsional) |
   | `SLACK_USER_TOKEN` | opsional |

   **Variables** (tidak rahasia):

   | Nama | Isi |
   |---|---|
   | `MONEV_ENABLED` | `true` |
   | `ACTIVITY_GITHUB_USER` | username GitHub kerja |
   | `ROLE` | posisi magang, misal `Software Engineer` |
   | `OFF_DAYS` | tanggal libur/cuti, pisahkan `;` (opsional) |

   Cara cepat dari laptop: jalankan sendiri script ini. Nilainya dibaca dari `.env` dan `konteks.md` lalu langsung dikirim ke GitHub, tanpa tampil di layar.

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1 -Repo <user>/<repo> -ActivityToken <token dari langkah 2>
   ```

4. Tab **Actions** → aktifkan workflow → *monev-phone* → **Run workflow** untuk tes. Pesan harus masuk ke Telegram.

Catatan: jadwal GitHub Actions bisa terlambat 5–30 menit di jam sibuk. Repo yang tidak ada aktivitas selama 60 hari akan dinonaktifkan jadwalnya oleh GitHub; aktifkan lagi dari tab Actions.

## Mode laptop

### Cara kerja

```
21.00 Senin–Jumat ── Bot Telegram: "hari ini ngapain aja?"
                     + ringkasan yang sudah tercatat otomatis
                     → kamu balas 1–2 baris (atau "izin" / "sakit")

23.00 Senin–Jumat
  ├─ 1. Cek hari    → Sabtu/Minggu, OFF_DAYS, balasan "izin/sakit",
  │                   atau "Jadwal libur posisi" di portal → berhenti
  ├─ 2. Kumpulkan   → GitHub: commit, PR dibuka/di-merge, review, diskusi PR
  │                   clone lokal, dokumen catatan, pertanyaan ke Claude Code,
  │                   Slack (opsional), balasan Telegram, catatan/YYYY-MM-DD.md
  │                   (semua kosong → peringatan, TIDAK mengarang isi)
  ├─ 3. Susun       → Gemini Flash menulis 3 kolom (masing-masing ≥100 karakter)
  │                   model sibuk → retry, lalu model cadangan
  ├─ 4. Isi form    → Chrome terbuka: Kehadiran = Hadir + 3 kolom terisi
  │                   (laporan yang sudah dikirim tidak pernah ditimpa)
  └─ 5. Notifikasi  → Telegram: "siap ditinjau" + teks lengkap

Kamu: cek isi → "Tambahkan lokasi" → centang pernyataan → Simpan dan Kirim
```

### Yang sengaja tidak diotomatiskan

| Bagian | Alasan |
|---|---|
| Login | Password tidak disimpan. Kamu login sekali, sesinya disimpan di `.profile/`. |
| Lokasi | Harus lokasi asli dari browser. Koordinat palsu sama dengan memalsukan kehadiran. |
| Checkbox *"Saya menyatakan telah meninjau…"* | Pernyataan pribadi; harus kamu yang mencentang. |
| Tombol *Simpan dan Kirim* | Isi laporan jadi tanggung jawabmu, jadi keputusan akhir tetap di kamu. |
| Mengarang isi | Kalau tidak ada data, agent bertanya, bukan menebak. Perusahaan penempatan bisa mencocokkan logbook dengan aktivitas nyata (GitHub, Slack, task board). |

---

## Sumber data

| Sumber | Wajib? | Yang dibaca |
|---|---|---|
| **GitHub** | Disarankan | Events API akunmu: commit yang di-push, PR dibuka/di-merge, approve/request changes, dan komentar diskusi PR pada tanggal itu. Tidak butuh clone lokal. |
| **Balasan Telegram** | Disarankan | Jawabanmu atas pertanyaan jam 21.00. Untuk meeting, diskusi, belajar, WFO. |
| **Claude Code** | Opsional | Pertanyaan yang kamu ketik ke Claude Code hari itu (riwayat lokal `~/.claude/projects`), hanya dari folder di `CLAUDE_CODE_PROJECTS`. Bagus untuk kolom *Pembelajaran* dan *Kendala*. Hanya pesanmu (bukan jawaban Claude), teks tempelan dibuang, dipotong 200 karakter, maksimal 15 per hari, dan **API key / token / password / email disamarkan** sebelum dikirim ke Gemini. Sesi yang memuat pola `CLAUDE_CODE_EXCLUDE` dibuang utuh. |
| **Clone lokal** | Opsional | Commit yang belum di-push (`REPOS`, `GIT_AUTHOR`). |
| **Dokumen** | Opsional | Judul file `.md` di `NOTES_DIRS` yang diubah hari itu. |
| **Latar proyek** (`konteks.md`) | Disarankan | Ringkasan PRD/docs: peran, fitur, istilah, cara kerja tim. Hanya latar supaya tulisan nyambung, **tidak** dihitung sebagai aktivitas. |
| **Catatan manual** | Opsional | `catatan/YYYY-MM-DD.md` |
| **Slack** | Opsional | Pesanmu hari itu (standup, thread tim). Butuh Slack app dengan scope `search:read` yang **disetujui admin workspace**. Jangan mengambil token dari browser. |

---

## Yang perlu disiapkan

| # | Item | Cara dapat |
|---|---|---|
| 1 | **Node.js 20+**, **Git**, **Google Chrome** | nodejs.org, git-scm.com, google.com/chrome |
| 2 | **Gemini API key** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → *Create API key*. Tier gratis cukup. |
| 3 | **Bot Telegram** | Chat **@BotFather** → `/newbot` → salin token. Buka bot barumu dan tekan **Start**. Chat **@userinfobot** untuk mendapatkan chat id. |
| 4 | **Akses GitHub** | Cara termudah: install GitHub CLI lalu `gh auth login` dengan akun kerja. Alternatif: classic token scope `repo` di github.com/settings/tokens → isi `GITHUB_TOKEN`. |
| 5 | **Akun MagangHub** | Login sekali lewat `npm run login`. |
| 6 | **Laptop menyala/sleep** pukul 21.00–23.00 | Jangan shutdown atau hibernate di malam hari kerja. |

---

## Setup (sekali, ±15 menit)

```powershell
git clone <repo ini> monev-autofill
```

```powershell
cd monev-autofill
```

```powershell
npm install
```

```powershell
copy .env.example .env
```

```powershell
notepad .env
```

Isi `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GITHUB_USER`, dan `ROLE` (posisi magangmu). Sisanya opsional.

```powershell
copy konteks.example.md konteks.md
```

```powershell
notepad konteks.md
```

Isi latar proyekmu (peran, fitur, istilah). Cukup sekali, perbarui kalau pindah fitur.

**Tes satu per satu:**

```powershell
npm run test:notify
```

Pesan tes harus masuk ke Telegram. Kalau muncul error `chat not found`, buka bot kamu dan tekan **Start**.

```powershell
npm run login
```

Login ke MagangHub di jendela Chrome yang terbuka, tunggu dashboard tampil, lalu tutup jendelanya.

```powershell
npm run inspect
```

Pastikan tabelnya memuat *Uraian aktivitas*, *Pembelajaran yang diperoleh*, *Kendala yang dialami*, dan *Kehadiran*.

```powershell
npm run collect
```

Cek aktivitas hari ini sudah terbaca (commit, PR/review, dokumen).

```powershell
npm run ask
```

Bot bertanya di Telegram. Balas, lalu:

```powershell
npm run draft -- --redraft
```

Lihat draf yang disusun Gemini.

**Pasang jadwal otomatis (disarankan, tanpa jam tetap):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts
egister-auto.ps1
```

Agent dipicu saat **login**, **laptop dibuka kuncinya**, **Wi-Fi tersambung**, dan **tiap 30 menit**. Ia hanya benar-benar jalan kalau:
- hari kerja, sudah lewat jam 15.00 (ubah dengan `AUTO_START_HOUR` di `.env`), dan ada internet;
- laporan hari itu belum dikirim. Form dibuka sekali; kalau belum dikirim, dibuka lagi 2 jam kemudian (`AUTO_REOPEN_HOURS`) dengan draf yang disusun ulang;
- ada aktivitas. Kalau belum ada, dicek lagi nanti, dan peringatan dikirim sekali mulai jam 21.00.

Saat terpicu, muncul **jendela terminal** berisi draf + lokasi dari Windows, lalu pertanyaan **"Kirim? [y/e/n]"**: `y` mengirim tanpa membuka Chrome, `e` membuka Notepad untuk mengedit, `n` batal (ditanya lagi 2 jam kemudian). Lokasi diambil dari *Windows Location* (Settings → Privacy & security → Location, termasuk "Let desktop apps access your location").

Manual kapan saja: `npm run submit` (atau `npm run submit -- --dry` untuk mencoba semua langkah tanpa menekan Kirim; screenshot di `logs\`).

Cocok untuk WFH dan jam kerja yang tidak tentu. Status harian ada di `drafts\YYYY-MM-DD.status.json`.

**Atau jadwal jam tetap (21.00 tanya, 23.00 isi):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
```

Ganti jam: tambahkan `-AskTime 20:00 -FillTime 21:30`.

**Power Windows:** *Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep → Allow wake timers → Enable*.

---

## Penggunaan sehari-hari

| Situasi | Yang dilakukan |
|---|---|
| Hari kerja biasa | Balas bot jam 21.00, lalu jam 23.00 tinggal tinjau dan submit. |
| Sakit / izin | Balas bot dengan **"izin"** atau **"sakit"**, lalu pilih status dan lampirkan bukti di portal sendiri. |
| Libur nasional / cuti | Tambahkan tanggal ke `OFF_DAYS` di `.env`. |
| Tidak di depan laptop jam 23.00 | Salin teks dari notifikasi Telegram ke portal lewat HP. |
| Notifikasi *"sesi login habis"* | `npm run login`, lalu `npm start` |
| Ingin isi lebih awal | `npm start` kapan saja |
| Mengisi tanggal lain | `npm start -- --date 2026-11-25` |
| Draf kurang pas | Edit `drafts/YYYY-MM-DD.json` (dipakai apa adanya), atau `npm start -- --redraft` |

Log ada di `logs\run.log`, draf di `drafts\`.

---

## Batasan

- **Laptop harus menyala atau sleep.** Kalau laptop mati, jadwal yang terlewat sengaja tidak dikejar agar tanggalnya tidak salah.
- **Pertanyaan Telegram harus dibalas di hari yang sama.** Bot hanya membaca balasan bertanggal hari itu.
- **Events API GitHub** bisa terlambat beberapa menit sampai jam, dan hanya menyimpan 300 event terakhir. Untuk pemakaian harian ini aman.
- **Portal bisa berubah.** Kalau form berubah, jalankan `npm run inspect` lalu sesuaikan label di `src/portal.ts`.
- **Privasi Claude Code.** Pertanyaanmu dikirim ke Gemini. Di tier gratis, Google bisa memakainya untuk perbaikan model. Izinkan hanya folder kerja, dan isi `CLAUDE_CODE_EXCLUDE` untuk topik pribadi.
- **Isi tetap tanggung jawabmu.** Tinjau sebelum submit.
- **Aturan program.** Cek apakah MagangHub melarang pengisian berbantuan alat. Agent ini tidak pernah submit sendiri.

## Struktur

```
src/
  config.ts    konfigurasi .env, tanggal WIB
  collect.ts   menggabungkan semua sumber
  github.ts    GitHub Events API: push → compare, PR, review, komentar
  claudecode.ts riwayat Claude Code lokal: filter, redaksi rahasia
  telegram.ts  membaca balasan Telegram, deteksi "izin/sakit"
  compose.ts   Gemini → 3 kolom (JSON schema, cek ≥100 karakter, retry + model cadangan)
  portal.ts    Playwright: buka Chrome, isi Kehadiran + 3 kolom, berhenti
  notify.ts    Telegram / ntfy
  ask.ts       pertanyaan jam 21.00 (mode laptop)
  phone.ts     mode HP: draf → 4 pesan Telegram (GitHub Actions)
  main.ts      alur jam 23.00
  login.ts     simpan sesi login
  inspect.ts   baca struktur form (read-only)
scripts/register-task.ps1   jadwal Windows Task Scheduler (mode laptop)
scripts/set-secrets.ps1     pasang secrets Mode HP ke GitHub
.github/workflows/monev-phone.yml   jadwal Mode HP
```

## Untuk teman

Setiap orang meng-clone sendiri, mengisi `.env` dan `konteks.md` sendiri (Gemini key, bot Telegram sendiri, username GitHub sendiri), dan login dengan akunnya sendiri. **Jangan berbagi `.env` atau folder `.profile/`**, karena keduanya setara dengan akses ke akunmu.
