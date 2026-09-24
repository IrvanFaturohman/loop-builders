import { describe, expect, it } from 'vitest';
import { getBuilding } from '../src/config/buildings';
import { LEVELS } from '../src/config/levels';
import { completedModuleCount } from '../src/game/building';
import { bandPoints, plotTargets, plotsOf } from '../src/game/economy';
import { districtCount, LOT_D, LOT_W, type ResolvedPlot } from '../src/game/layout';
import { isPlotInside, railOf, updateRail } from '../src/game/rail';
import { createNewGame, setupLevel } from '../src/game/state';
import type { Vec2 } from '../src/game/types';
import { fieldFor, initialBlocks } from '../src/game/worldgen';

/** Empat sudut kavling (persegi panjang berputar menghadap rel). */
function lotCorners(p: ResolvedPlot): Vec2[] {
  const f = p.facing;
  const t = { x: -f.z, z: f.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => ({ x: p.pos.x + (t.x * a * LOT_W) / 2 + (f.x * b * LOT_D) / 2, z: p.pos.z + (t.z * a * LOT_W) / 2 + (f.z * b * LOT_D) / 2 }));
}

/** Uji sumbu pemisah untuk dua poligon cembung. */
function overlaps(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = -(q.z - p.z);
      const az = q.x - p.x;
      const proj = (pts: Vec2[]) => pts.map((v) => v.x * ax + v.z * az);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function levelState(li: number) {
  const state = createNewGame();
  if (li > 0) setupLevel(state, li, 0);
  return state;
}

describe('tata letak & hutan', () => {
  LEVELS.forEach((level, li) => {
    const N = districtCount(level);

    it(`${level.id}: hutan rapat berbaris tanpa celah; baris pertama tepat di luar kota awal`, () => {
      const f = fieldFor(li);
      const hp = initialBlocks(li);
      let blocks = 0;
      for (let c = 0; c < f.n; c++) {
        const inIsland = f.band[c] >= 0 && f.band[c] < N;
        expect(f.kind[c] >= 0, `sel ${c}`).toBe(inIsland);
        if (inIsland) blocks++;
        else expect(hp[c]).toBe(-1);
      }
      expect(blocks).toBeGreaterThan(500);
      // Sisi bawah yang lurus: baris-baris sejajar rel, baris pertama di z = 5.5.
      for (let x = -1.5; x <= 1.5; x++) {
        const at = (z: number) => f.kind[(z + f.half - 0.5) * f.cols + (x + f.half - 0.5)];
        expect(at(4.5)).toBe(-1);
        for (const z of [5.5, 6.5, 7.5, 8.5]) expect(at(z)).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${level.id}: kavling tidak saling menimpa; alun-alun sudah di dalam rel awal, sisanya terbuka saat hutan habis`, () => {
      const plots = plotsOf(li);
      const lots = plots.map(lotCorners);
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i], lots[j]), `kavling ${i} & ${j}`).toBe(false);
      const state = levelState(li);
      for (const p of plots) expect(isPlotInside(railOf(state), p.index), `kavling ${p.index}`).toBe(p.district === 0);
      state.blocks = state.blocks.map((b) => (b > 0 ? 0 : b));
      updateRail(state);
      for (const p of plots) expect(isPlotInside(railOf(state), p.index), `kavling ${p.index}`).toBe(true);
      for (let d = 0; d < N; d++) expect(plots.some((p) => p.district === d)).toBe(true);
    });

    it(`${level.id}: biaya distrik = hasil pita hutannya; bangunan langsung tumbuh`, () => {
      const plots = plotsOf(li);
      const targets = plotTargets(li);
      const points = bandPoints(li);
      for (let d = 0; d < N; d++) {
        const sum = plots.filter((p) => p.district === d).reduce((s, p) => s + targets[p.index], 0);
        expect(sum).toBe(points[d]);
      }
      for (const p of plots) {
        const proj = getBuilding(p.def.building, p.def.variant, targets[p.index]);
        expect(proj.target).toBe(targets[p.index]);
        expect(completedModuleCount(proj, 6)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
