# ReefReviver

Game browser 3D low-poly: pemain mengendalikan ROV untuk membersihkan teluk yang tercemar, memulihkan terumbunya, lalu memindai satwa yang kembali. Dibuat untuk lomba, dengan Three.js + Vite + TypeScript.

## Yang sudah bisa dimainkan

- Layar judul dengan pilihan bahasa Indonesia/English. Bahasa awal mengikuti bahasa browser, dan pilihan yang diganti diingat browser.
- Menyelam dengan ROV di teluk yang keruh: kamera orang ketiga dan crosshair di tengah layar. ROV tidak bisa menembus dasar laut, tebing, batu, batas teluk, atau permukaan air.
- Menu jeda (Esc) berisi Lanjut, Kontrol, dan Bahasa. Game juga otomatis berhenti kalau kursor lepas, misalnya karena alt-tab.
- Di HP/tablet muncul pesan "Mainkan di komputer". Di browser tanpa WebGL 2 muncul penjelasan, bukan layar hitam.

Model 3D masih berupa bentuk sederhana sampai model GLB dari artist masuk.

## Kontrol

| Tombol | Fungsi |
|---|---|
| W A S D | Maju, mundur, geser ke samping |
| Spasi / Shift | Naik / turun |
| Mouse | Mengarahkan ROV |
| Esc | Jeda |

## Menjalankan

Butuh Node.js 22.12 atau lebih baru, versi genap (22, 24, 26): itu syarat Vitest.

```sh
npm install
npm run dev        # server pengembangan, buka alamat yang muncul di terminal
npm run build      # cek tipe + build statis ke dist/
npm run preview    # coba hasil build
```

## Tes

```sh
npm test           # unit test (Vitest)
npm run test:e2e   # tes di Chromium sungguhan (Playwright)
```

Sebelum `test:e2e` pertama kali, pasang Chromium-nya dengan `npx playwright install chromium`. Tes e2e merender WebGL lewat SwiftShader (tanpa GPU), jadi frame rate-nya rendah; tes menunggu ROV bergerak, bukan mengukur waktu.

## Struktur

| Lokasi | Isi |
|---|---|
| `src/config.ts` | Semua angka yang bisa disetel saat playtest (ukuran teluk, kecepatan ROV, kabut, kamera) |
| `src/i18n/id.json`, `en.json` | Semua teks di game. Kedua file harus punya kunci yang sama |
| `src/app.ts`, `src/ui/` | Alur layar: judul, bermain, jeda, pesan perangkat/WebGL |
| `src/game/` | Adegan Three.js: teluk, ROV, tabrakan, kamera, input |
| `tests/unit/`, `tests/e2e/` | Unit test dan tes browser |
