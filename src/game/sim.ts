import { BALANCE } from '../config/balance';
import { completedModuleCount } from './building';
import {
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
import { enclosedBlocks, isPlotInside, railMapping, updateRail } from './rail';
import { computeCrossings } from './track';
import type { GameState, Runtime, Vec2 } from './types';
import { cellPoints, fieldFor, forCellsInRadius, KINDS, type Field } from './worldgen';

/** HP sisa blok yang sudah tumbang tapi belum muat di gerbong muatan (menunggu ruang). */
const HOLD_HP = 0.01;
/** Di bawah laju ini kereta dianggap diam: gerinda tidak memotong. */
const MOVING = 0.05;

/**
 * Satu langkah simulasi (sub-step kecil, maks BALANCE.maxStepDt).
 * Urutan: kontrol → gerak kereta (+ bongkar di stasiun) → pemotong → rel maju bila ada blok hancur.
 * Tanpa input pemain kereta diam dan tidak ada yang terpotong.
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateDrive(rt, dt);
  rt.cutHeat = Math.max(0, rt.cutHeat - dt * 3);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  if (rt.drive.v < MOVING) {
    rt.fullTime = cargoTotal(state.train.cargo) >= capacity(state) ? rt.fullTime + dt : 0;
    return;
  }
  moveTrain(state, rt, dt, events);
  if (state.completed) return;
  if (cut(state, rt, dt, events)) growRail(state, events);
}

// ---------------------------------------------------------------------------
// Kontrol: tahan = jalan, tap = maju sebentar
// ---------------------------------------------------------------------------

export function driveTap(rt: Runtime): void {
  const cfg = BALANCE.drive;
  rt.drive.tapTimer = Math.min(cfg.tapMax, rt.drive.tapTimer + cfg.tap);
}

export function driveHold(rt: Runtime, holding: boolean): void {
  rt.drive.holding = holding;
  if (holding) driveTap(rt);
}

export function isDriving(rt: Runtime): boolean {
  return rt.drive.holding || rt.drive.tapTimer > 0;
}

function updateDrive(rt: Runtime, dt: number): void {
  const d = rt.drive;
  const cfg = BALANCE.drive;
  d.tapTimer = Math.max(0, d.tapTimer - dt);
  const want = isDriving(rt);
  if (want) d.usedSeconds += dt;
  const target = want ? 1 : 0;
  d.v += (target - d.v) * (1 - Math.exp(-(target > d.v ? cfg.accel : cfg.decel) * dt));
  if (want && d.v > 0.995) d.v = 1;
  if (!want && d.v < 0.02) d.v = 0;
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
  const move = Math.min(trainSpeed(state) * rt.drive.v * dt, track.length * 0.5);
  const station = [{ d: STATION_D, data: null }];
  if (computeCrossings(state.train.distance, move, track.length, station).length) unload(state, events);
  state.train.distance = track.wrap(state.train.distance + move);
}

// ---------------------------------------------------------------------------
// Pemotong
// ---------------------------------------------------------------------------

/** Blok bisa digerus gerinda berpusat di g (rel di p, arah luar o): hidup, di kiri, tersentuh. */
function reachable(state: GameState, f: Field, c: number, p: Vec2, o: Vec2, g: Vec2, R: number): boolean {
  if (state.blocks[c] <= 0) return false;
  if ((f.x[c] - p.x) * o.x + (f.z[c] - p.z) * o.z <= 0) return false;
  const dx = f.x[c] - g.x;
  const dz = f.z[c] - g.z;
  return dx * dx + dz * dz <= R * R;
}

/** Blok terdekat ke gerinda yang belum dipegang pemotong lain; bila semua dipegang, boleh berbagi. */
function pickTarget(state: GameState, f: Field, p: Vec2, o: Vec2, g: Vec2, R: number, claimed: readonly number[]): number {
  let best = -1;
  let bestD = Infinity;
  let shared = -1;
  let sharedD = Infinity;
  forCellsInRadius(f.half, f.cols, g.x, g.z, R, (c) => {
    if (!reachable(state, f, c, p, o, g, R)) return;
    const d = Math.hypot(f.x[c] - g.x, f.z[c] - g.z);
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
 * Tiap pemotong punya gerinda horizontal yang menempel di sisi kirinya (arah hutan) dan menggerus
 * SATU blok yang disentuhnya sampai tumbang. Blok tumbang masuk gerbong muatan utuh — bila tidak
 * muat, blok ditahan di ambang tumbang sampai muatan dibongkar, jadi tidak ada bahan yang hilang.
 * Mengembalikan true bila ada blok yang tumbang (rel perlu dihitung ulang).
 */
function cut(state: GameState, rt: Runtime, dt: number, events: EventSink): boolean {
  const f = fieldFor(state.levelIndex);
  const track = trackOf(state);
  const cap = capacity(state);
  const cargo = state.train.cargo;
  const cutters = state.train.cutters;
  if (rt.targets.length !== cutters.length) rt.targets = cutters.map(() => -1);
  if (cargoTotal(cargo) >= cap) {
    rt.fullTime += dt;
    rt.targets.fill(-1);
    return false;
  }
  const p = { x: 0, z: 0 };
  const o = { x: 0, z: 0 };
  const g = { x: 0, z: 0 };
  let stalled = false;
  let felled = false;
  cutters.forEach((lvl, k) => {
    const d = cutterDistance(state, k);
    track.pointAt(d, p);
    track.outwardAt(d, o);
    g.x = p.x + o.x * BALANCE.cutter.side;
    g.z = p.z + o.z * BALANCE.cutter.side;
    const R = cutterReach(lvl);
    let t = rt.targets[k];
    if (t < 0 || !reachable(state, f, t, p, o, g, R)) {
      rt.targets[k] = -1;
      t = pickTarget(state, f, p, o, g, R, rt.targets);
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
    felled = true;
    events.push({ type: 'cut', cell: t, cutter: k, res: def.res, amount: def.amount });
  });
  rt.fullTime = stalled || cargoTotal(cargo) >= cap ? rt.fullTime + dt : 0;
  return felled;
}

// ---------------------------------------------------------------------------
// Rel maju
// ---------------------------------------------------------------------------

/**
 * Hitung ulang rel setelah blok hancur. Bila bentuknya berubah, posisi kereta dipetakan ke rel
 * baru (bagian rel yang sama tetap di tempat), blok yang kini terkurung di dalam rel dibongkar
 * otomatis ke gudang, kavling yang kini di dalam rel terbuka, dan bahan gudang langsung dipasang.
 */
export function growRail(state: GameState, events: EventSink): boolean {
  const ch = updateRail(state);
  if (!ch) return false;
  state.train.distance = ch.to.track.wrap(railMapping(ch.from, ch.to).map(state.train.distance));
  events.push({ type: 'railGrow' });
  const f = fieldFor(state.levelIndex);
  for (const c of enclosedBlocks(ch.to, state.blocks)) {
    const points = cellPoints(f, c);
    state.blocks[c] = 0;
    state.stock += points;
    state.stats.totalCut++;
    events.push({ type: 'harvest', cell: c, points });
  }
  for (let p = 0; p < state.plots.length; p++) if (!isPlotInside(ch.from, p) && isPlotInside(ch.to, p)) events.push({ type: 'plotOpen', plot: p });
  install(state, events);
  return true;
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

function completeLevel(state: GameState, events: EventSink): void {
  state.completed = true;
  const bonus = Math.round(levelDef(state).completionBonus * cycleScale(state));
  state.money += bonus;
  state.stats.lastCompletionBonus = bonus;
  events.push({ type: 'projectComplete', bonus });
}
