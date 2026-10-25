# ReefReviver

Game browser 3D low-poly: pemain mengemudikan kapal selam mini untuk membersihkan teluk yang tercemar, memulihkan terumbunya, lalu memindai satwa yang kembali. Dibuat untuk lomba, dengan Three.js + Vite + TypeScript.

## Yang sudah bisa dimainkan

- Layar loading dengan progres saat file game dimuat. Kalau ada file yang gagal dimuat, muncul pesan dengan tombol Muat ulang.
- Layar judul dengan pilihan bahasa Indonesia/English. Bahasa awal mengikuti bahasa browser, dan pilihan yang diganti diingat browser.
- Sinematik pembuka (±32 detik) setelah Mulai pertama sejak halaman dibuka: kamera memperlihatkan pesisir barat dan sampah yang mengapung dari ketinggian, melayang rendah melewati sampah apung, lalu dengan potongan layar memudar memperlihatkan sekelompok sampah di dasar laut, penyu yang meronta di jaring hantu, dan berakhir di belakang kapal selam. Tiga kalimat narasi muncul di pita hitam bawah, HUD disembunyikan, dan klik atau Spasi melewatinya. Main lagi langsung bermain; refresh memutarnya lagi. Waktu bermain dihitung setelah sinematik.
- Menyelam dengan kapal selam mini berawak (berkubah kaca dengan pilot di dalamnya) di teluk yang keruh selebar ±300 m: dasarnya naik turun dengan bukit, lembah pasir, bongkahan batu tak beraturan dengan puncak dan sisi miring, dan lengkungan batu, dari ±8 m sampai ±25 m di bawah permukaan. Sisi barat berupa pantai yang naik ke daratan, diapit tanjung batu di kedua ujungnya; ke utara, timur, dan selatan laut terbuka sampai cakrawala, dengan dasar yang menurun ke laut dalam di luar area penyelaman. Di tepi area penyelaman (±147 m dari tengah) kapal melambat lalu berhenti di batas tak terlihat, dan muncul pesan "Batas area penyelaman" selama 2 detik. Kamera orang ketiga dan crosshair di tengah layar. Kapal selam bisa naik sampai permukaan dan mengapung dengan kubah kokpit di atas air, bergoyang pelan; kamera ikut keluar dari air, dan tampilannya berganti antara bawah air dan atas air tanpa berkedip di garis air. Kapal selam mulai di laut dekat dermaga di pantai barat, menghadap ke timur. Kapal selam tidak bisa menembus dasar laut, lereng, batu, tanjung, pantai, tiang dermaga, atau permukaan air, tapi bisa lewat di bawah lengkungan batu. Kamera mendekat ke kapal selam kalau di belakangnya ada lereng, batu, atau dinding.
- Naik ke darat: di air dangkal sekitar 10 m dari pantai barat, E membawa pemain ke pantai dengan sudut pandang orang pertama (layar memudar sebentar). Kapal selam ditinggal terapung di dekat pantai. Di darat ada langit bergradasi dengan awan yang bergerak pelan dan matahari yang berpendar (dibuat dengan shader), permukaan laut yang bergelombang dengan kilau matahari, pohon kelapa, batu, rumput yang bergoyang tertiup angin (mulai ±8 m dari tepi air sampai kaki tebing; dekat air tetap pasir), dan laut yang terlihat dari atas: keruh sebelum Bloom, biru jernih sesudahnya. Dari bawah air, permukaannya terlihat beriak. Pemain berjalan dengan WASD dan menengok dengan mouse, tanpa lari atau lompat, dan berhenti di tepi air, di tebing barat, di tanjung batu di kedua ujung pantai, di gudang, serta di pohon dan batu; dermaga bisa dipijak sampai ujungnya. Alat tidak bisa dipakai di darat dan panelnya disembunyikan. E di dekat kapal selam (±3,5 m) membawa pemain kembali ke dalamnya. Di minimap, panah menunjukkan pemain dan kapal selam punya tandanya sendiri.
- Menyedot sampah dengan Vacuum (tahan klik kiri). Sekitar 60 sampah tersebar dalam kelompok-kelompok kecil: 44 di dasar laut, 8 mengapung di permukaan, dan 8 di pasir pantai. Sampah apung (hanya botol dan kantong plastik) bergoyang di tempatnya dalam 2–3 kelompok, salah satunya cukup dekat pantai sehingga terlihat dari darat. Sampah ini disedot Vacuum dari kapal yang mengapung atau dari bawah permukaan. Sampah di pasir pantai barat terletak sampai ±7 m dari tepi air, dan hanya bisa dipungut dengan berjalan kaki: bidik dengan crosshair dari jarak ≤3 m lalu tekan E (Vacuum tidak bisa menyedotnya). Sampah yang dipungut masuk tangki yang sama dan ikut dihitung dalam kebersihan. Tangki muat 12 item; kalau penuh, naik ke darat dan setor di loket gudang daur ulang dengan E untuk mendapat bahan (E di bawah laut tidak pernah menyetor). Gudangnya berdiri di pantai barat dekat dermaga kayu, bersuar di atap dan bertanda cincin kuning di depan loket. Penanda di layar menunjukkan arah dan jarak gudang, dan tidak pernah menutupi panel HUD atau pesan.
- Setiap sesi baru (Mulai, Main lagi, atau refresh), 2 jaring, 3 titik terumbu, 2 petak lamun, dan sekitar 60 sampah ditaruh di tempat lain: titik-titiknya dipilih acak dari titik calon yang sudah dipastikan layak, dan selalu tersebar di minimal 3 perempat teluk. Gudang, dermaga, titik mulai, medan, dan goa tidak berubah.
- Memotong jaring hantu dengan Cutter (tahan klik kiri pada jaring 2 detik) untuk membebaskan penyu hijau dan hiu sirip hitam karang. Satwa yang bebas terus berkeliaran di teluk.
- Memasang rangka terumbu baja/beton di 3 titik bertanda dengan E (5 bahan), lalu menembakkan bibit dengan Seed launcher: kena rangka jadi fragmen koral, kena petak pasir jadi biji lamun. Kelima titik calon petak lamun ada di dataran pasir dangkal depan pantai barat (±4 m), di sela padang lamun alami. 3 fragmen menanami satu rangka, 3 biji menanami satu petak.
- The Bloom: begitu kebersihan teluk mencapai 80% dan ketiga rangka serta kedua petak lamun sudah ditanami, dalam ±6 detik air berubah dari keruh hijau-abu ke biru jernih, koral berwarna merah muda, oker, ungu, hijau laut, krem, dan biru; fragmen tanam membesar, lamun tumbuh tinggi, dan penanda titik tanam memudar (letaknya tetap ada di minimap). Setelah itu ikan badut muncul di anemon dekat rangka, kawanan ikan ekor kuning, pari manta, dan lumba-lumba berenang di teluk, dan Scanner terbuka. Sisa sampah masih bisa disedot. Selama transisi ini kendali berhenti dan kamera menjauh memperlihatkan teluk yang berubah: di bawah air mengitari terumbu di sekitar pemain, di permukaan atau di darat naik memperlihatkan laut yang membiru, dan di dalam goa tetap di lorong. Klik atau Spasi mengembalikan kendali lebih cepat.
- Goa: lorong tembus sepanjang 35 m di bukit batu timur laut, dengan dua mulut. Di dalamnya gelap kecuali berkas cahaya dari lubang kecil di atap, dan ada 6 dari 60 sampah. Lampu depan kapal selam menyala sendiri di dalam goa dan padam di luar. Dinding, lantai, dan atap goa padat bagi kapal maupun kamera, dan lubang atapnya terlalu sempit untuk dilewati. Di minimap kedua mulutnya tampil sebagai lengkung dan lorongnya sebagai garis samar.
- Terumbu alami: sabuk terumbu karang di tepi dataran dangkal barat (sedalam 7–12,5 m, terlihat dari titik mulai) dan 10 gosong karang di puncak bukit, batu besar, dan lengkungan batu, berisi ribuan koloni karang meja, bercabang, otak, dan jari (0,4–2,1 m, dengan koloni besar ditempatkan lebih dahulu) serta 5 bongkah *Porites* besar; lembah pasir yang dalam hampir kosong. Alga tropis (rumpun hijau *Halimeda*, kipas *Padina*, semak cokelat *Sargassum*) tumbuh di batu dan dataran dangkal, spons tong menempel di batu dan lereng, dan kipas laut berdiri tegak di batu besar, lengkungan batu, dan lereng yang lebih dalam dari 10 m, semuanya menghadap arus yang sama; hiasan tidak pernah menutupi sampah. Padang lamun tumbuh rapat di dataran pasir dangkal depan pantai barat (10 padang, sedalam 1–7 m), dengan daun pita yang bergoyang oleh arus, pasir kehijauan di bawahnya, dan rumpun *Enhalus* yang lebih tinggi di bagian paling dangkal. Sebelum Bloom karangnya pucat, lamunnya jarang dan cokelat, dan spons serta kipas lautnya kusam; selama Bloom karang berubah warna-warni, lamun tumbuh lebat dan hijau, dan hiasan berwarna, lalu berkas sinar cahaya masuk dari permukaan. Sabuk, gosong, dan bongkah karang padat seperti batu (kapal bisa melayang di atasnya), hiasan kecil bisa dilewati, dan bibit yang mengenai karang atau padang lamun alami hilang tanpa dihitung.
- Memindai dengan Scanner setelah Bloom (tahan klik kiri pada sasaran 1,5 detik, paling jauh 14 m): penyu, hiu karang, ikan badut, pari manta, lumba-lumba, karang, dan lamun. Tiap sasaran baru membuka satu entri Marine Logbook; karang dan padang lamun alami juga membuka entri Karang dan Lamun. Lamun (alami maupun yang ditanam) dipindai dengan membidik dasarnya, jadi bisa dari samping maupun dari tepat di atasnya. Satwa yang masih terjerat harus dibebaskan dulu, dan ikan ekor kuning tidak bisa dipindai.
- Marine Logbook (L): permainan berhenti, entri yang belum dipindai tampil sebagai siluet "???", dan entri yang terbuka berisi nama, fakta, kaitan dengan target SDG 14, serta sumbernya (tautan dibuka di tab baru). L atau Esc menutupnya.
- Sinematik penutup (±18,5 detik), sekitar 3 detik setelah entri ketujuh: kamera terbang di atas terumbu yang pulih, kawanan ikan, pari manta, dan lumba-lumba, lalu naik ke permukaan memperlihatkan pantai, dengan kalimat "Teluk ini hidup kembali." Klik atau Spasi langsung ke layar akhir.
- Layar akhir: setelah sinematik penutup (yang dimulai sekitar 3 detik setelah entri ketujuh terpindai), tampil ringkasan sesi (sampah terangkat, satwa diselamatkan, rangka koral dan petak lamun yang ditanami, waktu bermain, skor). Waktu bermain dihitung dari Mulai sampai entri ketujuh, tanpa waktu jeda dan saat Logbook terbuka. Main lagi memulai sesi baru dengan bahasa yang sama; Lanjut menjelajah kembali ke teluk yang sudah pulih.
- HUD berisi tangki, bahan, skor, kebersihan teluk, alat aktif, daftar tujuan Fase 1, dan daftar tujuan Fase 2 setelah setoran pertama. Setelah Bloom, kedua daftar itu diganti tujuan Fase 3 (Pindai 0/7).
- Minimap di pojok kanan atas (utara di atas), dengan panel statistik tepat di bawahnya. Peta menampilkan seluruh teluk: daratan di barat beserta tanjungnya, garis tipis tepi area penyelaman, dan dasar laut yang makin terang di bagian yang makin dangkal (puncak bukit), lalu arah kapal selam (atau pemain saat di darat), gudang daur ulang (kotak), dermaga (garis), titik terumbu (belah ketupat), petak lamun (lingkaran), dan jaring yang masih menjerat satwa (X). Tanda titik berubah saat rangka terpasang dan saat titik ditanami. Sisa sampah baru tampil sebagai titik setelah kebersihan mencapai 70%.
- Layar Kredit (dari layar judul): anggota tim, aset pihak ketiga, dan kode pihak ketiga beserta lisensinya. Isinya dibaca dari `CREDITS.md` saat build.
- Suara: di bawah air terdengar gemuruh laut dan gelembung, di atas air dan di darat ombak dan angin. Setiap aksi punya efek suara (Vacuum, sampah masuk tangki, tangki penuh, memotong jaring, satwa bebas, tembakan bibit, titik tertanam, Scanner, entri Logbook baru, setor, memungut sampah, langkah di pasir dan dermaga, keluar/masuk kapal, tombol menu, Bloom). Semua efek dibuat dengan Web Audio di kode (`src/audio/`), tanpa file. Musik latar "Underwater Ambient Pad" (isaiah658, CC0) diputar berulang: teredam sebelum Bloom, lalu jernih. Suara baru mulai setelah Mulai ditekan. M mematikan/menyalakan suara; volume musik dan efek diatur di menu jeda (awal 60% dan 80%), dan kembali ke awal setelah refresh. Saat jeda, Logbook, dan layar akhir hanya musik yang terdengar, lebih pelan. Kalau musik gagal dimuat (mis. Safari yang tidak bisa memutar OGG) atau browser tidak punya Web Audio, game tetap jalan tanpa musik atau tanpa suara.
- Menu jeda (Esc) berisi Lanjut, Kontrol, Bahasa, dan Suara. Game juga otomatis berhenti kalau kursor lepas, misalnya karena alt-tab.
- Di HP/tablet muncul pesan "Mainkan di komputer". Di browser tanpa WebGL 2 muncul penjelasan, bukan layar hitam.

Model 3D memakai gaya low-poly; model GLB dari artist bisa menggantikan aset buatan kode. Batu besar menggunakan permukaan yang sama untuk gambar, tabrakan, dan tempat menempel biota. Karang alami memiliki dua variasi bentuk per jenis: cabang dengan percabangan tidak seragam, lempeng tipis bertumpuk dengan tepian bergelombang, bongkah berlekuk, dan jari bercabang. Koloni kecil mengisi sela di antara koloni besar; warna berkelompok dengan pangkal lebih gelap dan ujung lebih terang. Kipas laut bercabang terbuka, spons memiliki bibir tebal dan rongga gelap, dan sinar bawah air memudar lembut di tepinya.

## Kontrol

| Tombol | Fungsi |
|---|---|
| W A S D | Maju, mundur, geser ke samping; di darat: berjalan |
| Spasi / Shift | Naik / turun; Spasi sampai mengapung di permukaan |
| Mouse | Mengarahkan kapal selam; di darat: menengok |
| Klik kiri (tahan) | Pakai alat |
| 1 | Pilih Cutter |
| 2 | Pilih Vacuum |
| 3 | Pilih Seed launcher |
| 4 | Pilih Scanner (setelah Bloom) |
| E | Pasang rangka di titik terumbu, naik ke darat di dekat pantai barat; di darat: pungut sampah di pasir yang dibidik, setor sampah di loket gudang daur ulang, atau masuk kapal selam |
| L | Buka/tutup Marine Logbook |
| M | Matikan atau nyalakan suara |
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

Diukur 2026-10-23 setelah peta diperluas (REQ-011), saat adegan terberat (setelah Bloom, semua satwa keluar) di dua titik terpadat, 1280×720 dan 1920×1080: Chromium dengan GPU NVIDIA 60 fps, Chromium dengan GPU AMD terintegrasi 60 fps, Firefox 60 fps. Medan terdiri dari 16 potongan (34.848 segitiga), dan potongan di luar pandangan tidak digambar. Rumput di darat (REQ-018) berupa satu instanced mesh berisi 29.463 helai, digoyang angin di shader; diukur di darat setelah Bloom dengan Chromium NVIDIA, tetap 60 fps. Setelah karang dan lamun mengikuti riset (REQ-019, REQ-020), satu layar bisa berisi ±900 ribu segitiga; diukur 2026-10-23 setelah Bloom di titik mulai, di sabuk karang terpadat, dan di atas padang lamun, 1280×720 dan 1920×1080: Chromium NVIDIA dan Chromium AMD terintegrasi tetap 60 fps. Laptop: AMD Ryzen 7 5800HS, RAM 16 GB, NVIDIA GTX 1650 Mobile + AMD Radeon Vega, Arch Linux (Wayland).

Setelah revisi visual 2026-10-24 (batu tak beraturan, ±3.300 koloni karang dengan dua variasi bentuk per jenis, hiasan baru), satu layar bisa berisi ±1 juta segitiga dan ±370 draw call; diukur setelah Bloom di titik mulai, di sabuk karang terpadat, dan di atas padang lamun, 1280×720 dan 1920×1080: Chromium NVIDIA dan Chromium AMD terintegrasi tetap 60 fps, dan di darat 60 fps. Build 1,42 MB.

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
| `src/audio/`, `public/assets/audio/` | Suara (REQ-026): mesin Web Audio, resep efek dan suasana yang dibuat kode, dan file musik latar. Volume dan nada tiap efek ada di `config.audio` |
| `CREDITS.md` | Sumber layar Kredit: tim, aset pihak ketiga, kode pihak ketiga dan teks lisensinya |
| `scripts/` | Cek ukuran build dan server lokal untuk mencoba build dari sub-folder |
| `src/game/` | Adegan Three.js dan aturan main: medan teluk (`terrain.ts`: bukit, lembah, pantai, tanjung, laut dalam di luar area, batas area penyelaman), batu besar dan lengkungan batu, kapal selam (di kode disebut ROV), daratan dan berjalan (`land.ts`), tabrakan, kamera, input, sampah, vacuum, gudang daur ulang dan dermaga, jaring, satwa, cutter, titik terumbu, seed launcher, Bloom dan satwa yang kembali, scanner, sesi (tangki, skor, kebersihan, tujuan) |
| `tests/unit/`, `tests/e2e/`, `tests/e2e-dist/` | Unit test, tes browser, dan tes hasil build |
