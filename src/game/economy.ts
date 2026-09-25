import { BALANCE } from '../config/balance';
import { getBuilding } from '../config/buildings';
import { LEVELS } from '../config/levels';
import { districtCount, plotsOfLevel, type ResolvedPlot } from './layout';
import { isPlotInside, railOf } from './rail';
import type { TrackPath } from './track';
import type { Cargo, FinalProject, GameState, LevelDefinition } from './types';
import { cellPoints, fieldFor } from './worldgen';

// ---------------------------------------------------------------------------
// Konteks level
// ---------------------------------------------------------------------------

export function levelDef(state: GameState): LevelDefinition {
  return LEVELS[state.levelIndex];
}

export function cycleScale(state: GameState): number {
  return 1 + BALANCE.cycleScale * state.cycle;
}

export function trackOf(state: GameState): TrackPath {
  return railOf(state).track;
}

export function plotsOf(levelIndex: number): ResolvedPlot[] {
  return plotsOfLevel(levelIndex);
}

/** Stasiun berada di titik awal loop (jarak 0), di tengah sisi bawah rel. */
export const STATION_D = 0;

// ---------------------------------------------------------------------------
// Kalibrasi kota: biaya bangunan = hasil hutan
// ---------------------------------------------------------------------------

const bandPointCache = new Map<number, number[]>();

/** Total poin bahan tiap pita hutan sebuah level. */
export function bandPoints(levelIndex: number): number[] {
  let out = bandPointCache.get(levelIndex);
  if (!out) {
    const f = fieldFor(levelIndex);
    out = new Array<number>(districtCount(LEVELS[levelIndex])).fill(0);
    for (let c = 0; c < f.n; c++) if (f.kind[c] >= 0) out[f.band[c]] += cellPoints(f, c);
    bandPointCache.set(levelIndex, out);
  }
  return out;
}

const targetCache = new Map<number, number[]>();

/**
 * Biaya tiap kavling: poin pita hutan k dibagi ke bangunan distrik k menurut bobotnya
 * (sisa pembulatan terbesar dulu), jadi jumlah biaya distrik = hasil pitanya persis.
 * Hutan habis ⇔ kota selesai, tanpa angka yang perlu disetel tangan.
 */
export function plotTargets(levelIndex: number): number[] {
  let out = targetCache.get(levelIndex);
  if (out) return out;
  const plots = plotsOfLevel(levelIndex);
  const points = bandPoints(levelIndex);
  out = new Array<number>(plots.length).fill(0);
  LEVELS[levelIndex].districts.forEach((_, di) => {
    const members = plots.filter((p) => p.district === di);
    const total = points[di];
    const wsum = members.reduce((s, p) => s + p.def.weight, 0);
    const raw = members.map((p) => (total * p.def.weight) / wsum);
    const base = raw.map(Math.floor);
    let rest = total - base.reduce((s, v) => s + v, 0);
    const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k].i]++;
    members.forEach((p, i) => (out![p.index] = base[i]));
  });
  targetCache.set(levelIndex, out);
  return out;
}

export function plotTarget(state: GameState, plot: number): number {
  return plotTargets(state.levelIndex)[plot];
}

export function plotProject(state: GameState, plot: number): FinalProject {
  const p = plotsOf(state.levelIndex)[plot];
  return getBuilding(p.def.building, p.def.variant, plotTarget(state, plot));
}

/** Kavling terbuka begitu rel sudah melewatinya (seluruh lahannya di dalam rel). */
export function isPlotUnlocked(state: GameState, plot: number): boolean {
  return isPlotInside(railOf(state), plot);
}

export function isPlotComplete(state: GameState, plot: number): boolean {
  return state.plots[plot] >= plotTarget(state, plot);
}

/** Bonus koin saat bangunan selesai. */
export function plotBonus(state: GameState, plot: number): number {
  return Math.round(plotTarget(state, plot) * BALANCE.buildBonus * cycleScale(state));
}

// ---------------------------------------------------------------------------
// Rumus angka
// ---------------------------------------------------------------------------

export function trainSpeed(state: GameState): number {
  return BALANCE.speed.base * (1 + BALANCE.speed.perLevel * (state.speedLevel - 1));
}

export function capacity(state: GameState): number {
  return Math.round(BALANCE.capacity.base * Math.pow(BALANCE.capacity.growth, state.capacityLevel - 1));
}

/** Jumlah truk pengantar: bertambah satu untuk tiap distrik kota yang sudah terbuka. */
export function truckCount(state: GameState): number {
  const open = new Set<number>();
  for (const p of plotsOf(state.levelIndex)) if (isPlotUnlocked(state, p.index)) open.add(p.district);
  return BALANCE.truck.base + open.size;
}

/** Muatan satu truk pengantar per perjalanan (poin bahan), ikut naik bersama Kapasitas. */
export function truckCapacity(state: GameState): number {
  return Math.max(1, Math.round(capacity(state) * BALANCE.truck.capacityRatio));
}

export function cutterDps(level: number): number {
  return BALANCE.cutter.dps * Math.pow(BALANCE.cutter.growth, level - 1);
}

/** Jangkauan gerinda dari pusat piringannya (bertambah tiap tingkat merge). */
export function cutterReach(level: number): number {
  return BALANCE.cutter.reach + BALANCE.cutter.reachPerLevel * (level - 1);
}

export function cargoTotal(c: Cargo): number {
  return c.wood + c.stone + c.gem;
}

export function cargoPoints(c: Cargo): number {
  return c.wood * BALANCE.points.wood + c.stone * BALANCE.points.stone + c.gem * BALANCE.points.gem;
}

/** Koin untuk sejumlah poin bahan yang terpasang. */
export function buildCoins(state: GameState, points: number): number {
  return Math.round(points * BALANCE.coinPerPoint * cycleScale(state));
}

function niceRound(v: number): number {
  if (v < 100) return Math.round(v);
  if (v < 1000) return Math.round(v / 5) * 5;
  if (v < 10000) return Math.round(v / 10) * 10;
  return Math.round(v / 100) * 100;
}

function costMult(state: GameState): number {
  return levelDef(state).costScale * cycleScale(state);
}

export function addCost(state: GameState): number {
  const c = BALANCE.cost.add;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.addsPurchased));
}

export function mergeCost(state: GameState): number {
  const c = BALANCE.cost.merge;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.mergesPurchased));
}

export function speedCost(state: GameState): number | null {
  if (state.speedLevel >= BALANCE.speed.maxLevel) return null;
  const c = BALANCE.cost.speed;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.speedLevel - 1));
}

export function capacityCost(state: GameState): number | null {
  if (state.capacityLevel >= BALANCE.capacity.maxLevel) return null;
  const c = BALANCE.cost.capacity;
  return niceRound(c.base * costMult(state) * Math.pow(c.growth, state.capacityLevel - 1));
}

/** Pasangan pemotong setingkat terendah (indeks di array cutters), atau null. */
export function findMergePair(state: GameState): [number, number] | null {
  const w = state.train.cutters;
  for (let lv = 1; lv < BALANCE.maxCutterLevel; lv++) {
    const idx = w.map((l, i) => (l === lv ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) return [idx[idx.length - 2], idx[idx.length - 1]];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Progres
// ---------------------------------------------------------------------------

export function buildingsDone(state: GameState): { done: number; total: number } {
  let done = 0;
  for (let i = 0; i < state.plots.length; i++) if (isPlotComplete(state, i)) done++;
  return { done, total: state.plots.length };
}

/** Porsi poin bahan kota yang sudah terpasang (0..1). */
export function cityProgress(state: GameState): number {
  const targets = plotTargets(state.levelIndex);
  const total = targets.reduce((s, v) => s + v, 0);
  const built = state.plots.reduce((s, v, i) => s + Math.min(v, targets[i]), 0);
  return total ? built / total : 1;
}

/** Porsi blok hutan yang sudah ditebang (0..1). */
export function forestCleared(state: GameState): number {
  const f = fieldFor(state.levelIndex);
  let cut = 0;
  let total = 0;
  for (let c = 0; c < f.n; c++) {
    if (f.kind[c] < 0) continue;
    total++;
    if (state.blocks[c] <= 0) cut++;
  }
  return total ? cut / total : 1;
}
