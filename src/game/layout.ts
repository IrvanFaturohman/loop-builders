import { LEVELS } from '../config/levels';
import { TrackPath, type TrackShape } from './track';
import type { LevelDefinition, LotDef, Vec2 } from './types';

/**
 * Tata letak pulau: rel dasar, baris hutan, pita (zona jenis blok), dan kavling kota.
 *
 * Pulau berbentuk persegi. `ringDistance` = jarak Chebyshev bertanda ke rel awal (persegi
 * setengah-lebar `ringStart`), jadi baris hutan, pita, dan cincin kavling semuanya berupa cincin
 * persegi yang sejajar grid. Rel yang sebenarnya dinamis (lihat rail.ts): mengikuti tepi lahan
 * yang sudah bersih, lurus dengan belokan siku.
 *
 * Loop berjalan searah jarum jam (di layar: x ke kanan, z ke bawah) mulai dari tengah sisi
 * bawah, tempat stasiun berada. Sisi kiri kereta = sisi luar loop = arah hutan.
 */

export const LOT_W = 2.0; // lebar kavling sepanjang jalur
export const LOT_D = 1.8; // kedalaman kavling
/** Setengah lebar koridor rel yang bebas kavling. */
export const RAIL_CLEAR = 0.85;
/** Hutan dimulai lewat jarak bertanda ini dari rel awal (baris pertama tepat satu sel di luar rel). */
export const FOREST_START = 0.5;
/** Panjang jalur kavling di depan stasiun yang dikosongkan (jalan masuk ke alun-alun). */
export const STATION_GAP = 3.2;
/** Setengah lebar jalur kavling distrik 0 (alun-alun di dalam rel awal). */
const CENTER_HALF = 2;
/** Jarak jalur kavling distrik k≥1 dari rel awal, relatif terhadap awal pita k-1. */
const LOT_SHIFT = 0.45;
/** Jarak minimum pusat kavling dari sudut jalur (sepanjang jalur). */
const CORNER_CLEAR = 1.1;

/** Jumlah distrik = jumlah pita hutan. */
export function districtCount(level: LevelDefinition): number {
  return level.districts.length;
}

/** Jarak bertanda awal pita ke-k (juga dasar cincin kavling distrik k+1). */
export function bandStart(level: LevelDefinition, k: number): number {
  return k * level.ringStep;
}

/** Jarak Chebyshev bertanda titik (x, z) ke rel awal: negatif di dalam, positif di luar. */
export function ringDistance(level: LevelDefinition, x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z)) - level.ringStart;
}

/**
 * Pita hutan tempat titik berada: -1 = kota awal (bukan hutan), k = pita ke-k (bobot jenis blok
 * `bands[k]`, hasilnya membiayai distrik k), districtCount = di luar pulau.
 */
export function bandOf(level: LevelDefinition, x: number, z: number): number {
  const sd = ringDistance(level, x, z) - FOREST_START;
  if (sd <= 0) return -1;
  return Math.min(districtCount(level), Math.ceil(sd / level.ringStep) - 1);
}

/** Jarak bertanda tepi luar pulau (baris hutan terakhir). */
export function islandOffset(level: LevelDefinition): number {
  return FOREST_START + bandStart(level, districtCount(level));
}

/** Persegi membulat searah jarum jam, titik awal di tengah sisi bawah. */
function ringShape(half: number, radius: number): TrackShape {
  const h = round(half);
  return { corners: [[0, h], [-h, h], [-h, -h], [h, -h], [h, h]], radius: round(radius) };
}

export interface ResolvedPlot {
  /** Indeks global kavling (urutan distrik lalu urutan di distrik). */
  index: number;
  district: number;
  def: LotDef;
  /** Pusat kavling. */
  pos: Vec2;
  /** Arah hadap bangunan (lokal +z menghadap rel). */
  rotY: number;
  /** Arah hadap (unit) dari kavling ke rel = keluar. */
  facing: Vec2;
}

/** Cincin persegi pada jarak `offset` dari rel awal (searah jarum jam dari tengah sisi bawah). */
export function ringPath(level: LevelDefinition, offset: number): TrackPath {
  return new TrackPath(ringShape(level.ringStart + offset, 0.3));
}

/** Jalur tempat kavling distrik diletakkan. */
export function districtPath(level: LevelDefinition, district: number): TrackPath {
  if (district === 0) return new TrackPath(ringShape(CENTER_HALF, 0.3));
  return ringPath(level, bandStart(level, district - 1) + LOT_SHIFT);
}

const plotCache = new Map<number, ResolvedPlot[]>();

/** Kavling sebuah level (di-cache). */
export function plotsOfLevel(levelIndex: number): ResolvedPlot[] {
  let p = plotCache.get(levelIndex);
  if (!p) {
    p = resolvePlots(LEVELS[levelIndex]);
    plotCache.set(levelIndex, p);
  }
  return p;
}

/**
 * Kavling tiap distrik tersebar rata di jalur perseginya, menghadap keluar (sejajar sumbu),
 * simetris kiri-kanan dengan celah di depan stasiun (jalan masuk ke alun-alun). Di distrik luar,
 * kavling yang jatuh terlalu dekat sudut digeser ke sisi supaya tidak menonjol melewati sudut.
 */
export function resolvePlots(level: LevelDefinition): ResolvedPlot[] {
  const out: ResolvedPlot[] = [];
  level.districts.forEach((dist, di) => {
    const path = districtPath(level, di);
    const n = dist.lots.length;
    const span = (path.length - STATION_GAP) / n;
    const side = path.length / 4;
    dist.lots.forEach((def, i) => {
      let d = STATION_GAP / 2 + (i + 0.5) * span;
      const corner = Math.round((d - side / 2) / side) * side + side / 2;
      if (di > 0 && Math.abs(d - corner) < CORNER_CLEAR) d = corner + (d >= corner ? CORNER_CLEAR : -CORNER_CLEAR);
      const pos = path.pointAt(d);
      const o = path.outwardAt(d);
      const facing = Math.abs(o.x) > Math.abs(o.z) ? { x: Math.sign(o.x), z: 0 } : { x: 0, z: Math.sign(o.z) };
      out.push({ index: out.length, district: di, def, pos, facing, rotY: Math.atan2(facing.x, facing.z) });
    });
  });
  return out;
}

/** Kotak batas pulau (untuk kamera & bayangan). */
export function islandBounds(level: LevelDefinition): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = level.ringStart + islandOffset(level);
  return { minX: -h, maxX: h, minZ: -h, maxZ: h };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
