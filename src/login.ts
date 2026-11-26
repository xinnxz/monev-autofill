import { monevUrl, openBrowser, waitUntilClosed } from "./portal.js";
import { todayWib } from "./config.js";

// Buka Chrome dengan profil khusus agent. Login sendiri, lalu tutup jendelanya;
// sesi tersimpan di folder .profile dan dipakai saat jadwal berjalan.
const ctx = await openBrowser();
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(monevUrl(todayWib()));
console.log("Silakan login di jendela Chrome yang terbuka, lalu tutup jendelanya setelah dashboard tampil.");
await waitUntilClosed(ctx, 30);
console.log("Sesi disimpan.");
