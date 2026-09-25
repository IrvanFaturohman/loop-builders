import type { BlockKind, Resource } from '../game/types';

/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per level (bentuk cincin, distrik, bobot bangunan, jenis blok per pita) ada di levels.ts.
 */
export const BALANCE = {
  /** Kecepatan dasar kereta (unit dunia per detik) & kenaikan per level Kecepatan. */
  speed: { base: 3.7, perLevel: 0.12, maxLevel: 20 },
  /** Kapasitas gerbong muatan dasar & pengali per level Kapasitas. */
  capacity: { base: 120, growth: 1.3, maxLevel: 20 },
  /**
   * Pemotong: kerusakan per detik pada satu blok (Lv1) & pengali per tingkat merge. Gerinda
   * menempel di sisi kiri gerbong (`side` dari garis tengah rel) dan memotong blok yang pusatnya
   * dalam `reach` dari pusat piringan. Hanya memotong selama kereta bergerak.
   */
  cutter: { dps: 10, growth: 2.5, side: 0.55, reach: 0.95, reachPerLevel: 0.1 },
  /**
   * Truk pengantar bahan dari penyimpanan stasiun ke bangunan: jumlah truk = `base` + jumlah
   * distrik yang sudah terbuka (kota besar punya lebih banyak truk), kecepatan, dan muatan per
   * perjalanan sebagai porsi kapasitas gerbong muatan (dalam poin bahan).
   */
  truck: { base: 2, speed: 4.5, capacityRatio: 0.2 },
  /** Jarak antar gerbong di rel. */
  wagonSpacing: 1.05,
  maxCutters: 12,
  maxCutterLevel: 8,

  /** Kontrol: tahan layar = jalan, tap = maju sebentar; kereta diam tanpa input. */
  drive: { tap: 0.45, tapMax: 1.2, accel: 7, decel: 6 },

  cost: {
    add: { base: 40, growth: 1.38 },
    merge: { base: 60, growth: 1.32 },
    speed: { base: 80, growth: 1.6 },
    capacity: { base: 80, growth: 1.6 },
  },

  /** Nilai poin bahan tiap unit muatan saat dipasang ke bangunan. */
  points: { wood: 1, stone: 2, gem: 5 } as Record<Resource, number>,
  /** Koin per poin bahan yang terpasang (satu-satunya sumber uang selain bonus). */
  coinPerPoint: 1,
  /** Bonus saat satu bangunan selesai, sebagai porsi dari biayanya. */
  buildBonus: 0.3,

  /**
   * Pengali HP blok per pita hutan (pita 0 = paling dalam). Satu pemotong Lv1 menggerus ±4,5 HP
   * per lewat, jadi pohon hijau butuh 2 lewat (tahap rusaknya terlihat) dan pita luar butuh
   * pemotong hasil Gabung serta lebih banyak pemotong — tanpa upgrade, pulau praktis tidak bisa
   * dibersihkan. Hasil tebang tidak ikut naik (biaya kota tetap terkalibrasi).
   */
  bandHp: [1, 1.3, 1.6, 2, 2.4],
  /**
   * Blok hutan: HP dasar (dikali bandHp) dan jumlah unit bahannya. Bahan keluar sedikit demi
   * sedikit selama digerus (≥ 4 unit per blok, jadi tiap tahap rusak mengeluarkan bahan), unit
   * terakhir saat blok habis. Hutan tidak tumbuh kembali.
   */
  blocks: {
    tree: { hp: 8, res: 'wood', amount: 8 },
    treeGold: { hp: 16, res: 'wood', amount: 12 },
    treeRed: { hp: 28, res: 'wood', amount: 20 },
    rock: { hp: 24, res: 'stone', amount: 12 },
    crystal: { hp: 48, res: 'gem', amount: 4 },
  } as Record<BlockKind, { hp: number; res: Resource; amount: number }>,

  /** Pengali biaya upgrade & koin tiap putaran ulang daftar level. */
  cycleScale: 0.6,
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};
