# Loop Builders — Tebang & Bangun

Game web 3D idle/clicker satu tangan (Vite + TypeScript + Three.js), mengikuti gaya *Train Miner: Idle Railway* (Flexus/Azur Games) dengan satu perbedaan besar: **hasil tebangan tidak dijual, tetapi dipakai membangun kota**.

Sebuah kereta berputar di rel cincin yang mengelilingi pulau hutan voxel. Susunannya lokomotif, satu gerbong muatan, lalu gerbong pemotong. Tiap pemotong menjulurkan lengan ke kiri, ke arah hutan, dan gerinda horizontal di ujungnya menempel ke satu pohon atau batu sampai tumbang. Muatan dibongkar di stasiun dan langsung dipasang ke bangunan kota di tengah pulau. **Setiap bahan yang terpasang menjadi koin**, dan itulah satu-satunya sumber uang. Begitu hutan di luar rel bersih, rel melebar sendiri ke hutan berikutnya dan lahan bekasnya menjadi distrik kota baru. Level selesai saat kota jadi dan pulau bersih 100%.

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
| Ngebut (boost) | Ketuk area dunia untuk dorongan singkat, tahan untuk mempertahankan (±7 dtk, lalu isi ulang) | Tahan `Spasi` |
| Geser kamera | Seret jari/mouse di area dunia (kamera kembali mengikuti kereta setelah ±3,5 dtk) | — |
| Zoom | Cubit dua jari / scroll mouse | — |
| Lihat seluruh pulau | Tombol peta di kanan atas | `O` |
| Tambah pemotong Lv1 | **Pemotong** | `A` |
| Gabung 2 pemotong setingkat | **Gabung** | `M` |
| Kereta lebih cepat | **Kecepatan** | `S` |
| Gerbong muatan lebih besar | **Kapasitas** | `C` |
| Level berikutnya | Tombol di panel selesai | `Enter` |

Ketukan pada tombol HUD tidak memicu boost. Seretan lebih dari 12 px otomatis berubah dari boost menjadi geser kamera.

## Loop permainan

1. **Menebang.** Tiap pemotong memilih blok hidup terdekat di sisi kiri rel (sisi hutan) dalam jangkauan lengannya, lalu gerinda menempel dan memotong sampai blok tumbang. Satu pemotong mengerjakan satu blok sekaligus. Pohon hijau, emas, dan merah menghasilkan kayu, batu menghasilkan batu, dan kristal menghasilkan permata. Hasilnya terbang ke gerbong muatan di belakang lokomotif.
2. **Muatan penuh.** Saat gerbong muatan penuh, semua lengan terlipat dan label di atas kereta berubah menjadi **PENUH**. Blok yang sudah tumbang tetapi tidak muat ditahan di ambang tumbang sampai muatan dibongkar, sehingga tidak ada bahan yang hilang.
3. **Membangun.** Setiap kali lewat stasiun, seluruh muatan dibongkar ke gudang dan langsung dipasang ke bangunan kota yang terbuka (isi-dulu, berurutan). Nilai bahan: kayu 1, batu 2, permata 5 poin. Setiap poin yang terpasang memberi 1 koin, dan bangunan yang selesai memberi bonus. Modul bangunan berubah dari ghost menjadi solid (fondasi → dinding → bukaan → atap → detail).
4. **Upgrade.** **Pemotong** menambah pemotong Lv1 di ujung kereta. **Gabung** menyatukan dua pemotong setingkat menjadi satu pemotong dengan lengan lebih panjang dan gerinda lebih besar dan cepat. **Kecepatan** mempercepat kereta, dan **Kapasitas** memperbesar gerbong muatan.
5. **Rel melebar sendiri.** Begitu pita hutan di luar rel bersih 100%, rel bergeser keluar menjadi cincin yang lebih besar (dengan animasi), stasiun ikut pindah, dan lahan bekasnya menjadi distrik kota berikutnya. Bahan yang menunggu di gudang langsung dipasang ke distrik baru. Tidak ada tombol maupun biaya, sehingga permainan tidak mungkin macet.
6. **Hutan tidak tumbuh lagi.** Total bahan di hutan sama persis dengan total biaya kota, jadi pulau bersih dan kota jadi terjadi bersamaan.
7. Level selesai saat semua bangunan berdiri dan pulau bersih. Muncul confetti, kamera menyorot seluruh pulau, bonus diberikan, lalu tombol **Level Berikutnya** muncul.

## Konten

| Level | Tema | Tampilan bangunan | Distrik (cincin 1 → 4) | Bangunan |
| --- | --- | --- | --- | --- |
| 1 · Hutan Cemara | Hutan | Kayu | Alun-alun, Kampung Cemara, Kampung Pinus, Kampung Jati | Rumah kayu, rumah papan, warung, rumah panggung, lumbung, rumah loteng, menara air |
| 2 · Lembah Batu | Padang | Bata | Alun-alun Batu, Blok Granit, Blok Marmer, Blok Andesit | Rumah bata, toko roti, ruko, rumah bata tingkat, apartemen, menara jam |

Masing-masing level berisi 4 cincin rel dan 31 bangunan (4 / 6 / 9 / 12 per distrik). Hutan makin jauh makin keras: pohon hijau di dekat pusat, lalu pohon emas, lalu pohon merah dengan batu dan kristal. Setelah level 2, permainan berputar kembali ke level 1 dengan koin dan harga upgrade yang lebih tinggi. Upgrade kereta direset di setiap level baru, sedangkan uang tetap dibawa.

## Angka awal (Level 1)

| Parameter | Nilai |
| --- | --- |
| Kereta awal | lokomotif + gerbong muatan + 1 pemotong Lv1; kecepatan 3,4 u/dtk (+10% per level); muatan 20 (×1,3 per level) |
| Pemotong | 3,5 dmg/dtk pada satu blok, ×1,8 per tingkat; lengan 3,8 (+0,3 per tingkat) |
| Blok | pohon 2 HP → 2 kayu · pohon emas 4 → 3 · pohon merah 7 → 5 · batu 6 → 3 batu · kristal 12 → 1 permata |
| Koin | 1 per poin bahan terpasang; bonus bangunan selesai 30% biayanya; bonus level 200 |
| Pemotong / Gabung / Kecepatan / Kapasitas | 10 / 15 / 20 / 20, lalu ×1,55 / ×1,45 / ×1,6 / ×1,6 (Level 2 ×2,5) |
| Rel | cincin pertama setengah lebar 4,25; tiap cincin berikutnya +2,5 |
| Hutan | 665 blok, 2.759 poin bahan; biaya bangunan 66–167 poin |

Hasil `npm run balance` (bot tanpa boost yang membeli upgrade termurah yang masuk akal): tebangan pertama di detik ke-1, bongkar muatan pertama ±9 dtk, rumah pertama jadi ±37 dtk. Rel melebar pada ±93 dtk, ±186 dtk, dan ±309 dtk. Level 1 selesai ±6,8 menit dan Level 2 ±7,5 menit.

Semua angka global ada di `src/config/balance.ts`. Level, cincin, distrik, bobot bangunan, dan jenis blok per pita ada di `src/config/levels.ts`. Tipe bangunan ada di `src/config/buildings/`.

## Arsitektur

```
src/
  config/        balance.ts, levels.ts (cincin, distrik & bobot bangunan, blok per pita), buildings/ (generator bangunan)
  game/          logika murni, tanpa Three.js/DOM, dapat diuji di Node
    layout.ts      jarak bertanda ke rel pertama → pita hutan, jalur rel tiap tahap, posisi kavling & stasiun
    track.ts       TrackPath (poligon bersudut bulat), computeCrossings, StageMapping
    tracks.ts      cache lintasan per level/tahap + pemetaan saat rel melebar
    worldgen.ts    grid hutan 1×1 (seed tetap): jenis blok per pita, sel rel, sel per pita
    sim.ts         boost, gerak kereta, pemotong (satu target), bongkar & pasang, rel melebar, level selesai
    actions.ts     tambah pemotong, gabung, kecepatan, kapasitas, level berikutnya
    economy.ts     rumus, kalibrasi biaya bangunan dari hasil hutan, progres
    save.ts        save/load (skema v4) + validasi + cadangan save rusak
  render/        world.ts, forestView (InstancedMesh per jenis blok), trainView (lokomotif, gerbong muatan,
                 pemotong dengan lengan & gerinda), cityView (tanah kota, jalan, air mancur), trackView (rel + morph),
                 plotView, buildingView (ghost/solid), environment, effects, labels, cameraRig
  audio/sfx.ts   synthesizer Web Audio (dengung gerinda, tebang, bongkar, koin; compressor & batas voice)
  ui/            hud.ts, tutorial.ts, format.ts
  app.ts         loop, event → render/audio/HUD, input (boost, geser, cubit), autosave
```

Semua cincin rel adalah offset dari rel pertama, sehingga satu fungsi jarak bertanda menentukan pita hutan, jalur rel, dan cincin kavling. Batas pita digeser sejauh setengah lebar koridor rel, jadi rel berikutnya selalu diletakkan di lahan yang sudah bersih. Kereta adalah satu jarak skalar di loop. Stasiun (jarak 0) dianggap dilewati jika berada di interval setengah-terbuka `(prev, prev+move]`, sehingga boost tidak bisa melompatinya dan tidak ada pemicu ganda. Saat rel melebar, `StageMapping` memetakan posisi kereta secara proporsional dengan stasiun sebagai titik bersama.

## Menambah level / bangunan

1. **Tipe bangunan baru**: tambahkan entri di `BUILDINGS` pada `src/config/buildings/index.ts`. Pakai generator parametrik `house()` (dinding log/papan/bata, 1–4 lantai, atap pelana/datar, panggung, kanopi, balkon, papan nama), atau tulis generator sendiri seperti `waterTower()`.
2. **Level baru**: salin satu objek di `LEVELS` (`src/config/levels.ts`). Isi `ringStart`, `ringStep`, `cornerRadius`, `districts` (satu per cincin; kavling `L(tipe, varian, bobot)`), `bands` (bobot jenis blok per cincin), dan `seed`. Biaya bangunan tidak perlu ditulis karena dihitung otomatis dari hasil pita hutan distriknya.
3. Jalankan `npm test`. `tests/layout.test.ts` otomatis memeriksa bahwa setiap blok terjangkau lengan pemotong Lv1 dari sisi kiri rel pitanya, rel berikutnya hanya melewati pita sebelumnya, kavling tidak saling menimpa dan tidak menimpa rel, dan biaya tiap distrik sama dengan hasil pita hutannya.

## Pengujian

`npm test` menjalankan 40 tes:

- **Crossing**: wrap di ujung loop, boost/langkah besar, dan jumlah pemicu yang sama untuk berbagai ukuran langkah.
- **Tata letak**: jangkauan pemotong, rel di lahan bersih, kavling (uji sumbu pemisah), dan kalibrasi biaya untuk kedua level.
- **Pemotong**: hanya memotong di kiri dalam jangkauan, satu blok per pemotong, muatan tidak melebihi kapasitas, susunan kereta, dan hutan tidak tumbuh kembali.
- **Stasiun & kota**: tidak ada yang dijual, isi-dulu dengan bonus, gudang menunggu distrik baru, dan uang hanya dari membangun.
- **Rel melebar**: otomatis saat pita bersih, posisi kereta dan muatan terjaga, serta berhenti di cincin terakhir.
- **Kekekalan bahan**: hutan + muatan + gudang + terpasang selalu sama dengan total hasil hutan; level selesai hanya saat kota jadi dan pulau bersih.
- **Aksi & save/load**: upgrade, level berikutnya dan putaran ulang, round-trip, save rusak atau versi lama, dan clamp nilai.
- **Pacing**: bot memainkan kedua level sampai selesai tanpa softlock, dengan rel melebar 3× per level.
