import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/config/levels';
import {
  addCutter,
  canAddCutter,
  canMerge,
  canUpgradeCapacity,
  canUpgradeSpeed,
  mergeCutters,
  nextProject,
  upgradeCapacity,
  upgradeSpeed,
} from '../src/game/actions';
import { BALANCE } from '../src/config/balance';
import { addCost, buildingsDone, capacityCost, cutterDps, findMergePair, forestCleared, mergeCost, speedCost } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameState } from '../src/game/types';

/**
 * Bot pemain yang terus menahan layar: tiap detik membeli opsi yang terjangkau dengan tambahan
 * daya potong per koin terbesar (Tambah = +1 pemotong Lv1, Gabung = selisih dps pasangan →
 * satu tingkat di atasnya). Kecepatan dihargai kecil; Kapasitas dihargai tinggi bila gerbong
 * sering penuh. Rel maju sendiri mengikuti hutan, jadi bot tidak perlu menabung untuk apa pun.
 */
function decide(state: GameState, fullRatio: number): string | null {
  type Opt = { value: number; cost: number; run: () => void; label: string };
  const total = state.train.cutters.reduce((s, l) => s + cutterDps(l), 0);
  const opts: Opt[] = [];
  if (canAddCutter(state).ok) opts.push({ value: cutterDps(1), cost: addCost(state), run: () => addCutter(state, []), label: 'add' });
  const pair = findMergePair(state);
  if (pair && canMerge(state).ok) {
    const lv = state.train.cutters[pair[0]];
    const full = state.train.cutters.length >= BALANCE.maxCutters;
    const gain = cutterDps(lv + 1) - 2 * cutterDps(lv) + (full ? cutterDps(1) : 0);
    if (gain > 0) opts.push({ value: gain, cost: mergeCost(state), run: () => mergeCutters(state, []), label: 'merge' });
  }
  const sc = speedCost(state);
  if (sc !== null && canUpgradeSpeed(state).ok) opts.push({ value: total * 0.03, cost: sc, run: () => upgradeSpeed(state, []), label: 'speed' });
  const cc = capacityCost(state);
  if (cc !== null && canUpgradeCapacity(state).ok) opts.push({ value: total * (fullRatio > 0.3 ? 0.4 : 0.02), cost: cc, run: () => upgradeCapacity(state, []), label: 'capacity' });
  if (!opts.length) return null;
  opts.sort((a, b) => b.value / b.cost - a.value / a.cost);
  opts[0].run();
  return opts[0].label;
}

function playLevel(state: GameState, maxSeconds: number, buy = true) {
  const rt = createRuntime();
  rt.drive.holding = true;
  const ev: GameEvent[] = [];
  const firsts: Record<string, number> = {};
  const log: string[] = [];
  const buys: Record<string, number> = {};
  let t = 0;
  let acc = 0;
  let full = 0;
  let sampled = 0;
  let built = 0;
  let bonus = 0;
  let grows = 0;
  let nextMark = 0.25;
  while (!state.completed && t < maxSeconds) {
    ev.length = 0;
    step(state, rt, 1 / 30, ev);
    t += 1 / 30;
    acc += 1 / 30;
    sampled++;
    if (rt.fullTime > 0) full++;
    for (const e of ev) {
      if (e.type === 'cut') firsts.cut ??= t;
      if (e.type === 'unload') firsts.unload ??= t;
      if (e.type === 'deliver') built += e.money;
      if (e.type === 'plotComplete') {
        firsts.house ??= t;
        bonus += e.bonus;
      }
      if (e.type === 'railGrow') grows++;
      if (e.type === 'plotOpen') firsts.plotOpen ??= t;
    }
    if (acc >= 1) {
      acc = 0;
      const cleared = forestCleared(state);
      if (cleared >= nextMark) {
        log.push(`${t.toFixed(0).padStart(4)}s hutan ${(cleared * 100).toFixed(0)}% · bangunan ${buildingsDone(state).done} · rel maju ${grows}x`);
        nextMark += 0.25;
      }
      const label = buy ? decide(state, full / Math.max(1, sampled)) : null;
      full = 0;
      sampled = 0;
      if (label) {
        buys[label] = (buys[label] ?? 0) + 1;
        firsts[label] ??= t;
      }
    }
  }
  return { t, firsts, log, buys, built, bonus };
}

describe('pacing (bot)', () => {
  it('kedua level selesai dengan tempo wajar tanpa softlock', () => {
    const state = createNewGame();
    const results = [];
    for (let li = 0; li < LEVELS.length; li++) {
      const r = playLevel(state, 3600);
      results.push(r);
      const b = buildingsDone(state);
      console.log(`\n=== Level ${li + 1} ${LEVELS[li].id}: ${state.completed ? 'selesai' : 'BELUM'} ${(r.t / 60).toFixed(2)} menit — bangunan ${b.done}/${b.total}, hutan ${(forestCleared(state) * 100).toFixed(0)}%`);
      console.log(`first: ${JSON.stringify(Object.fromEntries(Object.entries(r.firsts).map(([k, v]) => [k, Math.round(v)])))}`);
      console.log(`beli: ${JSON.stringify(r.buys)} | koin bangun ${r.built} bonus ${r.bonus} | pemotong ${state.train.cutters.join(',')} spd${state.speedLevel} cap${state.capacityLevel} | uang ${Math.floor(state.money)}`);
      console.log(r.log.join('\n'));
      expect(state.completed).toBe(true);
      expect(forestCleared(state)).toBe(1);
      nextProject(state, []);
    }
    const [l1, l2] = results;
    // Pohon hijau butuh 2 lewat pemotong Lv1, jadi tebangan pertama terjadi di putaran kedua.
    expect(l1.firsts.cut).toBeLessThan(25);
    expect(l1.firsts.unload).toBeLessThan(40);
    expect(l1.firsts.house).toBeLessThan(60);
    expect(l1.t).toBeGreaterThan(240);
    expect(l1.t).toBeLessThan(720);
    expect(l2.t).toBeLessThan(780);
  });

  it('tanpa upgrade, pemotong Lv1 tidak sanggup membersihkan pulau dalam 15 menit', () => {
    const state = createNewGame();
    const r = playLevel(state, 900, false);
    console.log(`\n=== Tanpa upgrade: ${(r.t / 60).toFixed(1)} menit — hutan ${(forestCleared(state) * 100).toFixed(0)}%, bangunan ${buildingsDone(state).done}/${buildingsDone(state).total}`);
    console.log(r.log.join('\n'));
    expect(state.completed).toBe(false);
    expect(forestCleared(state)).toBeLessThan(0.75);
  });
});
