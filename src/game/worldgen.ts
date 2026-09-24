import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { bandOf, LOT_D, LOT_W, plotsOfLevel, railStageOf, stageCount } from './layout';
import type { BlockKind } from './types';

/**
 * Hutan: grid sel 1×1 menutupi pulau. Tiap sel berisi satu blok (pohon/batu/kristal) atau
 * kosong. Hutan hanya ada di pita-pita di luar rel pertama; jenis bloknya diacak deterministik
 * (seed level) menurut bobot pita. Data ini tidak disimpan — hanya HP sisa tiap sel yang masuk save.
 */

export const KINDS: BlockKind[] = ['tree', 'treeGold', 'treeRed', 'rock', 'crystal'];
export const CELL = 1;

export interface Field {
  half: number;
  cols: number;
  n: number;
  /** Indeks jenis di KINDS, atau -1 bila sel kosong. */
  kind: Int8Array;
  x: Float32Array;
  z: Float32Array;
  /** Pita hutan sel (-1 = alun-alun, stageCount = di luar pulau). */
  band: Int8Array;
  /** Tahap yang relnya melewati sel ini (-1 = tidak pernah). */
  railStage: Int8Array;
  /** Kavling yang menempati sel ini (-1 = tidak ada). Hanya untuk tampilan tanah. */
  plotOf: Int16Array;
  /** Sel berblok per pita (untuk progres & pemicu rel melebar). */
  bandCells: number[][];
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const cache = new Map<number, Field>();

export function fieldFor(levelIndex: number): Field {
  let f = cache.get(levelIndex);
  if (f) return f;
  const level = LEVELS[levelIndex];
  const half = level.mapHalf;
  const cols = Math.round((half * 2) / CELL);
  const n = cols * cols;
  const kind = new Int8Array(n).fill(-1);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const band = new Int8Array(n);
  const railStage = new Int8Array(n);
  const plotOf = new Int16Array(n).fill(-1);
  const bands = stageCount(level);
  const bandCells: number[][] = Array.from({ length: bands }, () => []);
  const r = rng(level.seed);
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      const c = j * cols + i;
      x[c] = -half + (i + 0.5) * CELL;
      z[c] = -half + (j + 0.5) * CELL;
      band[c] = bandOf(level, x[c], z[c]);
      railStage[c] = railStageOf(level, x[c], z[c]);
      const roll = r();
      const pick = r();
      const b = band[c];
      if (b < 0 || b >= bands || railStage[c] === 0) continue;
      if (roll < 0.035) continue; // celah alami
      const entries = KINDS.map((k) => [k, level.bands[b][k] ?? 0] as const).filter(([, w]) => w > 0);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let acc = 0;
      for (const [k, w] of entries) {
        acc += w / total;
        if (pick <= acc) {
          kind[c] = KINDS.indexOf(k);
          break;
        }
      }
      if (kind[c] < 0) kind[c] = KINDS.indexOf(entries[entries.length - 1][0]);
      bandCells[b].push(c);
    }
  }
  for (const p of plotsOfLevel(levelIndex)) {
    const alongX = Math.abs(p.facing.z) > Math.abs(p.facing.x);
    const hx = (alongX ? LOT_W : LOT_D) / 2;
    const hz = (alongX ? LOT_D : LOT_W) / 2;
    for (let c = 0; c < n; c++) if (Math.abs(x[c] - p.pos.x) < hx && Math.abs(z[c] - p.pos.z) < hz) plotOf[c] = p.index;
  }
  f = { half, cols, n, kind, x, z, band, railStage, plotOf, bandCells };
  cache.set(levelIndex, f);
  return f;
}

/** HP awal semua sel untuk permainan baru. */
export function initialBlocks(levelIndex: number): number[] {
  const f = fieldFor(levelIndex);
  const out: number[] = new Array(f.n);
  for (let c = 0; c < f.n; c++) out[c] = f.kind[c] < 0 ? -1 : BALANCE.blocks[KINDS[f.kind[c]]].hp;
  return out;
}

export function maxHp(f: Field, c: number): number {
  return f.kind[c] < 0 ? -1 : BALANCE.blocks[KINDS[f.kind[c]]].hp;
}

/** Poin bahan yang dihasilkan sel bila ditebang (0 untuk sel kosong). */
export function cellPoints(f: Field, c: number): number {
  if (f.kind[c] < 0) return 0;
  const def = BALANCE.blocks[KINDS[f.kind[c]]];
  return def.amount * BALANCE.points[def.res];
}

/** Panggil cb untuk setiap sel yang pusatnya mungkin berada dalam radius r dari (px, pz). */
export function forCellsInRadius(half: number, cols: number, px: number, pz: number, r: number, cb: (c: number) => void): void {
  const i0 = Math.max(0, Math.floor((px - r + half) / CELL));
  const i1 = Math.min(cols - 1, Math.floor((px + r + half) / CELL));
  const j0 = Math.max(0, Math.floor((pz - r + half) / CELL));
  const j1 = Math.min(cols - 1, Math.floor((pz + r + half) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cb(j * cols + i);
}
