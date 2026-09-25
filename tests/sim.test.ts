import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { bandPoints, buildCoins, capacity, cargoPoints, cargoTotal, isPlotComplete, plotTarget, plotsOf, trackOf, truckCapacity, truckCount } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { isPlotInside, railOf } from '../src/game/rail';
import { cargoDistance, cutterDistance, dispatchTrucks, driveTap, growRail, step, trainSpan, unload } from '../src/game/sim';
import type { GameState } from '../src/game/types';
import { fieldFor, remainingPoints } from '../src/game/worldgen';
import { count, fresh, run } from './helpers';

/** Poin bahan yang masih tersimpan di hutan (blok hidup, belum keluar saat digerus). */
function forestPoints(state: GameState): number {
  const f = fieldFor(state.levelIndex);
  let pts = 0;
  for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0) pts += remainingPoints(f, c, state.blocks[c]);
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
    // Pohon hijau butuh 2 lewat pemotong Lv1: tebangan pertama di putaran kedua.
    const ev = run(state, rt, 22);
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

  it('bahan keluar selama digerus walaupun bloknya belum habis', () => {
    const { state, rt } = driving();
    const ev = run(state, rt, 5);
    expect(state.stats.totalCut).toBe(0);
    expect(ev.some((e) => e.type === 'cut' && !e.felled)).toBe(true);
    expect(cargoTotal(state.train.cargo)).toBeGreaterThan(0);
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

  it('muatan tidak pernah melebihi kapasitas; saat penuh gerinda tetap memotong dan hasilnya jatuh ke rel', () => {
    const { state, rt } = driving();
    state.train.cutters = [3, 2, 2, 1];
    for (let i = 0; i < 1500; i++) {
      step(state, rt, 1 / 30, []);
      expect(cargoTotal(state.train.cargo)).toBeLessThanOrEqual(capacity(state));
    }
    // Kosongkan tumpukan lama lalu penuhi gerbong: blok tetap tumbang, bahannya jatuh ke rel.
    state.railItems = [];
    state.train.cargo = { wood: capacity(state), stone: 0, gem: 0 };
    const alive = state.blocks.filter((b) => b > 0).length;
    const ev = run(state, rt, 3);
    expect(state.blocks.filter((b) => b > 0).length).toBeLessThan(alive);
    expect(count(ev, 'drop')).toBeGreaterThan(0);
    expect(count(ev, 'cut')).toBe(0);
    expect(state.railItems.length).toBe(count(ev, 'drop') - count(ev, 'pickup'));
    expect(cargoTotal(state.train.cargo)).toBe(capacity(state));
    expect(rt.fullTime).toBeGreaterThan(0);
  });

  it('tumpukan di rel dipungut gerbong muatan yang melintas, hanya bila masih muat', () => {
    const { state, rt } = fresh();
    const t = trackOf(state);
    const ahead = t.wrap(cargoDistance(state) + 1.5);
    const item = { d: ahead, res: 'wood' as const, amount: 3 };
    state.railItems = [item];
    state.train.cargo = { wood: capacity(state) - 2, stone: 0, gem: 0 };
    rt.drive.holding = true;
    run(state, rt, 1.2);
    // Tidak muat: tetap di rel.
    expect(state.railItems).toContain(item);
    // Putaran berikutnya dengan gerbong kosong: terpungut.
    state.train.cargo = { wood: 0, stone: 0, gem: 0 };
    state.train.distance = t.wrap(item.d - 2 + BALANCE.wagonSpacing);
    const ev = run(state, rt, 1.2);
    expect(state.railItems).not.toContain(item);
    expect(ev.some((e) => e.type === 'pickup' && e.item === item)).toBe(true);
    expect(state.train.cargo.wood).toBeGreaterThanOrEqual(3);
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
  it('muatan tidak dijual: dibongkar ke penyimpanan, truk mengangkutnya ke bangunan, koin saat tiba', () => {
    const { state, rt } = fresh();
    state.train.cargo = { wood: 10, stone: 2, gem: 0 };
    const pts = cargoPoints(state.train.cargo);
    const ev: GameEvent[] = [];
    unload(state, ev);
    expect(cargoTotal(state.train.cargo)).toBe(0);
    expect(ev.map((e) => e.type)).toEqual(['unload']);
    // Bahan sudah naik truk (penyimpanan kosong) tapi belum terpasang.
    expect(state.stock).toBe(0);
    expect(state.trucks.length).toBe(1);
    expect(state.trucks[0].load).toBe(pts);
    expect(state.plots[0]).toBe(0);
    expect(state.money).toBe(0);
    // Kereta diam: truk tetap jalan, tiba, lalu pulang.
    const later = run(state, rt, 20);
    expect(state.plots[0]).toBe(pts);
    expect(state.money).toBe(buildCoins(state, pts));
    expect(count(later, 'deliver')).toBe(1);
    expect(state.trucks.length).toBe(0);
  });

  it('truk punya kapasitas dan bolak-balik; bangunan selesai memberi bonus', () => {
    const { state, rt } = fresh();
    const cap = truckCapacity(state);
    const t0 = plotTarget(state, 0);
    state.stock = Math.max(t0, cap * truckCount(state)) + 50;
    dispatchTrucks(state);
    expect(state.trucks.length).toBe(truckCount(state));
    for (const t of state.trucks) expect(t.load).toBeLessThanOrEqual(cap);
    // Sisanya menunggu di penyimpanan sampai ada truk yang kembali.
    expect(state.stock).toBeGreaterThan(0);
    const ev = run(state, rt, 90);
    expect(count(ev, 'deliver')).toBeGreaterThan(truckCount(state));
    expect(isPlotComplete(state, 0)).toBe(true);
    expect(state.plots[0]).toBe(t0);
    expect(count(ev, 'plotComplete')).toBeGreaterThanOrEqual(1);
  });

  it('bahan menunggu di penyimpanan sampai rel melewati kavling berikutnya', () => {
    const { state, rt } = fresh();
    const plots = plotsOf(0);
    for (const p of plots) if (p.district === 0) state.plots[p.index] = plotTarget(state, p.index);
    state.train.cargo = { wood: 12, stone: 0, gem: 0 };
    unload(state, []);
    expect(state.stock).toBe(12);
    expect(state.trucks.length).toBe(0);
    const f = fieldFor(0);
    for (let c = 0; c < f.n; c++) if (f.band[c] <= 1) state.blocks[c] = 0;
    expect(growRail(state, [], false)).toBe(true);
    expect(state.stock).toBeLessThan(12);
    const ev = run(state, rt, 30);
    const first = plots.find((p) => p.district > 0 && isPlotInside(railOf(state), p.index))!;
    expect(state.plots[first.index]).toBeGreaterThan(0);
    expect(count(ev, 'deliver')).toBeGreaterThan(0);
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

describe('rel maju di belakang kereta', () => {
  it('kereta tidak pernah tergeser saat rel berubah: tiap langkah hanya maju sejauh lajunya', () => {
    const { state, rt } = driving();
    state.train.cutters = [4, 3, 3, 2];
    const h = 1 / 30;
    const cars = () => {
      const t = trackOf(state);
      const sp = trainSpan(state);
      return [0, 0.5, 1].map((k) => t.pointAt(sp.from + k * sp.length));
    };
    let grows = 0;
    for (let k = 0; k < 90 * 30; k++) {
      const a = cars();
      const ev: GameEvent[] = [];
      step(state, rt, h, ev);
      grows += count(ev, 'railGrow');
      const move = BALANCE.speed.base * rt.drive.v * h;
      cars().forEach((p, i) => expect(Math.hypot(p.x - a[i].x, p.z - a[i].z)).toBeLessThanOrEqual(move + 1e-3));
    }
    expect(grows).toBeGreaterThan(10);
  });
});

describe('kekekalan bahan & level selesai', () => {
  it('tidak ada bahan yang hilang: hutan + muatan + tumpukan di rel + penyimpanan + truk + terpasang = total hasil hutan', () => {
    const { state, rt } = driving();
    state.train.cutters = [4, 3, 3, 2];
    const total = bandPoints(0).reduce((s, v) => s + v, 0);
    for (let sec = 0; sec < 240; sec++) {
      run(state, rt, 1);
      const built = state.plots.reduce((s, v) => s + v, 0);
      const onRail = state.railItems.reduce((p, it) => p + it.amount * BALANCE.points[it.res], 0);
      const onTrucks = state.trucks.reduce((p, t) => p + t.load, 0);
      expect(forestPoints(state) + cargoPoints(state.train.cargo) + onRail + state.stock + onTrucks + built).toBe(total);
    }
  });

  it('level selesai hanya saat kota jadi dan hutan bersih (setelah kiriman terakhir tiba)', () => {
    const { state, rt } = fresh();
    const f = fieldFor(0);
    const alive = f.bandCells[f.bandCells.length - 1][0];
    for (let c = 0; c < f.n; c++) if (state.blocks[c] > 0) state.blocks[c] = 0;
    state.blocks[alive] = 1;
    growRail(state, [], false);
    const last = state.plots.length - 1;
    state.plots = state.plots.map((_, i) => plotTarget(state, i));
    state.plots[last] -= 5;
    state.stock = 0;
    state.trucks = [];
    state.train.cargo = { wood: 5, stone: 0, gem: 0 };
    unload(state, []);
    run(state, rt, 60);
    expect(state.plots.every((_, i) => isPlotComplete(state, i))).toBe(true);
    expect(state.completed).toBe(false);
    state.blocks[alive] = 0;
    state.plots[last] -= 3;
    state.train.cargo = { wood: 3, stone: 0, gem: 0 };
    unload(state, []);
    expect(state.completed).toBe(false);
    const ev = run(state, rt, 60);
    expect(state.completed).toBe(true);
    expect(count(ev, 'projectComplete')).toBe(1);
  });
});
