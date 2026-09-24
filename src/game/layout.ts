import { LEVELS } from '../config/levels';
import { TrackPath, type TrackShape } from './track';
import type { LevelDefinition, LotDef, Vec2 } from './types';

/**
 * Tata letak pulau: rel cincin per tahap, pita hutan, dan kavling kota.
 *
 * Semua cincin adalah offset dari rel pertama (persegi membulat setengah-lebar `ringStart`,
 * radius sudut `cornerRadius`): rel tahap k berada tepat di jarak bertanda k·ringStep dari rel
 * pertama. Karena itu satu fungsi jarak bertanda (`ringDistance`) cukup untuk menentukan pita
 * hutan, jalur rel, dan posisi kavling.
 *
 * Loop berjalan searah jarum jam (di layar: x ke kanan, z ke bawah) mulai dari tengah sisi
 * bawah, tempat stasiun berada. Sisi kiri kereta = sisi luar loop = arah hutan.
 */

export const LOT_W = 2.0; // lebar kavling sepanjang jalur
export const LOT_D = 1.8; // kedalaman kavling
/** Setengah lebar jalur rel yang bebas blok/kavling. */
export const RAIL_CLEAR = 0.85;
/** Panjang jalur kavling di depan stasiun yang dikosongkan (jalan masuk ke alun-alun). */
export const STATION_GAP = 3.2;
/** Setengah lebar jalur kavling distrik 0 (alun-alun di dalam rel pertama). */
const CENTER_HALF = 2;
/** Jarak jalur kavling distrik k≥1 di luar rel lama (hampir di atas bekas relnya). */
const LOT_SHIFT = 0.45;

export function stageCount(level: LevelDefinition): number {
  return level.districts.length;
}

/** Jarak bertanda rel tahap `stage` dari rel pertama. */
export function railOffset(level: LevelDefinition, stage: number): number {
  return stage * level.ringStep;
}

/** Jarak bertanda titik (x, z) ke rel pertama: negatif di dalam, positif di luar. */
export function ringDistance(level: LevelDefinition, x: number, z: number): number {
  const inner = level.ringStart - level.cornerRadius;
  const qx = Math.abs(x) - inner;
  const qz = Math.abs(z) - inner;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qz), 0) - level.cornerRadius;
}

/**
 * Pita hutan tempat titik berada: -1 = alun-alun/rel pertama, k = pita di luar rel tahap k
 * (dibersihkan selama tahap k), stageCount = di luar pulau.
 * Batas pita digeser RAIL_CLEAR keluar supaya jalur rel berikutnya seluruhnya ada di pita
 * sebelumnya — rel selalu melebar ke lahan yang sudah bersih.
 */
export function bandOf(level: LevelDefinition, x: number, z: number): number {
  const sd = ringDistance(level, x, z) - RAIL_CLEAR;
  if (sd <= 0) return -1;
  return Math.min(stageCount(level), Math.ceil(sd / level.ringStep) - 1);
}

/** Tahap yang relnya melewati titik (x, z), atau -1. */
export function railStageOf(level: LevelDefinition, x: number, z: number): number {
  const sd = ringDistance(level, x, z);
  for (let s = 0; s < stageCount(level); s++) if (Math.abs(sd - railOffset(level, s)) < RAIL_CLEAR) return s;
  return -1;
}

/** Persegi membulat searah jarum jam, titik awal di tengah sisi bawah. */
function ringShape(half: number, radius: number): TrackShape {
  const h = round(half);
  return { corners: [[0, h], [-h, h], [-h, -h], [h, -h], [h, h]], radius: round(radius) };
}

export function stageDef(level: LevelDefinition, stage: number): TrackShape {
  const o = railOffset(level, stage);
  return ringShape(level.ringStart + o, level.cornerRadius + o);
}

/** Posisi stasiun pada rel tahap `stage` (jarak 0 lintasan). */
export function stationPoint(level: LevelDefinition, stage: number): Vec2 {
  return { x: 0, z: level.ringStart + railOffset(level, stage) };
}

/** Setengah lebar pulau (tepi luar pita terakhir di sisi lurus). */
export function islandHalf(level: LevelDefinition): number {
  return level.ringStart + railOffset(level, stageCount(level)) + RAIL_CLEAR;
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

/** Cincin pada jarak bertanda `offset` dari rel pertama (searah jarum jam dari tengah sisi bawah). */
export function ringPath(level: LevelDefinition, offset: number): TrackPath {
  return new TrackPath(ringShape(level.ringStart + offset, Math.max(0.3, level.cornerRadius + offset)));
}

/** Jalur tempat kavling distrik diletakkan. */
export function districtPath(level: LevelDefinition, district: number): TrackPath {
  if (district === 0) return new TrackPath(ringShape(CENTER_HALF, 0.3));
  return ringPath(level, railOffset(level, district - 1) + LOT_SHIFT);
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
 * Kavling tiap distrik tersebar rata di jalurnya, menghadap rel, simetris kiri-kanan dengan
 * celah di depan stasiun (jalan masuk dari stasiun ke alun-alun).
 */
export function resolvePlots(level: LevelDefinition): ResolvedPlot[] {
  const out: ResolvedPlot[] = [];
  level.districts.forEach((dist, di) => {
    const path = districtPath(level, di);
    const n = dist.lots.length;
    const span = (path.length - STATION_GAP) / n;
    dist.lots.forEach((def, i) => {
      const d = STATION_GAP / 2 + (i + 0.5) * span;
      const pos = path.pointAt(d);
      const facing = path.outwardAt(d);
      out.push({ index: out.length, district: di, def, pos, facing, rotY: Math.atan2(facing.x, facing.z) });
    });
  });
  return out;
}

/** Kotak batas pulau yang sudah terlihat pada tahap tertentu (rel + pita yang sedang ditebang). */
export function stageBounds(level: LevelDefinition, stage: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = level.ringStart + railOffset(level, stage + 1) + RAIL_CLEAR;
  return { minX: -h, maxX: h, minZ: -h, maxZ: h };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
