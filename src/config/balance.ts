import type { BlockKind, Resource } from '../game/types';

/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per level (bentuk cincin, distrik, bobot bangunan, jenis blok per pita) ada di levels.ts.
 */
export const BALANCE = {
  /** Kecepatan dasar kereta (unit dunia per detik) & kenaikan per level Kecepatan. */
  speed: { base: 3.4, perLevel: 0.1, maxLevel: 20 },
  /** Kapasitas gerbong muatan dasar & pengali per level Kapasitas. */
  capacity: { base: 26, growth: 1.3, maxLevel: 20 },
  /**
   * Pemotong: kerusakan per detik pada satu blok (Lv1) & pengali per tingkat merge. Gerinda
   * menempel di sisi kiri gerbong (`side` dari garis tengah rel) dan memotong blok yang pusatnya
   * dalam `reach` dari pusat piringan. Hanya memotong selama kereta bergerak.
   */
  cutter: { dps: 10, growth: 1.6, side: 0.55, reach: 0.95, reachPerLevel: 0.1 },
  /** Jarak antar gerbong di rel. */
  wagonSpacing: 1.05,
  maxCutters: 12,
  maxCutterLevel: 8,

  /** Kontrol: tahan layar = jalan, tap = maju sebentar; kereta diam tanpa input. */
  drive: { tap: 0.45, tapMax: 1.2, accel: 7, decel: 6 },

  cost: {
    add: { base: 10, growth: 1.55 },
    merge: { base: 15, growth: 1.45 },
    speed: { base: 20, growth: 1.6 },
    capacity: { base: 20, growth: 1.6 },
  },

  /** Nilai poin bahan tiap unit muatan saat dipasang ke bangunan. */
  points: { wood: 1, stone: 2, gem: 5 } as Record<Resource, number>,
  /** Koin per poin bahan yang terpasang (satu-satunya sumber uang selain bonus). */
  coinPerPoint: 1,
  /** Bonus saat satu bangunan selesai, sebagai porsi dari biayanya. */
  buildBonus: 0.3,

  /** Blok hutan: HP dan hasil tebang. Hutan tidak tumbuh kembali. */
  blocks: {
    tree: { hp: 2, res: 'wood', amount: 2 },
    treeGold: { hp: 4, res: 'wood', amount: 3 },
    treeRed: { hp: 7, res: 'wood', amount: 5 },
    rock: { hp: 6, res: 'stone', amount: 3 },
    crystal: { hp: 12, res: 'gem', amount: 1 },
  } as Record<BlockKind, { hp: number; res: Resource; amount: number }>,

  /** Pengali biaya upgrade & koin tiap putaran ulang daftar level. */
  cycleScale: 0.6,
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};
