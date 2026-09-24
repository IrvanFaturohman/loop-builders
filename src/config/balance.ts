import type { BlockKind, Resource } from '../game/types';

/**
 * Angka balancing global. Ubah di sini untuk menyetel rasa permainan;
 * angka per level (bentuk cincin, distrik, bobot bangunan, jenis blok per pita) ada di levels.ts.
 */
export const BALANCE = {
  /** Kecepatan dasar kereta (unit dunia per detik) & kenaikan per level Kecepatan. */
  speed: { base: 3.4, perLevel: 0.1, maxLevel: 20 },
  /** Kapasitas gerbong muatan dasar & pengali per level Kapasitas. */
  capacity: { base: 20, growth: 1.3, maxLevel: 20 },
  /**
   * Pemotong: kerusakan per detik pada satu target (Lv1) & pengali per tingkat merge;
   * panjang lengan Lv1 harus menjangkau tepi terjauh pita hutan (diuji di layout.test.ts).
   */
  cutter: { dps: 3.5, growth: 1.8, reach: 3.5, reachPerLevel: 0.3 },
  /** Jarak antar gerbong di rel. */
  wagonSpacing: 1.05,
  maxCutters: 12,
  maxCutterLevel: 8,

  boost: {
    mult: 1.7,
    tapDuration: 0.65,
    maxHoldSeconds: 7,
    rechargeSeconds: 4.5,
    rechargeDelay: 0.5,
    resumeAt: 0.3,
    accel: 10,
    decel: 3.2,
  },

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
  expandFreeze: 1.35,
  maxFrameDt: 0.1,
  maxStepDt: 1 / 30,
  autosaveSeconds: 5,
};
