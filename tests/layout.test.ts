import { describe, expect, it } from 'vitest';
import { getBuilding } from '../src/config/buildings';
import { LEVELS } from '../src/config/levels';
import { completedModuleCount } from '../src/game/building';
import { bandPoints, cutterReach, plotTargets, plotsOf, trackFor } from '../src/game/economy';
import { LOT_D, LOT_W, RAIL_CLEAR, stageCount, stationPoint, type ResolvedPlot } from '../src/game/layout';
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

function inside(poly: Vec2[], x: number, z: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if ((q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x) < 0) return false;
  }
  return true;
}

function perimeter(poly: Vec2[], step = 0.1): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / step);
    for (let k = 0; k < n; k++) out.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n });
  }
  return out;
}

describe('tata letak & hutan', () => {
  LEVELS.forEach((level, li) => {
    const N = stageCount(level);

    it(`${level.id}: rel cincin searah jarum jam, makin panjang, stasiun di jarak 0`, () => {
      let prev = 0;
      for (let s = 0; s < N; s++) {
        const t = trackFor(li, s);
        expect(t.clockwise).toBe(true);
        expect(t.length).toBeGreaterThan(prev + 5);
        prev = t.length;
        const st = stationPoint(level, s);
        const p0 = t.pointAt(0);
        expect(Math.hypot(p0.x - st.x, p0.z - st.z)).toBeLessThan(1e-6);
      }
    });

    it(`${level.id}: setiap blok terjangkau lengan pemotong Lv1 di sisi kiri rel pitanya`, () => {
      const f = fieldFor(li);
      const reach = cutterReach(1);
      let blocks = 0;
      for (let c = 0; c < f.n; c++) {
        if (f.kind[c] < 0) continue;
        blocks++;
        const b = f.band[c];
        expect(b >= 0 && b < N, `sel ${c} di luar pita`).toBe(true);
        const t = trackFor(li, b);
        const cell = { x: f.x[c], z: f.z[c] };
        const { d, gap } = t.closestDistance(cell);
        expect(gap, `sel ${c} pita ${b}`).toBeLessThan(reach - 0.05);
        const p = t.pointAt(d);
        const o = t.outwardAt(d);
        expect((cell.x - p.x) * o.x + (cell.z - p.z) * o.z).toBeGreaterThan(0);
      }
      expect(blocks).toBeGreaterThan(300);
    });

    it(`${level.id}: rel berikutnya selalu di lahan pita sebelumnya; rel pertama & alun-alun bersih`, () => {
      const f = fieldFor(li);
      const hp = initialBlocks(li);
      for (let c = 0; c < f.n; c++) {
        const rs = f.railStage[c];
        if (rs === 0 || f.band[c] < 0) expect(hp[c]).toBe(-1);
        if (rs >= 1 && f.kind[c] >= 0) expect(f.band[c]).toBe(rs - 1);
      }
      const center = Math.floor(f.half) * f.cols + Math.floor(f.half);
      expect(hp[center]).toBe(-1);
    });

    it(`${level.id}: kavling tidak saling menimpa, jauh dari rel, dan di lahan yang sudah bersih`, () => {
      const f = fieldFor(li);
      const plots = plotsOf(li);
      const lots = plots.map(lotCorners);
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) expect(overlaps(lots[i], lots[j]), `kavling ${i} & ${j}`).toBe(false);
      plots.forEach((p, i) => {
        const edge = perimeter(lots[i]);
        for (let s = p.district; s < N; s++) {
          const t = trackFor(li, s);
          for (const q of edge) expect(t.closestDistance(q).gap, `kavling ${i} vs rel ${s}`).toBeGreaterThan(RAIL_CLEAR);
        }
        for (let c = 0; c < f.n; c++) if (inside(lots[i], f.x[c], f.z[c])) expect(f.band[c], `kavling ${i} sel ${c}`).toBeLessThan(p.district);
      });
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
