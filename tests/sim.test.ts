import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { bandPoints, buildCoins, capacity, cargoPoints, cargoTotal, isPlotComplete, plotBonus, plotTarget, plotsOf, trackOf } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { isPlotInside, railOf } from '../src/game/rail';
import { cargoDistance, cutterDistance, driveTap, growRail, step, unload } from '../src/game/sim';
import type { GameState } from '../src/game/types';
import { cellPoints, fieldFor } from '../src/game/worldgen';
import { count, fresh, run } from './helpers';

/** Poin bahan yang masih ada di hutan (blok hidup, termasuk yang tertahan di ambang tumbang). */
function forestPoints(state: GameState): number {
  const f = fieldFor(state.levelIndex);
  let pts = 0;
  for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0) pts += cellPoints(f, c);
  return pts;
}

/** State baru dengan pemain menahan layar. */
function driving() {
  const g = fresh();
  g.rt.drive.holding = true;
  return g;
}

describe('kontrol', () => {
  it('tanpa input kereta diam dan tidak ada yang terpotong', () => {
    const { state, rt } = fresh();
    const d0 = state.train.distance;
    const blocks = [...state.blocks];
    const ev = run(state, rt, 5);
    expect(state.train.distance).toBe(d0);
    expect(state.blocks).toEqual(blocks);
    expect(ev.length).toBe(0);
  });

  it('tap memajukan kereta sebentar lalu berhenti; tahan = jalan terus', () => {
    const { state, rt } = fresh();
    driveTap(rt);
    run(state, rt, 3);
    const tapped = state.train.distance;
    expect(tapped).toBeGreaterThan(0.5 + 0.5);
    run(state, rt, 2);
    expect(state.train.distance).toBe(tapped);
    rt.drive.holding = true;
    run(state, rt, 2);
    expect(state.train.distance).toBeGreaterThan(tapped + 5);
  });
});

describe('pemotong', () => {
  it('hanya menggerus blok di sisi kiri yang disentuh gerinda; hasil masuk gerbong muatan', () => {
    const { state, rt } = driving();
    const before = [...state.blocks];
    const ev = run(state, rt, 4);
    expect(count(ev, 'cut')).toBeGreaterThan(0);
    expect(cargoTotal(state.train.cargo)).toBeGreaterThan(0);
    const f = fieldFor(0);
    // Rel bergerak selama tes; semua blok yang tersentuh harus berada di baris terdepan pulau awal.
    for (let c = 0; c < f.n; c++) if (state.blocks[c] !== before[c]) expect(f.band[c]).toBe(0);
    const reach = BALANCE.cutter.side + BALANCE.cutter.reach;
    const t = trackOf(state);
    for (let c = 0; c < f.n; c++) {
      if (state.blocks[c] <= 0 || state.blocks[c] === before[c]) continue;
      const cell = { x: f.x[c], z: f.z[c] };
      const { d, gap } = t.closestDistance(cell);
      expect(gap).toBeLessThan(reach + 0.05);
      const p = t.pointAt(d);
      const o = t.outwardAt(d);
      expect((cell.x - p.x) * o.x + (cell.z - p.z) * o.z).toBeGreaterThan(0);
    }
  });

  it('satu pemotong mengerjakan satu blok sekaligus', () => {
    const { state, rt } = driving();
    state.train.cutters = [1, 1, 1];
    run(state, rt, 1);
    for (let i = 0; i < 60; i++) {
      const snap = [...state.blocks];
      step(state, rt, 1 / 30, []);
      const changed = state.blocks.filter((b, c) => b !== snap[c]).length;
      expect(changed).toBeLessThanOrEqual(3);
      expect(rt.targets.length).toBe(3);
    }
  });

  it('muatan tidak pernah melebihi kapasitas; saat penuh gerinda berhenti', () => {
    const { state, rt } = driving();
    state.train.cutters = [3, 2, 2, 1];
    for (let i = 0; i < 1500; i++) {
      step(state, rt, 1 / 30, []);
      expect(cargoTotal(state.train.cargo)).toBeLessThanOrEqual(capacity(state));
    }
    state.train.cargo = { wood: capacity(state), stone: 0, gem: 0 };
    const snap = [...state.blocks];
    step(state, rt, 1 / 30, []);
    expect(state.blocks).toEqual(snap);
    expect(rt.targets.every((t) => t < 0)).toBe(true);
    expect(rt.fullTime).toBeGreaterThan(0);
  });

  it('susunan kereta: lokomotif → gerbong muatan → pemotong', () => {
    const { state } = fresh();
    state.train.cutters = [2, 1, 1];
    const L = trackOf(state).length;
    const gap = (a: number, b: number) => (a - b + L) % L;
    expect(gap(state.train.distance, cargoDistance(state))).toBeCloseTo(BALANCE.wagonSpacing, 5);
    expect(gap(cargoDistance(state), cutterDistance(state, 0))).toBeCloseTo(BALANCE.wagonSpacing, 5);
    expect(gap(cutterDistance(state, 0), cutterDistance(state, 1))).toBeCloseTo(BALANCE.wagonSpacing, 5);
  });

  it('hutan tidak tumbuh kembali', () => {
    const { state, rt } = driving();
    run(state, rt, 20);
    const cut = state.blocks.map((b, c) => (b === 0 ? c : -1)).filter((c) => c >= 0);
    expect(cut.length).toBeGreaterThan(0);
    rt.drive.holding = false;
    run(state, rt, 120);
    for (const c of cut) expect(state.blocks[c]).toBe(0);
  });
});

describe('stasiun & kota', () => {
  it('muatan tidak dijual: dibongkar lalu langsung terpasang (isi-dulu) dan menjadi koin', () => {
    const { state } = fresh();
    state.train.cargo = { wood: 10, stone: 2, gem: 0 };
    const pts = cargoPoints(state.train.cargo);
    const ev: GameEvent[] = [];
    unload(state, ev);
    expect(cargoTotal(state.train.cargo)).toBe(0);
    expect(state.plots[0]).toBe(pts);
    expect(state.plots.slice(1).every((v) => v === 0)).toBe(true);
    expect(state.stock).toBe(0);
    expect(state.money).toBe(buildCoins(state, pts));
    expect(ev.map((e) => e.type)).toEqual(['unload', 'deliver']);
  });

  it('kelebihan bahan lanjut ke kavling berikutnya; bangunan selesai memberi bonus', () => {
    const { state } = fresh();
    const t0 = plotTarget(state, 0);
    state.train.cargo = { wood: t0 + 5, stone: 0, gem: 0 };
    const ev: GameEvent[] = [];
    unload(state, ev);
    expect(isPlotComplete(state, 0)).toBe(true);
    expect(state.plots[1]).toBe(5);
    expect(state.money).toBe(buildCoins(state, t0) + buildCoins(state, 5) + plotBonus(state, 0));
    expect(count(ev, 'plotComplete')).toBe(1);
  });

  it('bahan menunggu di gudang sampai rel melewati kavling berikutnya', () => {
    const { state } = fresh();
    const plots = plotsOf(0);
    for (const p of plots) if (p.district === 0) state.plots[p.index] = plotTarget(state, p.index);
    state.train.cargo = { wood: 12, stone: 0, gem: 0 };
    unload(state, []);
    expect(state.stock).toBe(12);
    const f = fieldFor(0);
    for (let c = 0; c < f.n; c++) if (f.band[c] <= 1) state.blocks[c] = 0;
    const ev: GameEvent[] = [];
    expect(growRail(state, ev)).toBe(true);
    expect(state.stock).toBe(0);
    const first = plots.find((p) => p.district > 0 && isPlotInside(railOf(state), p.index))!;
    expect(state.plots[first.index]).toBe(12);
    expect(count(ev, 'deliver')).toBe(1);
  });

  it('uang hanya datang dari membangun', () => {
    const { state, rt } = driving();
    state.train.cutters = [2, 2, 1];
    const ev = run(state, rt, 90);
    const earned = ev.reduce((s, e) => s + (e.type === 'deliver' ? e.money : e.type === 'plotComplete' ? e.bonus : 0), 0);
    expect(count(ev, 'deliver')).toBeGreaterThan(0);
    expect(state.money).toBe(earned);
  });
});

describe('kekekalan bahan & level selesai', () => {
  it('tidak ada bahan yang hilang: hutan + muatan + gudang + terpasang = total hasil hutan', () => {
    const { state, rt } = driving();
    state.train.cutters = [4, 3, 3, 2];
    const total = bandPoints(0).reduce((s, v) => s + v, 0);
    for (let sec = 0; sec < 240; sec++) {
      run(state, rt, 1);
      const built = state.plots.reduce((s, v) => s + v, 0);
      expect(forestPoints(state) + cargoPoints(state.train.cargo) + state.stock + built).toBe(total);
    }
  });

  it('level selesai hanya saat kota jadi dan hutan bersih', () => {
    const { state } = fresh();
    const f = fieldFor(0);
    const alive = f.bandCells[f.bandCells.length - 1][0];
    for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0) state.blocks[c] = 0;
    state.blocks[alive] = 1;
    growRail(state, []);
    const last = state.plots.length - 1;
    state.plots = state.plots.map((_, i) => plotTarget(state, i));
    state.plots[last] -= 5;
    state.train.cargo = { wood: 5, stone: 0, gem: 0 };
    unload(state, []);
    expect(state.plots.every((_, i) => isPlotComplete(state, i))).toBe(true);
    expect(state.completed).toBe(false);
    state.blocks[alive] = 0;
    state.plots[last] -= 3;
    state.train.cargo = { wood: 3, stone: 0, gem: 0 };
    const ev: GameEvent[] = [];
    unload(state, ev);
    expect(state.completed).toBe(true);
    expect(count(ev, 'projectComplete')).toBe(1);
  });
});
