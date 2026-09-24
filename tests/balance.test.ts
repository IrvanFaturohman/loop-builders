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
import { addCost, buildingsDone, capacityCost, forestCleared, mergeCost, speedCost } from '../src/game/economy';
import type { GameEvent } from '../src/game/events';
import { step } from '../src/game/sim';
import { createNewGame, createRuntime } from '../src/game/state';
import type { GameState } from '../src/game/types';

/**
 * Bot pemain yang terus menahan layar: beli opsi termurah yang masuk akal saat itu.
 * Kapasitas diprioritaskan bila pemotong sering berhenti karena muatan penuh.
 * Rel maju sendiri mengikuti hutan, jadi bot tidak perlu menabung untuk apa pun.
 */
function decide(state: GameState, fullRatio: number): string | null {
  type Opt = { cost: number; run: () => void; label: string };
  const opts: Opt[] = [];
  if (canMerge(state).ok) opts.push({ cost: mergeCost(state) * 0.8, run: () => mergeCutters(state, []), label: 'merge' });
  if (canAddCutter(state).ok) opts.push({ cost: addCost(state), run: () => addCutter(state, []), label: 'add' });
  const sc = speedCost(state);
  if (sc !== null && canUpgradeSpeed(state).ok) opts.push({ cost: sc * 1.1, run: () => upgradeSpeed(state, []), label: 'speed' });
  const cc = capacityCost(state);
  if (cc !== null && canUpgradeCapacity(state).ok) opts.push({ cost: cc * (fullRatio > 0.3 ? 0.6 : 1.3), run: () => upgradeCapacity(state, []), label: 'capacity' });
  if (!opts.length) return null;
  opts.sort((a, b) => a.cost - b.cost);
  opts[0].run();
  return opts[0].label;
}

function playLevel(state: GameState, maxSeconds: number) {
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
      const label = decide(state, full / Math.max(1, sampled));
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
    expect(l1.firsts.cut).toBeLessThan(3);
    expect(l1.firsts.unload).toBeLessThan(20);
    expect(l1.firsts.house).toBeLessThan(60);
    expect(l1.t).toBeGreaterThan(240);
    expect(l1.t).toBeLessThan(600);
    expect(l2.t).toBeLessThan(720);
  });
});
