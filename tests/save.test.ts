import { describe, expect, it } from 'vitest';
import { addCutter } from '../src/game/actions';
import { plotTarget } from '../src/game/economy';
import { expandIfCleared } from '../src/game/sim';
import { deserialize, loadGame, SAVE_KEY, saveGame, serialize } from '../src/game/save';
import { fieldFor } from '../src/game/worldgen';
import { fresh, run } from './helpers';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('save/load', () => {
  it('memulihkan hutan (HP blok), kereta/pemotong/muatan, rel, kavling, gudang, uang', () => {
    const { state, rt } = fresh();
    state.money = 300;
    addCutter(state, []);
    for (const c of fieldFor(0).bandCells[0]) state.blocks[c] = 0;
    expandIfCleared(state, rt, []);
    rt.freeze = 0;
    state.stock = 7;
    run(state, rt, 23.7);
    expect(state.expandStage).toBe(1);
    const s2 = deserialize(serialize(state))!;
    expect(s2).not.toBeNull();
    const { blocks: b1, ...rest1 } = state;
    const { blocks: b2, ...rest2 } = s2;
    expect(rest2).toEqual(rest1);
    for (let i = 0; i < b1.length; i++) expect(b2[i]).toBeCloseTo(b1[i], 1);
  });

  it('save rusak / versi lama → null dan dicadangkan', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"schema":3,"state":{"levelIndex":0}}');
    const res = loadGame(storage);
    expect(res.state).toBeNull();
    expect(res.corrupted).toBe(true);
    expect(deserialize('{"schema":2,"state":{}}')).toBeNull();
    expect(deserialize('bukan json')).toBeNull();
  });

  it('level selesai pulih dalam keadaan selesai', () => {
    const { state } = fresh();
    state.expandStage = 3;
    state.blocks = state.blocks.map((b) => (b > 0 ? 0 : b));
    state.plots = state.plots.map((_, i) => plotTarget(state, i));
    state.completed = true;
    const storage = new MemoryStorage();
    saveGame(storage, state);
    expect(loadGame(storage).state!.completed).toBe(true);
  });

  it('merapikan nilai di luar batas', () => {
    const { state } = fresh();
    state.train.cargo = { wood: 999, stone: 0, gem: 0 };
    state.train.cutters = [99, 1];
    const lastPlot = state.plots.length - 1;
    state.plots[lastPlot] = 50; // distrik belum terbuka → progres tidak sah
    state.plots[0] = 1e6;
    state.stock = -4;
    const f = fieldFor(0);
    const forest = f.bandCells[0][0];
    state.blocks[forest] = 999;
    const s2 = deserialize(serialize(state))!;
    expect(s2.train.cargo.wood).toBe(20);
    expect(s2.train.cutters).toEqual([8, 1]);
    expect(s2.plots[lastPlot]).toBe(0);
    expect(s2.plots[0]).toBe(plotTarget(s2, 0));
    expect(s2.stock).toBe(0);
    expect(s2.blocks[forest]).toBeLessThanOrEqual(12);
  });
});
