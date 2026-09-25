import type { Cargo, RailItem, Resource } from './types';

/** Event yang dipancarkan simulasi/aksi agar render, audio, dan UI bisa bereaksi. */
export type GameEvent =
  /** Bahan keluar dari blok yang digerus dan masuk gerbong muatan; `felled` = blok habis. */
  | { type: 'cut'; cell: number; cutter: number; res: Resource; amount: number; felled: boolean }
  /** Bahan keluar saat gerbong muatan tidak muat: jatuh ke rel sebagai `item`. */
  | { type: 'drop'; cell: number; cutter: number; item: RailItem; felled: boolean }
  /** Gerbong muatan memungut tumpukan bahan di rel yang dilewatinya. */
  | { type: 'pickup'; item: RailItem }
  /** Muatan dibongkar di stasiun; `points` masuk gudang lalu langsung dipasang bila ada bangunan terbuka. */
  | { type: 'unload'; cargo: Cargo; points: number }
  | {
      type: 'deliver';
      plot: number;
      amount: number;
      /** Koin dari bahan yang terpasang. */
      money: number;
      /** Modul [fromModule, toModule) berubah ghost → solid. */
      fromModule: number;
      toModule: number;
    }
  | { type: 'plotComplete'; plot: number; bonus: number }
  | { type: 'projectComplete'; bonus: number }
  | { type: 'add'; index: number }
  | { type: 'merge'; a: number; b: number; level: number }
  | { type: 'speed'; level: number }
  | { type: 'capacity'; level: number }
  /** Rel maju di belakang kereta (bentuk baru: railOf(state)). */
  | { type: 'railGrow' }
  /** Blok terkurung di dalam rel dibongkar otomatis; bahannya masuk gudang. */
  | { type: 'harvest'; cell: number; points: number }
  /** Kavling kini di dalam rel dan siap dibangun. */
  | { type: 'plotOpen'; plot: number }
  | { type: 'nextProject'; levelIndex: number };

export type EventSink = GameEvent[];
