import { describe, expect, it } from 'vitest';
import { getBuilding } from '../src/config/buildings';
import { LEVELS } from '../src/config/levels';
import { completedModuleCount } from '../src/game/building';
import { bandPoints, plotTargets, plotsOf } from '../src/game/economy';
import { cityPlanOf, deliveryRoute, districtCount, islandBounds, type ResolvedPlot } from '../src/game/layout';
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
  ].map(([a, b]) => ({ x: p.pos.x + (t.x * a * p.w) / 2 + (f.x * b * p.d) / 2, z: p.pos.z + (t.z * a * p.w) / 2 + (f.z * b * p.d) / 2 }));
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

    it(`${level.id}: kota grid: kavling tidak menimpa jalan/taman dan tiap kavling luar punya jalan di depannya`, () => {
      const plan = cityPlanOf(li);
      const rect = (cx: number, cz: number, ux: number, uz: number, hl: number, hw: number): Vec2[] =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([a, b]) => ({ x: cx + ux * a * hl - uz * b * hw, z: cz + uz * a * hl + ux * b * hw }));
      const roads = plan.roads.map((r) => {
        const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
        return rect((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / len, (r.z1 - r.z0) / len, len / 2, r.w / 2);
      });
      const parks = plan.parks.map((p) => rect(p.pos.x, p.pos.z, 1, 0, (Math.abs(p.facing.x) > 0 ? p.d : p.w) / 2, (Math.abs(p.facing.x) > 0 ? p.w : p.d) / 2));
      for (const p of plan.plots) {
        const lot = lotCorners(p);
        roads.forEach((r, k) => expect(overlaps(lot, r), `kavling ${p.index} × jalan ${k}`).toBe(false));
        parks.forEach((r, k) => expect(overlaps(lot, r), `kavling ${p.index} × taman ${k}`).toBe(false));
        if (p.district === 0) continue;
        const onRoad = plan.roads.some((r) => {
          const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
          const t = ((p.front.x - r.x0) * (r.x1 - r.x0) + (p.front.z - r.z0) * (r.z1 - r.z0)) / (len * len);
          if (t < -1e-6 || t > 1 + 1e-6) return false;
          return Math.hypot(r.x0 + (r.x1 - r.x0) * t - p.front.x, r.z0 + (r.z1 - r.z0) * t - p.front.z) < 1e-6;
        });
        expect(onRoad, `kavling ${p.index} menghadap jalan`).toBe(true);
      }
      for (let d = 0; d < N; d++) expect(plan.plots.filter((p) => p.district === d).length).toBe(level.districts[d].lots.length);
    });

    it(`${level.id}: rute truk dari stasiun ke tiap kavling luar selalu di atas jalan`, () => {
      const plan = cityPlanOf(li);
      const onRoad = (x: number, z: number) =>
        plan.roads.some((r) => {
          const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
          const t = Math.max(0, Math.min(1, ((x - r.x0) * (r.x1 - r.x0) + (z - r.z0) * (r.z1 - r.z0)) / (len * len)));
          return Math.hypot(r.x0 + (r.x1 - r.x0) * t - x, r.z0 + (r.z1 - r.z0) * t - z) <= r.w / 2 + 1e-6;
        });
      // Stasiun di rel akhir (tepi pulau) — rute terpanjang.
      const start = { x: 0, z: islandBounds(level).maxZ - 1.5 };
      for (const p of plan.plots) {
        if (p.district === 0) continue;
        const route = deliveryRoute(li, p.index, start);
        expect(route[route.length - 1]).toEqual(p.front);
        for (let i = 0; i + 1 < route.length; i++)
          for (let k = 0; k <= 10; k++) {
            const x = route[i].x + ((route[i + 1].x - route[i].x) * k) / 10;
            const z = route[i].z + ((route[i + 1].z - route[i].z) * k) / 10;
            expect(onRoad(x, z), `kavling ${p.index} ruas ${i} titik ${k}`).toBe(true);
          }
      }
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
        expect(completedModuleCount(proj, 24)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
