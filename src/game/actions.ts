import { BALANCE } from '../config/balance';
import { LEVELS } from '../config/levels';
import { addCost, capacityCost, findMergePair, mergeCost, speedCost } from './economy';
import type { EventSink } from './events';
import { setupLevel } from './state';
import type { GameState } from './types';

export type ActionResult = { ok: true } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Pemotong
// ---------------------------------------------------------------------------

export function canAddCutter(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  if (state.train.cutters.length >= BALANCE.maxCutters) return fail('Pemotong penuh — gabungkan dulu');
  if (state.money < addCost(state)) return fail('Uang belum cukup');
  return OK;
}

/** Tambah gerbong pemotong Lv1 di ujung belakang kereta. */
export function addCutter(state: GameState, events: EventSink): ActionResult {
  const can = canAddCutter(state);
  if (!can.ok) return can;
  state.money -= addCost(state);
  state.addsPurchased++;
  state.train.cutters.push(1);
  state.tutorial.add = true;
  events.push({ type: 'add', index: state.train.cutters.length - 1 });
  return OK;
}

export function canMerge(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  if (!findMergePair(state)) return fail('Butuh 2 pemotong setingkat');
  if (state.money < mergeCost(state)) return fail('Uang belum cukup');
  return OK;
}

/**
 * Gabung dua pemotong setingkat terendah menjadi satu pemotong tingkat berikutnya
 * (lengan lebih panjang, gerinda lebih cepat). Tingkat tertinggi di depan.
 */
export function mergeCutters(state: GameState, events: EventSink): ActionResult {
  const can = canMerge(state);
  if (!can.ok) return can;
  const [a, b] = findMergePair(state)!;
  const level = state.train.cutters[a] + 1;
  state.money -= mergeCost(state);
  state.mergesPurchased++;
  const rest = state.train.cutters.filter((_, i) => i !== a && i !== b);
  rest.push(level);
  state.train.cutters = rest.sort((x, y) => y - x);
  state.tutorial.merge = true;
  events.push({ type: 'merge', a, b, level });
  return OK;
}

// ---------------------------------------------------------------------------
// Kecepatan & kapasitas
// ---------------------------------------------------------------------------

export function canUpgradeSpeed(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  const c = speedCost(state);
  if (c === null) return fail('Kecepatan maksimum');
  if (state.money < c) return fail('Uang belum cukup');
  return OK;
}

export function upgradeSpeed(state: GameState, events: EventSink): ActionResult {
  const can = canUpgradeSpeed(state);
  if (!can.ok) return can;
  state.money -= speedCost(state)!;
  state.speedLevel++;
  state.tutorial.speed = true;
  events.push({ type: 'speed', level: state.speedLevel });
  return OK;
}

export function canUpgradeCapacity(state: GameState): ActionResult {
  if (state.completed) return fail('Level sudah selesai');
  const c = capacityCost(state);
  if (c === null) return fail('Kapasitas maksimum');
  if (state.money < c) return fail('Uang belum cukup');
  return OK;
}

export function upgradeCapacity(state: GameState, events: EventSink): ActionResult {
  const can = canUpgradeCapacity(state);
  if (!can.ok) return can;
  state.money -= capacityCost(state)!;
  state.capacityLevel++;
  state.tutorial.capacity = true;
  events.push({ type: 'capacity', level: state.capacityLevel });
  return OK;
}

// ---------------------------------------------------------------------------
// Level berikutnya
// ---------------------------------------------------------------------------

export function nextProject(state: GameState, events: EventSink): ActionResult {
  if (!state.completed) return fail('Selesaikan kota dulu');
  let idx = state.levelIndex + 1;
  let cycle = state.cycle;
  if (idx >= LEVELS.length) {
    idx = 0;
    cycle++;
  }
  setupLevel(state, idx, cycle);
  events.push({ type: 'nextProject', levelIndex: idx });
  return OK;
}

export function isLastLevel(state: GameState): boolean {
  return state.levelIndex === LEVELS.length - 1;
}
