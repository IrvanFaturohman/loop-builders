import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import { plotsOf, trackOf } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { isPlotInside, railOf, updateRail } from '../src/game/rail';
import { growRail } from '../src/game/sim';
import { createNewGame, setupLevel } from '../src/game/state';
import type { GameState } from '../src/game/types';
import { cellPoints, fieldFor } from '../src/game/worldgen';
import { count, fresh } from './helpers';

/** Jarak terdekat titik-titik rel ke pusat blok hidup. */
function minClearance(state: GameState): number {
  const f = fieldFor(state.levelIndex);
  const t = trackOf(state);
  const p = { x: 0, z: 0 };
  let best = Infinity;
  for (let d = 0; d < t.length; d += 0.05) {
    t.pointAt(d, p);
    for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0) best = Math.min(best, Math.hypot(f.x[c] - p.x, f.z[c] - p.z));
  }
  return best;
}

function cellAt(state: GameState, x: number, z: number): number {
  const f = fieldFor(state.levelIndex);
  return (z + f.half - 0.5) * f.cols + (x + f.half - 0.5);
}

/** Posisi z rel terbawah pada x tertentu (sisi bawah). */
function railZ(state: GameState, x: number): number {
  const t = trackOf(state);
  const p = { x: 0, z: 0 };
  let z = -Infinity;
  for (let d = 0; d < t.length; d += 0.02) {
    t.pointAt(d, p);
    if (Math.abs(p.x - x) < 0.03) z = Math.max(z, p.z);
  }
  return z;
}

/** Semua ruas rel lurus sejajar sumbu (belokan hanya siku). */
function axisAligned(state: GameState): boolean {
  const c = trackOf(state).def.corners;
  return c.every((p, i) => {
    const q = c[(i + 1) % c.length];
    return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6;
  });
}

describe('rel lurus mengikuti baris hutan', () => {
  LEVELS.forEach((level, li) => {
    it(`${level.id}: rel awal persegi searah jarum jam, stasiun di tengah bawah, menempel ke baris pertama`, () => {
      const state = createNewGame();
      if (li > 0) setupLevel(state, li, 0);
      const t = trackOf(state);
      expect(t.clockwise).toBe(true);
      expect(t.def.corners.length).toBe(5);
      expect(axisAligned(state)).toBe(true);
      const p0 = t.pointAt(0);
      expect(p0.x).toBeCloseTo(0, 6);
      expect(p0.z).toBeCloseTo(level.ringStart, 6);
      expect(minClearance(state)).toBeCloseTo(1, 2);
    });
  });

  it('1–2 blok hancur tidak membuat rel berkelok; 3 blok berjejer → rel maju satu baris dengan belokan siku', () => {
    const { state } = fresh();
    state.blocks[cellAt(state, -0.5, 5.5)] = 0;
    state.blocks[cellAt(state, 0.5, 5.5)] = 0;
    expect(updateRail(state)).toBeNull();
    state.blocks[cellAt(state, 1.5, 5.5)] = 0;
    expect(updateRail(state)).not.toBeNull();
    expect(railZ(state, 0.5)).toBeCloseTo(5.5, 2);
    expect(railZ(state, -2.5)).toBeCloseTo(4.5, 2);
    expect(axisAligned(state)).toBe(true);
    expect(minClearance(state)).toBeGreaterThan(0.95);
  });

  it('batu keras yang tersisa dikitari rel dengan belokan siku, lalu rel lurus lagi saat batunya hancur', () => {
    const { state } = fresh();
    const rock = cellAt(state, 0.5, 6.5);
    for (let x = -4.5; x <= 4.5; x++) {
      state.blocks[cellAt(state, x, 5.5)] = 0;
      if (cellAt(state, x, 6.5) !== rock) state.blocks[cellAt(state, x, 6.5)] = 0;
    }
    updateRail(state);
    expect(railZ(state, 0.5)).toBeCloseTo(5.5, 2);
    expect(railZ(state, -3.5)).toBeCloseTo(6.5, 2);
    expect(axisAligned(state)).toBe(true);
    expect(minClearance(state)).toBeGreaterThan(0.95);
    state.blocks[rock] = 0;
    updateRail(state);
    expect(railZ(state, 0.5)).toBeCloseTo(6.5, 2);
  });

  it('rel hanya maju, selalu lurus-siku, dan menjaga jarak dari blok hidup', () => {
    const { state } = fresh();
    const f = fieldFor(0);
    let prev = Uint8Array.from(railOf(state).inside);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    for (let round = 0; round < 12; round++) {
      const front = [];
      for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0 && f.band[c] <= 1) front.push(c);
      for (let k = 0; k < 40 && front.length; k++) state.blocks[front[Math.floor(rnd() * front.length)]] = 0;
      updateRail(state);
      const inside = railOf(state).inside;
      for (let c = 0; c < f.n; c++) expect(inside[c]).toBeGreaterThanOrEqual(prev[c]);
      prev = Uint8Array.from(inside);
      expect(axisAligned(state)).toBe(true);
      expect(trackOf(state).clockwise).toBe(true);
    }
    // Blok terkurung akan dibongkar growRail; sisanya harus di luar rel dengan jarak aman.
    for (let c = 0; c < f.n; c++) if (railOf(state).inside[c]) state.blocks[c] = Math.min(0, state.blocks[c]);
    expect(minClearance(state)).toBeGreaterThan(0.95);
  });

  it('blok yang terkurung di dalam rel dibongkar otomatis ke gudang', () => {
    const { state } = fresh();
    const f = fieldFor(0);
    const rock = cellAt(state, 0.5, 6.5);
    for (let c = 0; c < f.n; c++) if (f.band[c] <= 1 && c !== rock) state.blocks[c] = 0;
    const ev: GameEvent[] = [];
    expect(growRail(state, ev)).toBe(true);
    expect(state.blocks[rock]).toBe(0);
    expect(count(ev, 'harvest')).toBe(1);
    const harvested = ev.find((e) => e.type === 'harvest');
    expect(harvested && harvested.type === 'harvest' && harvested.points).toBe(cellPoints(f, rock));
  });

  it('posisi kereta terjaga & kavling terbuka saat rel melewatinya', () => {
    const { state } = fresh();
    state.train.distance = trackOf(state).length * 0.6;
    const angle = () => {
      const p = trackOf(state).pointAt(state.train.distance);
      return Math.atan2(p.z, p.x);
    };
    const a0 = angle();
    const f = fieldFor(0);
    for (let c = 0; c < f.n; c++) if (f.band[c] <= 1) state.blocks[c] = 0;
    const ev: GameEvent[] = [];
    expect(growRail(state, ev)).toBe(true);
    expect(Math.abs(angle() - a0)).toBeLessThan(0.2);
    expect(count(ev, 'railGrow')).toBe(1);
    const d1 = plotsOf(0).filter((p) => p.district === 1);
    for (const p of d1) expect(isPlotInside(railOf(state), p.index)).toBe(true);
    expect(count(ev, 'plotOpen')).toBeGreaterThanOrEqual(d1.length);
  });
});
