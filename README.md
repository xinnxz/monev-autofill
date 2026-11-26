# monev-autofill

Agent yang menyiapkan **logbook harian MagangHub (monev)** setiap hari kerja. Isinya diambil dari aktivitas kerja yang benar-benar kamu lakukan (GitHub, dokumen, Slack, dan jawabanmu di Telegram), lalu kamu tinggal meninjau dan submit (±20 detik).

> [!IMPORTANT]
> **Proyek komunitas, tidak berafiliasi dengan Kemnaker maupun MagangHub.**
> Agent ini **hanya membantu menyiapkan isian**. Ia tidak pernah mencentang pernyataan, mengisi lokasi, atau menekan *Kirim*, dan tidak mengarang aktivitas.
> Isi laporan sepenuhnya tanggung jawab peserta. Pastikan penggunaannya tidak melanggar ketentuan program dan perusahaan penempatanmu.
> Mohon jangan memodifikasinya untuk submit otomatis, memalsukan lokasi, atau mengisi aktivitas yang tidak dilakukan. Itu termasuk pelanggaran yang bisa berujung dikeluarkan dari program.

## Cara kerja

```
21.00 Senin–Jumat ── Bot Telegram: "hari ini ngapain aja?"
                     + ringkasan yang sudah tercatat otomatis
                     → kamu balas 1–2 baris (atau "izin" / "sakit")

23.00 Senin–Jumat
  ├─ 1. Cek hari    → Sabtu/Minggu, OFF_DAYS, balasan "izin/sakit",
  │                   atau "Jadwal libur posisi" di portal → berhenti
  ├─ 2. Kumpulkan   → GitHub: commit, PR dibuka/di-merge, review, diskusi PR
  │                   clone lokal (opsional), dokumen catatan yang berubah,
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

**Pasang jadwal (21.00 tanya, 23.00 isi):**

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
- **Isi tetap tanggung jawabmu.** Tinjau sebelum submit.
- **Aturan program.** Cek apakah MagangHub melarang pengisian berbantuan alat. Agent ini tidak pernah submit sendiri.

## Struktur

```
src/
  config.ts    konfigurasi .env, tanggal WIB
  collect.ts   menggabungkan semua sumber
  github.ts    GitHub Events API: push → compare, PR, review, komentar
  telegram.ts  membaca balasan Telegram, deteksi "izin/sakit"
  compose.ts   Gemini → 3 kolom (JSON schema, cek ≥100 karakter, retry + model cadangan)
  portal.ts    Playwright: buka Chrome, isi Kehadiran + 3 kolom, berhenti
  notify.ts    Telegram / ntfy
  ask.ts       pertanyaan jam 21.00
  main.ts      alur jam 23.00
  login.ts     simpan sesi login
  inspect.ts   baca struktur form (read-only)
scripts/register-task.ps1   jadwal Windows Task Scheduler
```

## Untuk teman

Setiap orang meng-clone sendiri, mengisi `.env` dan `konteks.md` sendiri (Gemini key, bot Telegram sendiri, username GitHub sendiri), dan login dengan akunnya sendiri. **Jangan berbagi `.env` atau folder `.profile/`**, karena keduanya setara dengan akses ke akunmu.
