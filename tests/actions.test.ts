import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { addCutter, mergeCutters, nextProject, upgradeCapacity, upgradeSpeed } from '../src/game/actions';
import { addCost, capacity, cutterDps, cutterReach, plotTarget, trainSpeed } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { railOf } from '../src/game/rail';
import { count, fresh, run } from './helpers';

describe('pemotong & upgrade', () => {
  it('Tambah Pemotong menambah pemotong Lv1 dengan biaya naik & batas jumlah', () => {
    const { state } = fresh();
    state.money = 1e7;
    const c1 = addCost(state);
    expect(addCutter(state, []).ok).toBe(true);
    expect(state.train.cutters).toEqual([1, 1]);
    expect(addCost(state)).toBeGreaterThan(c1);
    while (addCutter(state, []).ok);
    expect(state.train.cutters.length).toBe(BALANCE.maxCutters);
  });

  it('Gabung: dua pemotong setingkat terendah → satu tingkat lebih tinggi, urut dari depan', () => {
    const { state } = fresh();
    state.money = 1e5;
    state.train.cutters = [2, 1, 1, 1];
    const ev: GameEvent[] = [];
    expect(mergeCutters(state, ev).ok).toBe(true);
    expect(state.train.cutters).toEqual([2, 2, 1]);
    expect(mergeCutters(state, ev).ok).toBe(true);
    expect(state.train.cutters).toEqual([3, 1]);
    expect(mergeCutters(state, ev).ok).toBe(false);
    expect(cutterReach(3)).toBeGreaterThan(cutterReach(1));
    expect(cutterDps(3)).toBeGreaterThan(cutterDps(1));
  });

  it('Kecepatan & Kapasitas benar-benar naik; gagal bila uang kurang', () => {
    const { state } = fresh();
    expect(upgradeSpeed(state, []).ok).toBe(false);
    state.money = 1e5;
    const s0 = trainSpeed(state);
    const c0 = capacity(state);
    upgradeSpeed(state, []);
    upgradeCapacity(state, []);
    expect(trainSpeed(state)).toBeGreaterThan(s0);
    expect(capacity(state)).toBeGreaterThan(c0);
  });
});

describe('level berikutnya', () => {
  it('hanya setelah selesai; pindah ke Lembah Batu yang bisa dimainkan, uang dibawa, upgrade direset', () => {
    const { state, rt } = fresh();
    expect(nextProject(state, []).ok).toBe(false);
    state.completed = true;
    state.money = 500;
    state.train.cutters = [3, 2];
    state.speedLevel = 4;
    expect(nextProject(state, []).ok).toBe(true);
    expect(state.levelIndex).toBe(1);
    expect(state.money).toBe(500);
    expect(state.train.cutters).toEqual([1]);
    expect(state.speedLevel).toBe(1);
    expect(railOf(state).levelIndex).toBe(1);
    expect(state.stock).toBe(0);
    expect(state.plots.every((p) => p === 0)).toBe(true);
    rt.drive.holding = true;
    const ev = run(state, rt, 6);
    expect(count(ev, 'cut')).toBeGreaterThan(0);
    expect(plotTarget(state, 0)).toBeGreaterThan(0);
  });

  it('setelah level terakhir kembali ke level 1 dengan putaran naik', () => {
    const { state } = fresh();
    state.completed = true;
    nextProject(state, []);
    state.completed = true;
    nextProject(state, []);
    expect(state.levelIndex).toBe(0);
    expect(state.cycle).toBe(1);
  });
});
