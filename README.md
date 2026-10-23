# ReefReviver

Game browser 3D low-poly: pemain mengemudikan kapal selam mini untuk membersihkan teluk yang tercemar, memulihkan terumbunya, lalu memindai satwa yang kembali. Dibuat untuk lomba, dengan Three.js + Vite + TypeScript.

## Yang sudah bisa dimainkan

- Layar loading dengan progres saat file game dimuat. Kalau ada file yang gagal dimuat, muncul pesan dengan tombol Muat ulang.
- Layar judul dengan pilihan bahasa Indonesia/English. Bahasa awal mengikuti bahasa browser, dan pilihan yang diganti diingat browser.
- Menyelam dengan kapal selam mini berawak (berkubah kaca dengan pilot di dalamnya) di teluk yang keruh selebar ±300 m: dasarnya naik turun dengan bukit, lembah pasir, batu besar bertingkat yang berpuncak datar, dan lengkungan batu, dari ±8 m sampai ±25 m di bawah permukaan. Sisi barat berupa pantai yang naik ke daratan, sisi lain ditutup dinding batu. Kamera orang ketiga dan crosshair di tengah layar. Kapal selam mulai di laut dekat dermaga di pantai barat, menghadap ke timur. Kapal selam tidak bisa menembus dasar laut, lereng, batu, dinding batu, pantai, tiang dermaga, atau permukaan air, tapi bisa lewat di bawah lengkungan batu. Kamera mendekat ke kapal selam kalau di belakangnya ada lereng, batu, atau dinding.
- Naik ke darat: di air dangkal sekitar 10 m dari pantai barat, E membawa pemain ke pantai dengan sudut pandang orang pertama (layar memudar sebentar). Kapal selam ditinggal terapung di dekat pantai. Di darat ada langit, matahari, pohon kelapa, batu, dan laut yang terlihat dari atas: keruh sebelum Bloom, biru jernih sesudahnya. Pemain berjalan dengan WASD dan menengok dengan mouse, tanpa lari atau lompat, dan berhenti di tepi air, di tebing barat, di dinding batu, di gudang, serta di pohon dan batu; dermaga bisa dipijak sampai ujungnya. Alat tidak bisa dipakai di darat dan panelnya disembunyikan. E di dekat kapal selam (±3,5 m) membawa pemain kembali ke dalamnya. Di minimap, panah menunjukkan pemain dan kapal selam punya tandanya sendiri.
- Menyedot sampah dengan Vacuum (tahan klik kiri). Sekitar 60 sampah tersebar dalam kelompok-kelompok kecil. Tangki muat 12 item; kalau penuh, naik ke darat dan setor di loket gudang daur ulang dengan E untuk mendapat bahan (E di bawah laut tidak pernah menyetor). Gudangnya berdiri di pantai barat dekat dermaga kayu, bersuar di atap dan bertanda cincin kuning di depan loket. Penanda di layar menunjukkan arah dan jarak gudang, dan tidak pernah menutupi panel HUD atau pesan.
- Setiap sesi baru (Mulai, Main lagi, atau refresh), 2 jaring, 3 titik terumbu, 2 petak lamun, dan sekitar 60 sampah ditaruh di tempat lain: titik-titiknya dipilih acak dari titik calon yang sudah dipastikan layak, dan selalu tersebar di minimal 3 perempat teluk. Gudang, dermaga, titik mulai, medan, dan goa tidak berubah.
- Memotong jaring hantu dengan Cutter (tahan klik kiri pada jaring 2 detik) untuk membebaskan penyu hijau dan hiu sirip hitam karang. Satwa yang bebas terus berkeliaran di teluk.
- Memasang rangka terumbu baja/beton di 3 titik bertanda dengan E (5 bahan), lalu menembakkan bibit dengan Seed launcher: kena rangka jadi fragmen koral, kena petak pasir jadi biji lamun. 3 fragmen menanami satu rangka, 3 biji menanami satu petak.
- The Bloom: begitu kebersihan teluk mencapai 80% dan ketiga rangka serta kedua petak lamun sudah ditanami, dalam ±6 detik air berubah dari keruh hijau-abu ke biru jernih, koral jadi pastel dan membesar, lamun tumbuh tinggi, dan penanda titik tanam memudar (letaknya tetap ada di minimap). Setelah itu ikan badut muncul di anemon dekat rangka, kawanan ikan ekor kuning, pari manta, dan lumba-lumba berenang di teluk, dan Scanner terbuka. Sisa sampah masih bisa disedot.
- Terumbu alami: sekitar 30 gugusan karang di puncak batu besar, di lengkungan batu, dan di lereng, serta 11 padang lamun di dasar pasir, ditambah spons, kipas laut, dan alga. Sebelum Bloom karangnya pucat dan lamunnya jarang dan cokelat; selama Bloom karang berubah warna-warni dan lamun tumbuh lebat dan hijau, lalu berkas sinar cahaya masuk dari permukaan. Gugusan karang padat seperti batu, hiasan kecil bisa dilewati, dan bibit yang mengenai karang atau padang lamun alami hilang tanpa dihitung.
- Memindai dengan Scanner setelah Bloom (tahan klik kiri pada sasaran 1,5 detik, paling jauh 14 m): penyu, hiu karang, ikan badut, pari manta, lumba-lumba, karang, dan lamun. Tiap sasaran baru membuka satu entri Marine Logbook; karang dan padang lamun alami juga membuka entri Karang dan Lamun. Satwa yang masih terjerat harus dibebaskan dulu, dan ikan ekor kuning tidak bisa dipindai.
- Marine Logbook (L): permainan berhenti, entri yang belum dipindai tampil sebagai siluet "???", dan entri yang terbuka berisi nama, fakta, kaitan dengan target SDG 14, serta sumbernya (tautan dibuka di tab baru). L atau Esc menutupnya.
- Layar akhir: sekitar 3 detik setelah entri ketujuh terpindai, tampil ringkasan sesi (sampah terangkat, satwa diselamatkan, rangka koral dan petak lamun yang ditanami, waktu bermain, skor). Waktu bermain dihitung dari Mulai sampai entri ketujuh, tanpa waktu jeda dan saat Logbook terbuka. Main lagi memulai sesi baru dengan bahasa yang sama; Lanjut menjelajah kembali ke teluk yang sudah pulih.
- HUD berisi tangki, bahan, skor, kebersihan teluk, alat aktif, daftar tujuan Fase 1, dan daftar tujuan Fase 2 setelah setoran pertama. Setelah Bloom, kedua daftar itu diganti tujuan Fase 3 (Pindai 0/7).
- Minimap di pojok kanan atas (utara di atas), dengan panel statistik tepat di bawahnya. Peta menampilkan seluruh teluk: daratan di barat, dinding batu, dan dasar laut yang makin terang di bagian yang makin dangkal (puncak bukit), lalu arah kapal selam (atau pemain saat di darat), gudang daur ulang (kotak), dermaga (garis), titik terumbu (belah ketupat), petak lamun (lingkaran), dan jaring yang masih menjerat satwa (X). Tanda titik berubah saat rangka terpasang dan saat titik ditanami. Sisa sampah baru tampil sebagai titik setelah kebersihan mencapai 70%.
- Layar Kredit (dari layar judul): anggota tim, aset pihak ketiga, dan kode pihak ketiga beserta lisensinya. Isinya dibaca dari `CREDITS.md` saat build.
- Menu jeda (Esc) berisi Lanjut, Kontrol, dan Bahasa. Game juga otomatis berhenti kalau kursor lepas, misalnya karena alt-tab.
- Di HP/tablet muncul pesan "Mainkan di komputer". Di browser tanpa WebGL 2 muncul penjelasan, bukan layar hitam.

Model 3D masih berupa bentuk sederhana sampai model GLB dari artist masuk.

## Kontrol

| Tombol | Fungsi |
|---|---|
| W A S D | Maju, mundur, geser ke samping; di darat: berjalan |
| Spasi / Shift | Naik / turun |
| Mouse | Mengarahkan kapal selam; di darat: menengok |
| Klik kiri (tahan) | Pakai alat |
| 1 | Pilih Cutter |
| 2 | Pilih Vacuum |
| 3 | Pilih Seed launcher |
| 4 | Pilih Scanner (setelah Bloom) |
| E | Pasang rangka di titik terumbu, naik ke darat di dekat pantai barat; di darat: setor sampah di loket gudang daur ulang, atau masuk kapal selam |
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

### Hosting di Vercel

Repo ini bisa langsung diimpor di Vercel (Add New → Project → pilih repo GitHub-nya), tanpa mengubah setelan apa pun. `vercel.json` menetapkan install `npm ci`, build `npm run build` (termasuk cek tipe dan batas 50 MB), dan hasilnya di `dist/`. Node.js bawaan Vercel (24.x) sudah cukup. Setiap push ke `main` menjadi deploy produksi, dan push ke branch lain mendapat URL pratinjau sendiri.

### Model dari artist

Model GLB/glTF diletakkan di `public/assets/` dan didaftarkan di `public/assets/manifest.json` sebagai `{ "id": "rov", "url": "rov.glb" }`. Semua file di daftar itu dimuat sebelum layar judul. Model yang tidak ada di daftar dibangun dari kode. `npm run generate:assets` mengekspor model buatan kode ke `public/assets/models/` dan menulis ulang seluruh `manifest.json`, jadi model artist yang sudah terdaftar perlu didaftarkan lagi setelahnya. Aset yang bukan buatan tim wajib dicatat di `CREDITS.md` beserta lisensinya.

## Performa

Diukur 2026-10-23 setelah peta diperluas (REQ-011), saat adegan terberat (setelah Bloom, semua satwa keluar) di dua titik terpadat, 1280×720 dan 1920×1080: Chromium dengan GPU NVIDIA 60 fps, Chromium dengan GPU AMD terintegrasi 60 fps, Firefox 60 fps. Medan terdiri dari 16 potongan (34.848 segitiga), dan potongan di luar pandangan tidak digambar. Laptop: AMD Ryzen 7 5800HS, RAM 16 GB, NVIDIA GTX 1650 Mobile + AMD Radeon Vega, Arch Linux (Wayland).

## Tes

```sh
npm test           # unit test (Vitest)
npm run test:e2e   # tes di Chromium sungguhan (Playwright)
npm run test:e2e:dist   # build, lalu mainkan hasil build dari sub-folder /game/
```

Sebelum `test:e2e` pertama kali, pasang Chromium-nya dengan `npx playwright install chromium`. Tes e2e merender WebGL di GPU lewat ANGLE Vulkan. Di komputer tanpa GPU yang bisa dipakai, jalankan dengan `E2E_SWIFTSHADER=1` supaya WebGL dirender CPU lewat SwiftShader; cara ini jauh lebih lambat dan membuat CPU sibuk penuh selama tes. Tes menunggu ROV bergerak, bukan mengukur waktu. Server dev untuk tes e2e memakai seed tetap (`VITE_TEST_SEED=1`), jadi susunan jaring, titik tanam, dan sampah sama di setiap run. Paling banyak 4 browser berjalan bersamaan; lebih dari itu, halaman peta besar jadi terlalu lambat untuk tes yang menunggu waktu.

## Struktur

| Lokasi | Isi |
|---|---|
| `src/config.ts` | Semua angka yang bisa disetel saat playtest (ukuran dan bentuk teluk: bukit, lembah, pantai, dinding, batu besar, lengkungan; kecepatan kapal selam, kabut, kamera, daratan dan cara berjalan, Bloom, satwa yang kembali, scanner, minimap) |
| `src/i18n/id.json`, `en.json` | Semua teks di game. Kedua file harus punya kunci yang sama |
| `src/logbook/entries.ts` | Data tujuh entri Marine Logbook: nama ilmiah, target SDG 14, dan sumber tiap fakta. Teksnya ada di file string (`logbook.*`) |
| `src/app.ts`, `src/ui/` | Alur layar: loading, judul, kredit, bermain (HUD dan minimap), jeda, Marine Logbook, pesan perangkat/WebGL/gagal muat |
| `src/assets.ts`, `public/assets/manifest.json` | Pemuat model artist dan daftar filenya |
| `CREDITS.md` | Sumber layar Kredit: tim, aset pihak ketiga, kode pihak ketiga dan teks lisensinya |
| `scripts/` | Cek ukuran build dan server lokal untuk mencoba build dari sub-folder |
| `src/game/` | Adegan Three.js dan aturan main: medan teluk (`terrain.ts`: bukit, lembah, pantai, dinding batu), batu besar dan lengkungan batu, kapal selam (di kode disebut ROV), daratan dan berjalan (`land.ts`), tabrakan, kamera, input, sampah, vacuum, gudang daur ulang dan dermaga, jaring, satwa, cutter, titik terumbu, seed launcher, Bloom dan satwa yang kembali, scanner, sesi (tangki, skor, kebersihan, tujuan) |
| `tests/unit/`, `tests/e2e/`, `tests/e2e-dist/` | Unit test, tes browser, dan tes hasil build |
