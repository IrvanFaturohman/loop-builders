# Loop Builders — Tebang & Bangun

Game web 3D idle/clicker satu tangan (Vite + TypeScript + Three.js), mengikuti gaya *Train Miner: Idle Railway* (Flexus/Azur Games) dengan satu perbedaan besar: **hasil tebangan tidak dijual, tetapi dipakai membangun kota**.

Pulau di tengah laut, berupa hutan voxel persegi yang tersusun rapi dalam baris-baris dan dikelilingi pantai pasir, dengan kota kecil di tengahnya. Sebuah kereta (lokomotif, satu gerbong muatan, lalu gerbong pemotong) berjalan di rel yang mengelilingi kota, **hanya selama pemain menahan atau mengetuk layar**. Gerinda horizontal yang menempel di sisi kiri tiap pemotong menggerus blok di baris terdepan. Begitu sepotong baris hancur, **rel di situ maju satu baris tepat setelah kereta lewat**, jadi kereta tidak pernah tergeser. Rel selalu lurus dengan belokan siku, jadi batu keras yang belum hancur dikitari dengan belokan berbentuk L. Muatan dibongkar di stasiun dan langsung dipasang ke bangunan kota di belakang rel. **Setiap bahan yang terpasang menjadi koin**, dan itulah satu-satunya sumber uang. Level selesai saat kota jadi dan pulau bersih 100%.

Semua visual dibuat prosedural dengan geometri Three.js, dan semua suara disintesis dengan Web Audio. Tidak ada aset eksternal, backend, login, iklan, atau pembayaran.

![Menebang](docs/screenshots/01-menebang.png) ![Membangun](docs/screenshots/02-membangun.png) ![Kota selesai](docs/screenshots/03-kota-selesai.png) ![Lembah Batu](docs/screenshots/04-lembah-batu.png)

## Menjalankan

```bash
npm install
npm run dev      # buka URL yang dicetak Vite (default http://localhost:5180)
npm run build    # type-check (tsc) + build produksi ke dist/
npm run preview  # menyajikan hasil build
npm test         # unit test (Vitest)
npm run check    # tsc --noEmit + semua tes
npm run balance  # bot pacing: cetak timeline kedua level
npm run deploy   # build + publikasikan dist/ ke branch gh-pages (GitHub Pages)
```

Butuh Node 18+ dan browser dengan WebGL. Tambahkan `?frame=390x844` pada URL untuk memaksa ukuran kontainer ponsel di desktop (khusus pengujian).

## Kontrol

| Aksi | Sentuh / mouse | Keyboard |
| --- | --- | --- |
| Jalan | Tahan area dunia supaya kereta jalan; ketuk untuk maju sebentar. Tanpa sentuhan kereta diam. | Tahan `Spasi` |
| Geser kamera | Seret jari/mouse di area dunia (kamera kembali mengikuti kereta setelah ±3,5 dtk) | — |
| Zoom | Cubit dua jari / scroll mouse | — |
| Lihat seluruh pulau | Tombol peta di kanan atas | `O` |
| Tambah pemotong Lv1 | **Pemotong** | `A` |
| Gabung 2 pemotong setingkat | **Gabung** | `M` |
| Kereta lebih cepat | **Kecepatan** | `S` |
| Gerbong muatan lebih besar | **Kapasitas** | `C` |
| Level berikutnya | Tombol di panel selesai | `Enter` |

Ketukan pada tombol HUD tidak menjalankan kereta. Seretan lebih dari 12 px otomatis berubah dari jalan menjadi geser kamera.

## Loop permainan

1. **Jalan.** Kereta hanya bergerak selama layar ditahan (atau sebentar setelah diketuk). Gerinda hanya berputar dan memotong saat kereta bergerak.
2. **Menebang.** Tiap pemotong menggerus satu blok yang disentuh gerindanya, di sisi kiri rel (sisi hutan). Blok rusak bertahap: pohon rimbun → tajuk separuh → batang gundul bercabang → tunggul, dan batu pecah per lempeng sampai tinggal puing. Tunggul masih harus digerus, jadi rel baru maju setelah tunggulnya habis. Dengan satu pemotong Lv1, pohon hijau pun butuh beberapa kali lewat, dan blok di pita luar jauh lebih keras. Menambah dan menggabung pemotong membuat blok tumbang lebih cepat. Selama digerus, blok terus mengeluarkan bahan (balok kayu kecil) yang terbang ke gerbong muatan di belakang lokomotif, walaupun bloknya belum habis. Kalau gerbong penuh, gergaji tetap memotong dan balok kecilnya jatuh menumpuk di rel. Tumpukan itu dipungut gerbong saat melintas lagi dan masih ada ruang, misalnya setelah bongkar di stasiun atau setelah Kapasitas dinaikkan.
3. **Rel maju.** Rel selalu lewat satu sel di depan baris terdepan. Begitu minimal 3 blok berjejer hancur, rel di situ maju satu baris lewat dua belokan siku yang melengkung setengah sel. Rel di bawah kereta tidak pernah berubah: bagian yang baru bersih menunggu sampai kereta lewat, lalu rel di belakang pemotong terakhir maju mengikuti kereta. Jadi tiap putaran rel maju satu baris. Blok keras yang tersisa dikitari rel dengan belokan L, lalu rel lurus lagi setelah bloknya hancur. Rel hanya pernah maju keluar. Kalau ada blok yang sampai terkurung di dalam rel, pekerja kota membongkarnya otomatis ke gudang.
4. **Muatan penuh.** Saat gerbong muatan penuh, gerinda berhenti dan label di atas kereta berubah menjadi **PENUH**. Blok yang sudah tumbang tetapi tidak muat ditahan sampai muatan dibongkar, sehingga tidak ada bahan yang hilang.
5. **Membangun.** Setiap kali lewat stasiun, seluruh muatan dibongkar ke halaman penyimpanan stasiun (stasiun tanpa atap; tumpukan baloknya terlihat naik-turun sesuai isi gudang). Truk kecil mengangkut bahan dari penyimpanan lewat jalan kota ke bangunan terbuka yang belum jadi (isi-dulu, berurutan: rumah dulu, gedung besar jadi penutup distrik). Muatan tiap truk 20% kapasitas gerbong, dan jumlah truk = 2 + jumlah distrik yang sudah terbuka, jadi truk bolak-balik. Bahan terpasang, bangunan tumbuh, dan koin masuk saat truk tiba. Kavling terbuka begitu rel sudah melewatinya dengan jarak aman. Nilai bahan: kayu 1, batu 2, permata 5 poin. Setiap poin yang terpasang memberi 1 koin, dan bangunan yang selesai memberi bonus. Modul bangunan berubah dari ghost menjadi solid (fondasi → dinding → bukaan → atap → detail).
6. **Upgrade.** **Pemotong** menambah pemotong Lv1 di ujung kereta. **Gabung** menyatukan dua pemotong setingkat menjadi satu pemotong dengan gerinda lebih besar dan lebih cepat. **Kecepatan** mempercepat kereta, dan **Kapasitas** memperbesar gerbong muatan.
7. **Hutan tidak tumbuh lagi.** Total bahan di hutan sama persis dengan total biaya kota, jadi pulau bersih dan kota jadi terjadi bersamaan. Muncul confetti, kamera menyorot seluruh pulau, bonus diberikan, lalu tombol **Level Berikutnya** muncul.

## Konten

| Level | Tema | Tampilan bangunan | Distrik (cincin 1 → 4) | Bangunan |
| --- | --- | --- | --- | --- |
| 1 · Hutan Cemara | Hutan | Kayu | Alun-alun, Kampung Cemara, Kampung Pinus, Kampung Jati | Rumah kayu, rumah papan, warung, rumah panggung, lumbung, rumah loteng, menara air |
| 2 · Lembah Batu | Padang | Bata | Alun-alun Batu, Blok Granit, Blok Marmer, Blok Andesit | Rumah bata, toko roti, ruko, rumah bata tingkat, apartemen, menara jam |

Masing-masing level berisi 12,5 baris hutan (1.196 blok, dibagi 5 pita) dan 69 bangunan (5 / 10 / 14 / 18 / 22 per distrik). Kotanya berbentuk grid: alun-alun dengan balai desa/kota di tengah, jalan lingkar di tiap distrik, empat jalan raya, dan jalan samping yang membentuk blok-blok. Selain rumah, ada gedung umum (sekolah, puskesmas/rumah sakit, rumah makan/restoran, pasar, pemadam, perpustakaan, kantor polisi, lapangan bola/stadion), dan slot kosong menjadi taman. Hutan makin jauh makin keras: pohon hijau di dekat pusat, lalu pohon emas, lalu pohon merah dengan batu dan kristal. Setelah level 2, permainan berputar kembali ke level 1 dengan koin dan harga upgrade yang lebih tinggi. Upgrade kereta direset di setiap level baru, sedangkan uang tetap dibawa.

## Angka awal (Level 1)

| Parameter | Nilai |
| --- | --- |
| Kereta awal | lokomotif + gerbong muatan + 1 pemotong Lv1; kecepatan 3,7 u/dtk (+0,12 per level); muatan 120 (×1,3 per level) |
| Pemotong | 10 dmg/dtk pada satu blok yang disentuh gerinda (±2,7 HP per lewat di kecepatan awal), ×2,5 per tingkat Gabung (menggabung dua pemotong selalu menambah daya potong); jangkauan gerinda 0,95 (+0,1 per tingkat) |
| Blok | HP dasar → bahan: pohon 8 → 8 kayu · pohon emas 16 → 12 · pohon merah 28 → 20 · batu 24 → 12 batu · kristal 48 → 4 permata; HP dikali pengali pita 1 / 1,3 / 1,6 / 2 / 2,4 dari dalam ke luar. Bahan keluar sedikit demi sedikit selama digerus (unit terakhir saat blok habis). Tidak ada blok yang habis sekali lewat oleh satu pemotong Lv1, jadi tahap rusaknya selalu terlihat. |
| Koin | 1 per poin bahan terpasang; bonus bangunan selesai 30% biayanya; bonus level 800 |
| Pemotong / Gabung / Kecepatan / Kapasitas | 40 / 60 / 80 / 80, lalu ×1,38 / ×1,32 / ×1,6 / ×1,6 (Level 2 ×2,5) |
| Pulau | rel awal persegi setengah lebar 4,5; hutan 12,5 baris (1.196 blok, 5.353 poin bahan); pantai 1,4 di luar baris terakhir; biaya bangunan 66–234 poin |

Hasil `npm run balance` (bot yang terus menahan layar dan membeli upgrade dengan tambahan daya potong per koin terbesar): bahan pertama keluar di detik ke-0 (walau pohonnya baru tumbang di lewat ketiga), bongkar muatan pertama ±9 dtk, rumah pertama jadi ±29 dtk. Level 1 selesai ±10,7 menit dan Level 2 ±11 menit. Bot yang tidak pernah upgrade hanya membersihkan ±31% hutan dalam 15 menit.

Semua angka global ada di `src/config/balance.ts`. Level, cincin, distrik, bobot bangunan, dan jenis blok per pita ada di `src/config/levels.ts`. Tipe bangunan ada di `src/config/buildings/`.

## Arsitektur

```
src/
  config/        balance.ts, levels.ts (cincin, distrik & bobot bangunan, blok per pita), buildings/ (generator rumah & gedung umum)
  game/          logika murni, tanpa Three.js/DOM, dapat diuji di Node
    layout.ts      jarak Chebyshev ke rel awal → pita hutan; rencana kota grid (kavling, taman, jalan) & rute truk
    rail.ts        rel dinamis: lahan bersih → opening 3×3 → keliling lurus-siku lewat pusat sel
    track.ts       TrackPath (poligon bersudut bulat, radius per sudut), computeCrossings, StageMapping
    worldgen.ts    grid hutan 1×1 rapat (seed tetap): jenis blok per pita
    sim.ts         kontrol tap/tahan, gerak kereta, pemotong (satu target), rel maju, bongkar & pasang, level selesai
    actions.ts     tambah pemotong, gabung, kecepatan, kapasitas, level berikutnya
    economy.ts     rumus, kalibrasi biaya bangunan dari hasil hutan, progres
    save.ts        save/load (skema v4) + validasi + cadangan save rusak
  render/        world.ts, forestView (InstancedMesh per jenis blok, tahap rusak lewat shader), trainView (lokomotif, gerbong muatan,
                 pemotong dengan gerinda di sisi kiri), cityView (tanah kota per sel, jalan, air mancur), seaView (pulau berpantai, laut, buih, kelapa), truckView (truk pengantar bahan), railView + railShape (rel dari ubin per sel beralas tanah, ubin melompat saat rel pindah; rumput kota menempel melengkung di sisi kanan rel),
                 plotView, buildingView (ghost/solid), effects, labels, cameraRig
  audio/sfx.ts   synthesizer Web Audio (dengung gerinda, tebang, bongkar, koin; compressor & batas voice)
  ui/            hud.ts, tutorial.ts, format.ts
  app.ts         loop, event → render/audio/HUD, input (tahan/tap untuk jalan, geser, cubit), autosave
```

Rel tidak disimpan, melainkan dihitung dari blok yang masih hidup. Langkahnya:

1. Ambil lahan bebas yang tersambung ke pusat.
2. Buka dengan kotak 3×3, sehingga tonjolan selebar 1–2 sel diabaikan.
3. Ambil komponen pusat dan isi lubangnya.
4. Rel adalah keliling lahan itu yang lewat pusat sel-sel tepinya. Bentuknya selalu lurus dengan belokan siku. Belokan ke arah kota diberi lengkung kecil, dan belokan ke arah hutan lebih rapat supaya tidak menyerempet blok.

Karena blok hanya bisa hancur, lahan di dalam rel hanya bisa membesar. Selama main, lahan baru yang berjarak kurang dari ±1,5 sel dari kereta (lokomotif sampai pemotong terakhir) ditunda. Perubahan rel diterima hanya jika rel di bawah kereta tetap persis sama, dan tundaan diterapkan begitu kereta menjauh. Saat game dimuat ulang, semua tundaan langsung diterapkan. Kereta adalah satu jarak skalar di loop. Stasiun (jarak 0, tengah sisi bawah) dianggap dilewati jika berada di interval setengah-terbuka `(prev, prev+move]`, sehingga tidak bisa terlompati dan tidak ada pemicu ganda. Saat rel berubah, bagian rel di bawah kereta dipetakan 1:1, sehingga kereta tidak meloncat.

## Menambah level / bangunan

1. **Tipe bangunan baru**: tambahkan entri di `BUILDINGS` pada `src/config/buildings/index.ts`. Pakai generator parametrik `house()` (dinding log/papan/bata, 1–4 lantai, atap pelana/datar, panggung, kanopi, balkon, papan nama), atau tulis generator sendiri seperti `waterTower()`.
2. **Level baru**: salin satu objek di `LEVELS` (`src/config/levels.ts`). Isi `ringStart`, `ringStep` (lebar pita), `districts` (satu per pita; kavling `L(tipe, varian, bobot)`), `bands` (bobot jenis blok per pita), dan `seed`. Biaya bangunan tidak perlu ditulis karena dihitung otomatis dari hasil pita hutan distriknya.
3. Jalankan `npm test`. `tests/layout.test.ts` dan `tests/rail.test.ts` otomatis memeriksa bahwa:
   - hutan rapat berbaris;
   - rel awal persegi dan menempel ke baris pertama;
   - kavling tidak saling menimpa, alun-alun sudah di dalam rel, dan semua kavling terbuka saat hutan habis;
   - kavling tidak menimpa jalan/taman, tiap kavling luar menghadap jalan, dan rute truk selalu di atas jalan;
   - biaya tiap distrik sama dengan hasil pita hutannya.

## Pengujian

`npm test` menjalankan 52 tes:

- **Rel**:
  - rel awal persegi;
  - 1–2 blok hancur tidak mengubah rel, sedangkan 3 blok berjejer membuat rel maju dengan belokan siku;
  - batu keras dikitari lalu rel lurus lagi;
  - rel hanya maju dan menjaga jarak dari blok;
  - blok terkurung dibongkar otomatis;
  - rel di bawah kereta tidak berubah, dan lahan di dekat kereta menunggu kereta lewat;
  - saat menyetir, kereta tidak pernah tergeser oleh perubahan rel.
- **Crossing**: wrap di ujung loop, langkah besar, dan jumlah pemicu yang sama untuk berbagai ukuran langkah.
- **Tata letak**: baris hutan, kavling (uji sumbu pemisah), kota grid (kavling vs jalan/taman, kavling menghadap jalan), rute truk di atas jalan, dan kalibrasi biaya untuk kedua level.
- **Kontrol & pemotong**:
  - tanpa input kereta diam dan tidak ada yang terpotong;
  - tap memajukan kereta sebentar, tahan membuatnya jalan terus;
  - gerinda hanya menggerus blok di kiri yang disentuhnya, satu blok per pemotong;
  - muatan tidak melebihi kapasitas; saat penuh gerinda tetap memotong dan hasilnya jatuh ke rel, lalu dipungut gerbong saat lewat dan masih muat;
  - truk mengangkut dari penyimpanan dengan kapasitas terbatas, bolak-balik, dan bahan baru terpasang saat truk tiba;
  - hutan tidak tumbuh kembali.
- **Stasiun & kota**: tidak ada yang dijual, isi-dulu dengan bonus, gudang menunggu kavling berikutnya, dan uang hanya dari membangun.
- **Kekekalan bahan**: hutan + muatan + gudang + terpasang selalu sama dengan total hasil hutan; level selesai hanya saat kota jadi dan pulau bersih.
- **Aksi & save/load**: upgrade, level berikutnya dan putaran ulang, round-trip, save rusak atau versi lama, dan clamp nilai.
- **Pacing**: bot memainkan kedua level sampai selesai tanpa softlock.
