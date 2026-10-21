# ReefReviver

Game browser 3D low-poly: pemain mengendalikan ROV untuk membersihkan teluk yang tercemar, memulihkan terumbunya, lalu memindai satwa yang kembali. Dibuat untuk lomba, dengan Three.js + Vite + TypeScript.

## Yang sudah bisa dimainkan

- Layar loading dengan progres saat file game dimuat. Kalau ada file yang gagal dimuat, muncul pesan dengan tombol Muat ulang.
- Layar judul dengan pilihan bahasa Indonesia/English. Bahasa awal mengikuti bahasa browser, dan pilihan yang diganti diingat browser.
- Menyelam dengan ROV di teluk yang keruh: kamera orang ketiga dan crosshair di tengah layar. ROV tidak bisa menembus dasar laut, tebing, batu, stasiun daur ulang, atau permukaan air.
- Menyedot sampah dengan Vacuum (tahan klik kiri). Tangki muat 8 item; kalau penuh, setor di stasiun daur ulang dengan E untuk mendapat bahan. Penanda di layar menunjukkan arah stasiun.
- Memotong jaring hantu dengan Cutter (tahan klik kiri pada jaring 2 detik) untuk membebaskan penyu hijau dan hiu sirip hitam karang. Satwa yang bebas terus berkeliaran di teluk.
- Memasang rangka terumbu baja/beton di 3 titik bertanda dengan E (5 bahan), lalu menembakkan bibit dengan Seed launcher: kena rangka jadi fragmen koral, kena petak pasir jadi biji lamun. 3 fragmen menanami satu rangka, 3 biji menanami satu petak.
- The Bloom: begitu kebersihan teluk mencapai 80% dan ketiga rangka serta kedua petak lamun sudah ditanami, dalam ±6 detik air berubah dari keruh hijau-abu ke biru jernih, koral jadi pastel dan membesar, lamun tumbuh tinggi, dan penanda titik tanam memudar (letaknya tetap ada di minimap). Setelah itu ikan badut muncul di anemon dekat rangka, kawanan ikan ekor kuning, pari manta, dan lumba-lumba berenang di teluk, dan Scanner terbuka. Sisa sampah masih bisa disedot.
- Memindai dengan Scanner setelah Bloom (tahan klik kiri pada sasaran 1,5 detik, paling jauh 14 m): penyu, hiu karang, ikan badut, pari manta, lumba-lumba, karang, dan lamun. Tiap sasaran baru membuka satu entri Marine Logbook. Satwa yang masih terjerat harus dibebaskan dulu, dan ikan ekor kuning tidak bisa dipindai.
- Marine Logbook (L): permainan berhenti, entri yang belum dipindai tampil sebagai siluet "???", dan entri yang terbuka berisi nama, fakta, kaitan dengan target SDG 14, serta sumbernya (tautan dibuka di tab baru). L atau Esc menutupnya.
- HUD berisi tangki, bahan, skor, kebersihan teluk, alat aktif, daftar tujuan Fase 1, dan daftar tujuan Fase 2 setelah setoran pertama. Setelah Bloom, kedua daftar itu diganti tujuan Fase 3 (Pindai 0/7).
- Minimap di pojok kanan atas (utara di atas), dengan panel statistik tepat di bawahnya. Peta menampilkan arah ROV, stasiun (kotak), titik terumbu (belah ketupat), petak lamun (lingkaran), dan jaring yang masih menjerat satwa (X). Tanda titik berubah saat rangka terpasang dan saat titik ditanami. Sisa sampah baru tampil sebagai titik setelah kebersihan mencapai 70%.
- Layar Kredit (dari layar judul): anggota tim, aset pihak ketiga, dan kode pihak ketiga beserta lisensinya. Isinya dibaca dari `CREDITS.md` saat build.
- Menu jeda (Esc) berisi Lanjut, Kontrol, dan Bahasa. Game juga otomatis berhenti kalau kursor lepas, misalnya karena alt-tab.
- Di HP/tablet muncul pesan "Mainkan di komputer". Di browser tanpa WebGL 2 muncul penjelasan, bukan layar hitam.

Model 3D masih berupa bentuk sederhana sampai model GLB dari artist masuk.

## Kontrol

| Tombol | Fungsi |
|---|---|
| W A S D | Maju, mundur, geser ke samping |
| Spasi / Shift | Naik / turun |
| Mouse | Mengarahkan ROV |
| Klik kiri (tahan) | Pakai alat |
| 1 | Pilih Cutter |
| 2 | Pilih Vacuum |
| 3 | Pilih Seed launcher |
| 4 | Pilih Scanner (setelah Bloom) |
| E | Setor sampah di stasiun, atau pasang rangka di titik terumbu |
| L | Buka/tutup Marine Logbook |
| Esc | Jeda, atau tutup Logbook |

## Menjalankan

Butuh Node.js 22.12 atau lebih baru, versi genap (22, 24, 26): itu syarat Vitest.

```sh
npm install
npm run dev        # server pengembangan, buka alamat yang muncul di terminal
npm run build      # cek tipe + build statis ke dist/, gagal kalau dist/ lebih dari 50 MB
npm run preview    # coba hasil build
```

Build memakai path relatif, jadi isi `dist/` bisa diunggah ke itch.io (HTML5) atau hosting statis lain, di folder mana pun. Membuka `index.html` langsung dari disk (`file://`) tidak bisa, karena browser memblokir module script di sana. Untuk mencoba build dari sub-folder seperti di hosting: `node scripts/serve-dist.mjs` (melayani `dist/` di `/game/`).

### Model dari artist

Model GLB/glTF diletakkan di `public/assets/` dan didaftarkan di `public/assets/manifest.json` sebagai `{ "id": "rov", "url": "rov.glb" }`. Semua file di daftar itu dimuat sebelum layar judul. Selama daftarnya kosong, game memakai bentuk sederhana. Aset yang bukan buatan tim wajib dicatat di `CREDITS.md` beserta lisensinya.

## Performa

Diukur 2026-10-21 saat adegan terberat (setelah Bloom, semua satwa keluar), 1280×720 dan 1920×1080: Chromium dengan GPU NVIDIA 60 fps, Chromium dengan setelan bawaan (GPU AMD terintegrasi) 54–55 fps, Firefox 157 60 fps. Laptop: AMD Ryzen 7 5800HS, RAM 16 GB, NVIDIA GTX 1650 Mobile + AMD Radeon Vega, Arch Linux (Wayland).

## Tes

```sh
npm test           # unit test (Vitest)
npm run test:e2e   # tes di Chromium sungguhan (Playwright)
npm run test:e2e:dist   # build, lalu mainkan hasil build dari sub-folder /game/
```

Sebelum `test:e2e` pertama kali, pasang Chromium-nya dengan `npx playwright install chromium`. Tes e2e merender WebGL lewat SwiftShader (tanpa GPU), jadi frame rate-nya rendah; tes menunggu ROV bergerak, bukan mengukur waktu.

## Struktur

| Lokasi | Isi |
|---|---|
| `src/config.ts` | Semua angka yang bisa disetel saat playtest (ukuran teluk, kecepatan ROV, kabut, kamera, Bloom, satwa yang kembali, scanner, minimap) |
| `src/i18n/id.json`, `en.json` | Semua teks di game. Kedua file harus punya kunci yang sama |
| `src/logbook/entries.ts` | Data tujuh entri Marine Logbook: nama ilmiah, target SDG 14, dan sumber tiap fakta. Teksnya ada di file string (`logbook.*`) |
| `src/app.ts`, `src/ui/` | Alur layar: loading, judul, kredit, bermain (HUD dan minimap), jeda, Marine Logbook, pesan perangkat/WebGL/gagal muat |
| `src/assets.ts`, `public/assets/manifest.json` | Pemuat model artist dan daftar filenya |
| `CREDITS.md` | Sumber layar Kredit: tim, aset pihak ketiga, kode pihak ketiga dan teks lisensinya |
| `scripts/` | Cek ukuran build dan server lokal untuk mencoba build dari sub-folder |
| `src/game/` | Adegan Three.js dan aturan main: teluk, ROV, tabrakan, kamera, input, sampah, vacuum, stasiun, jaring, satwa, cutter, titik terumbu, seed launcher, Bloom dan satwa yang kembali, scanner, sesi (tangki, skor, kebersihan, tujuan) |
| `tests/unit/`, `tests/e2e/`, `tests/e2e-dist/` | Unit test, tes browser, dan tes hasil build |
