import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { LEVELS } from '../src/config/levels';
import {
  bandPoints,
  buildCoins,
  capacity,
  cargoPoints,
  cargoTotal,
  cutterReach,
  isPlotComplete,
  plotBonus,
  plotTarget,
  plotsOf,
  trackOf,
} from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { stageCount } from '../src/game/layout';
import { cargoDistance, cutterDistance, expandIfCleared, step, unload } from '../src/game/sim';
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

/** Tebang seluruh pita (simulasikan pita sudah bersih). */
function clearBand(state: GameState, band: number) {
  for (const c of fieldFor(state.levelIndex).bandCells[band]) state.blocks[c] = 0;
}

describe('pemotong', () => {
  it('hanya memotong blok di sisi kiri (luar loop) dalam jangkauan lengan; hasil masuk gerbong muatan', () => {
    const { state, rt } = fresh();
    const before = [...state.blocks];
    const ev = run(state, rt, 4);
    expect(count(ev, 'cut')).toBeGreaterThan(0);
    expect(cargoTotal(state.train.cargo)).toBeGreaterThan(0);
    const f = fieldFor(0);
    const t = trackOf(state);
    for (let c = 0; c < f.n; c++) {
      if (state.blocks[c] === before[c]) continue;
      const cell = { x: f.x[c], z: f.z[c] };
      const { d, gap } = t.closestDistance(cell);
      expect(gap).toBeLessThan(cutterReach(1) + 0.05);
      const p = t.pointAt(d);
      const o = t.outwardAt(d);
      expect((cell.x - p.x) * o.x + (cell.z - p.z) * o.z).toBeGreaterThan(0);
    }
  });

  it('satu pemotong mengerjakan satu blok sekaligus', () => {
    const { state, rt } = fresh();
    state.train.cutters = [1, 1, 1];
    run(state, rt, 1);
    for (let i = 0; i < 60; i++) {
      const snap = [...state.blocks];
      step(state, rt, 1 / 30, []);
      const changed = state.blocks.filter((b, c) => b !== snap[c]).length;
      expect(changed).toBeLessThanOrEqual(3);
      const live = rt.targets.filter((t) => t >= 0);
      expect(new Set(live).size).toBe(live.length);
    }
  });

  it('muatan tidak pernah melebihi kapasitas; saat penuh lengan ditarik dan hutan tidak berubah', () => {
    const { state, rt } = fresh();
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
    const { state, rt } = fresh();
    run(state, rt, 20);
    const cut = state.blocks.map((b, c) => (b === 0 ? c : -1)).filter((c) => c >= 0);
    expect(cut.length).toBeGreaterThan(0);
    state.train.cutters = [];
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

  it('bahan menunggu di gudang sampai distrik baru terbuka', () => {
    const { state, rt } = fresh();
    const plots = plotsOf(0);
    for (const p of plots) if (p.district === 0) state.plots[p.index] = plotTarget(state, p.index);
    state.train.cargo = { wood: 12, stone: 0, gem: 0 };
    unload(state, []);
    expect(state.stock).toBe(12);
    clearBand(state, 0);
    const ev: GameEvent[] = [];
    expect(expandIfCleared(state, rt, ev)).toBe(true);
    expect(state.stock).toBe(0);
    const first = plots.find((p) => p.district === 1)!;
    expect(state.plots[first.index]).toBe(12);
    expect(ev.map((e) => e.type)).toEqual(['expand', 'deliver']);
  });

  it('uang hanya datang dari membangun', () => {
    const { state, rt } = fresh();
    state.train.cutters = [2, 2, 1];
    const ev = run(state, rt, 90);
    const earned = ev.reduce((s, e) => s + (e.type === 'deliver' ? e.money : e.type === 'plotComplete' ? e.bonus : 0), 0);
    expect(count(ev, 'deliver')).toBeGreaterThan(0);
    expect(state.money).toBe(earned);
  });
});

describe('rel melebar otomatis', () => {
  it('saat pita bersih: tahap naik, jalur rel baru kosong, stasiun tetap di depan/belakang kereta, muatan & pemotong tetap', () => {
    const { state, rt } = fresh();
    state.train.cutters = [2, 1];
    run(state, rt, 3);
    const cargo = { ...state.train.cargo };
    const L0 = trackOf(state).length;
    const frac = state.train.distance / L0;
    clearBand(state, 0);
    const ev: GameEvent[] = [];
    step(state, rt, 1 / 30, ev);
    expect(state.expandStage).toBe(1);
    expect(count(ev, 'expand')).toBe(1);
    expect(state.train.cargo).toEqual(cargo);
    expect(state.train.cutters).toEqual([2, 1]);
    expect(rt.freeze).toBeGreaterThan(0);
    expect(state.train.distance / trackOf(state).length).toBeCloseTo(frac, 1);
    const f = fieldFor(0);
    for (let c = 0; c < f.n; c++) if (f.railStage[c] === 1) expect(state.blocks[c]).toBe(-1);
  });

  it('tidak melebar selama pita masih ada blok, dan berhenti di tahap terakhir', () => {
    const { state, rt } = fresh();
    expect(expandIfCleared(state, rt, [])).toBe(false);
    const N = stageCount(LEVELS[0]);
    for (let b = 0; b < N; b++) clearBand(state, b);
    for (let s = 1; s < N; s++) {
      expect(expandIfCleared(state, rt, [])).toBe(true);
      expect(state.expandStage).toBe(s);
    }
    expect(expandIfCleared(state, rt, [])).toBe(false);
  });
});

describe('kekekalan bahan & level selesai', () => {
  it('tidak ada bahan yang hilang: hutan + muatan + gudang + terpasang = total hasil hutan', () => {
    const { state, rt } = fresh();
    state.train.cutters = [4, 3, 3, 2];
    const total = bandPoints(0).reduce((s, v) => s + v, 0);
    for (let sec = 0; sec < 240; sec++) {
      run(state, rt, 1);
      const built = state.plots.reduce((s, v) => s + v, 0);
      expect(forestPoints(state) + cargoPoints(state.train.cargo) + state.stock + built).toBe(total);
    }
  });

  it('level selesai hanya saat kota jadi dan hutan bersih', () => {
    const { state, rt } = fresh();
    const N = stageCount(LEVELS[0]);
    for (let b = 0; b < N; b++) clearBand(state, b);
    for (let s = 1; s < N; s++) expandIfCleared(state, rt, []);
    const last = state.plots.length - 1;
    state.plots = state.plots.map((_, i) => plotTarget(state, i));
    state.plots[last] -= 5;
    const alive = fieldFor(0).bandCells[N - 1][0];
    state.blocks[alive] = 1;
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
