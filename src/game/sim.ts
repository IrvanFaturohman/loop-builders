import { BALANCE } from '../config/balance';
import { completedModuleCount } from './building';
import {
  bandRemaining,
  buildCoins,
  capacity,
  cargoPoints,
  cargoTotal,
  cutterDps,
  cutterReach,
  cycleScale,
  isPlotComplete,
  isPlotUnlocked,
  levelDef,
  plotBonus,
  plotProject,
  plotTarget,
  STATION_D,
  trackOf,
  trainSpeed,
} from './economy';
import type { EventSink } from './events';
import { stageCount } from './layout';
import { computeCrossings } from './track';
import { stageMapping } from './tracks';
import type { GameState, Runtime, Vec2 } from './types';
import { fieldFor, forCellsInRadius, KINDS, type Field } from './worldgen';

/** HP sisa blok yang sudah tumbang tapi belum muat di gerbong muatan (menunggu ruang). */
const HOLD_HP = 0.01;

/**
 * Satu langkah simulasi (sub-step kecil, maks BALANCE.maxStepDt).
 * Urutan: boost → gerak kereta (+ bongkar di stasiun) → pemotong → rel melebar bila pita bersih.
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateBoost(rt, dt);
  rt.cutHeat = Math.max(0, rt.cutHeat - dt * 3);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  if (rt.freeze > 0) {
    rt.freeze = Math.max(0, rt.freeze - dt);
    return;
  }
  moveTrain(state, rt, dt, events);
  if (state.completed) return;
  cut(state, rt, dt, events);
  expandIfCleared(state, rt, events);
}

// ---------------------------------------------------------------------------
// Boost
// ---------------------------------------------------------------------------

export function boostTap(rt: Runtime): void {
  if (rt.boost.exhausted) return;
  rt.boost.tapTimer = Math.max(rt.boost.tapTimer, BALANCE.boost.tapDuration);
}

export function boostHold(rt: Runtime, holding: boolean): void {
  rt.boost.holding = holding;
  if (holding) boostTap(rt);
}

export function isBoosting(rt: Runtime): boolean {
  const b = rt.boost;
  return !b.exhausted && (b.holding || b.tapTimer > 0);
}

function updateBoost(rt: Runtime, dt: number): void {
  const b = rt.boost;
  const cfg = BALANCE.boost;
  const wants = isBoosting(rt);
  b.tapTimer = Math.max(0, b.tapTimer - dt);
  if (wants) {
    b.energy -= dt / cfg.maxHoldSeconds;
    b.usedSeconds += dt;
    b.rechargeDelay = cfg.rechargeDelay;
    if (b.energy <= 0) {
      b.energy = 0;
      b.exhausted = true;
      b.tapTimer = 0;
    }
  } else {
    b.rechargeDelay = Math.max(0, b.rechargeDelay - dt);
    if (b.rechargeDelay === 0) b.energy = Math.min(1, b.energy + dt / cfg.rechargeSeconds);
    if (b.exhausted && b.energy >= cfg.resumeAt) b.exhausted = false;
  }
  const target = wants && !b.exhausted ? cfg.mult : 1;
  const rate = target > b.mult ? cfg.accel : cfg.decel;
  b.mult += (target - b.mult) * (1 - Math.exp(-rate * dt));
  if (Math.abs(target - b.mult) < 0.001) b.mult = target;
}

// ---------------------------------------------------------------------------
// Kereta: lokomotif → gerbong muatan → pemotong
// ---------------------------------------------------------------------------

/** Jarak (di lintasan) gerbong muatan, tepat di belakang lokomotif. */
export function cargoDistance(state: GameState): number {
  return trackOf(state).wrap(state.train.distance - BALANCE.wagonSpacing);
}

/** Jarak (di lintasan) pemotong ke-k, berbaris di belakang gerbong muatan. */
export function cutterDistance(state: GameState, k: number): number {
  return trackOf(state).wrap(state.train.distance - (k + 2) * BALANCE.wagonSpacing);
}

function moveTrain(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const track = trackOf(state);
  const move = Math.min(trainSpeed(state) * rt.boost.mult * dt, track.length * 0.5);
  const station = [{ d: STATION_D, data: null }];
  if (computeCrossings(state.train.distance, move, track.length, station).length) unload(state, events);
  state.train.distance = track.wrap(state.train.distance + move);
}

// ---------------------------------------------------------------------------
// Pemotong
// ---------------------------------------------------------------------------

/** Blok bisa dipotong pemotong di p (arah luar o) dengan lengan R: hidup, di kiri, terjangkau. */
function reachable(state: GameState, f: Field, c: number, p: Vec2, o: Vec2, R: number): boolean {
  if (state.blocks[c] <= 0) return false;
  const dx = f.x[c] - p.x;
  const dz = f.z[c] - p.z;
  return dx * o.x + dz * o.z > 0 && dx * dx + dz * dz <= R * R;
}

/** Target terdekat yang belum dipegang pemotong lain; bila semua sudah dipegang, boleh berbagi. */
function pickTarget(state: GameState, f: Field, p: Vec2, o: Vec2, R: number, claimed: readonly number[]): number {
  let best = -1;
  let bestD = Infinity;
  let shared = -1;
  let sharedD = Infinity;
  forCellsInRadius(f.half, f.cols, p.x, p.z, R, (c) => {
    if (!reachable(state, f, c, p, o, R)) return;
    const d = Math.hypot(f.x[c] - p.x, f.z[c] - p.z);
    if (claimed.includes(c)) {
      if (d < sharedD) {
        sharedD = d;
        shared = c;
      }
    } else if (d < bestD) {
      bestD = d;
      best = c;
    }
  });
  return best >= 0 ? best : shared;
}

/**
 * Tiap pemotong menjulurkan lengan ke kiri (luar loop) dan memotong SATU blok sampai tumbang,
 * lalu pindah target. Blok tumbang masuk gerbong muatan utuh — bila tidak muat, blok ditahan
 * di ambang tumbang sampai muatan dibongkar, jadi tidak ada bahan yang hilang (kota butuh
 * seluruh hasil hutan). Saat muatan penuh semua lengan ditarik.
 */
function cut(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  const f = fieldFor(state.levelIndex);
  const track = trackOf(state);
  const cap = capacity(state);
  const cargo = state.train.cargo;
  const cutters = state.train.cutters;
  if (rt.targets.length !== cutters.length) rt.targets = cutters.map(() => -1);
  if (cargoTotal(cargo) >= cap) {
    rt.fullTime += dt;
    rt.targets.fill(-1);
    return;
  }
  const p = { x: 0, z: 0 };
  const o = { x: 0, z: 0 };
  let stalled = false;
  cutters.forEach((lvl, k) => {
    const d = cutterDistance(state, k);
    track.pointAt(d, p);
    track.outwardAt(d, o);
    const R = cutterReach(lvl);
    let t = rt.targets[k];
    if (t < 0 || !reachable(state, f, t, p, o, R)) {
      rt.targets[k] = -1;
      t = pickTarget(state, f, p, o, R, rt.targets);
      rt.targets[k] = t;
    }
    if (t < 0) return;
    rt.cutHeat = 1;
    state.blocks[t] -= cutterDps(lvl) * dt;
    if (state.blocks[t] > 0) return;
    const def = BALANCE.blocks[KINDS[f.kind[t]]];
    if (cap - cargoTotal(cargo) < def.amount) {
      state.blocks[t] = HOLD_HP;
      stalled = true;
      return;
    }
    cargo[def.res] += def.amount;
    state.blocks[t] = 0;
    state.stats.totalCut++;
    rt.targets[k] = -1;
    events.push({ type: 'cut', cell: t, cutter: k, res: def.res, amount: def.amount });
  });
  rt.fullTime = stalled || cargoTotal(cargo) >= cap ? rt.fullTime + dt : 0;
}

// ---------------------------------------------------------------------------
// Stasiun & kota
// ---------------------------------------------------------------------------

/** Stasiun: seluruh muatan dibongkar ke gudang (tidak ada yang dijual), lalu dipasang ke kota. */
export function unload(state: GameState, events: EventSink): void {
  const points = cargoPoints(state.train.cargo);
  if (points <= 0) return;
  const cargo = { ...state.train.cargo };
  state.train.cargo = { wood: 0, stone: 0, gem: 0 };
  state.stock += points;
  events.push({ type: 'unload', cargo, points });
  install(state, events);
}

/**
 * Pasang bahan gudang ke bangunan terbuka yang belum jadi (isi-dulu, urut kavling).
 * Setiap poin yang terpasang langsung jadi koin; bangunan yang selesai memberi bonus.
 */
export function install(state: GameState, events: EventSink): void {
  for (let p = 0; p < state.plots.length && state.stock > 0; p++) {
    if (!isPlotUnlocked(state, p) || isPlotComplete(state, p)) continue;
    const project = plotProject(state, p);
    const built = state.plots[p];
    const drop = Math.min(state.stock, plotTarget(state, p) - built);
    state.plots[p] = built + drop;
    state.stock -= drop;
    const money = buildCoins(state, drop);
    state.money += money;
    state.stats.totalBuilt += drop;
    events.push({ type: 'deliver', plot: p, amount: drop, money, fromModule: completedModuleCount(project, built), toModule: completedModuleCount(project, built + drop) });
    if (isPlotComplete(state, p)) {
      const bonus = plotBonus(state, p);
      state.money += bonus;
      events.push({ type: 'plotComplete', plot: p, bonus });
    }
  }
  if (state.plots.every((_, i) => isPlotComplete(state, i)) && state.blocks.every((b) => b <= 0)) completeLevel(state, events);
}

// ---------------------------------------------------------------------------
// Rel melebar
// ---------------------------------------------------------------------------

/**
 * Pita hutan tahap ini bersih → rel pindah ke cincin berikutnya (sudah di lahan bersih).
 * Posisi kereta dipetakan proporsional dengan stasiun sebagai titik bersama; muatan &
 * pemotong tidak berubah. Distrik baru terbuka dan bahan di gudang langsung dipasang.
 */
export function expandIfCleared(state: GameState, rt: Runtime | null, events: EventSink): boolean {
  const from = state.expandStage;
  const to = from + 1;
  if (to >= stageCount(levelDef(state)) || bandRemaining(state, from) > 0) return false;
  state.train.distance = stageMapping(state.levelIndex, from, to).map(state.train.distance);
  state.expandStage = to;
  const f = fieldFor(state.levelIndex);
  const cleared: number[] = [];
  for (let c = 0; c < f.n; c++) {
    if (f.railStage[c] === to && state.blocks[c] !== -1) {
      state.blocks[c] = -1;
      cleared.push(c);
    }
  }
  if (rt) {
    rt.freeze = BALANCE.expandFreeze;
    rt.targets = [];
  }
  events.push({ type: 'expand', from, to, cleared });
  install(state, events);
  return true;
}

function completeLevel(state: GameState, events: EventSink): void {
  state.completed = true;
  const bonus = Math.round(levelDef(state).completionBonus * cycleScale(state));
  state.money += bonus;
  state.stats.lastCompletionBonus = bonus;
  events.push({ type: 'projectComplete', bonus });
}
