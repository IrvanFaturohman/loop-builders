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
  truckCapacity,
  truckCount,
} from './economy';
import type { EventSink } from './events';
import { deliveryRoute } from './layout';
import { enclosedBlocks, isPlotInside, updateRail, type RailSpan } from './rail';
import { computeCrossings } from './track';
import type { GameState, RailItem, Runtime, Vec2 } from './types';
import { fieldFor, forCellsInRadius, KINDS, releasedUnits, remainingPoints, type Field } from './worldgen';

/** Di bawah laju ini kereta dianggap diam: gerinda tidak memotong. */
const MOVING = 0.05;
/** Kelonggaran rel yang dijaga di depan lokomotif & di belakang pemotong terakhir (setengah badan gerbong). */
const TRAIN_MARGIN = 0.6;
/** Tiap jarak tempuh sejauh ini, lahan yang tertunda di belakang kereta diperiksa lagi. */
const RAIL_CHECK = 0.25;

/**
 * Satu langkah simulasi (sub-step kecil, maks BALANCE.maxStepDt).
 * Urutan: kontrol → gerak kereta (+ bongkar di stasiun) → pemotong → rel maju di belakang kereta.
 * Tanpa input pemain kereta diam dan tidak ada yang terpotong.
 */
export function step(state: GameState, rt: Runtime, dt: number, events: EventSink): void {
  if (dt <= 0) return;
  updateDrive(rt, dt);
  rt.cutHeat = Math.max(0, rt.cutHeat - dt * 3);
  if (state.completed) return;
  state.stats.levelTime += dt;
  state.stats.totalTime += dt;
  // Truk kota tetap bolak-balik walau kereta berhenti.
  updateTrucks(state, dt, events);
  if (state.completed) return;
  if (rt.drive.v < MOVING) {
    rt.fullTime = cargoTotal(state.train.cargo) >= capacity(state) ? rt.fullTime + dt : 0;
    return;
  }
  rt.railCheck += moveTrain(state, rt, dt, events);
  if (state.completed) return;
  // Lahan yang tertunda di dekat kereta diterapkan begitu kereta sudah lewat; diperiksa saat
  // ada blok tumbang atau tiap RAIL_CHECK jarak tempuh (bukan tiap sub-step, supaya ringan di HP).
  if (cut(state, rt, dt, events) || rt.railCheck >= RAIL_CHECK) {
    rt.railCheck = 0;
    growRail(state, events);
  }
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

/** Majukan kereta; mengembalikan jarak tempuhnya. */
function moveTrain(state: GameState, rt: Runtime, dt: number, events: EventSink): number {
  const track = trackOf(state);
  const move = Math.min(trainSpeed(state) * rt.drive.v * dt, track.length * 0.5);
  const station = [{ d: STATION_D, data: null }];
  const cargoFrom = cargoDistance(state);
  if (computeCrossings(state.train.distance, move, track.length, station).length) unload(state, events);
  state.train.distance = track.wrap(state.train.distance + move);
  pickUp(state, cargoFrom, move, events);
  return move;
}

/** Gerbong muatan memungut tumpukan bahan di rel yang dilewatinya, selama masih muat. */
function pickUp(state: GameState, from: number, move: number, events: EventSink): void {
  if (!state.railItems.length) return;
  const cap = capacity(state);
  const cargo = state.train.cargo;
  const crossed = computeCrossings(
    from,
    move,
    trackOf(state).length,
    state.railItems.map((item) => ({ d: item.d, data: item })),
  );
  const taken = new Set<RailItem>();
  for (const { data: item } of crossed) {
    if (cargoTotal(cargo) + item.amount > cap) continue;
    cargo[item.res] += item.amount;
    taken.add(item);
    events.push({ type: 'pickup', item });
  }
  if (taken.size) state.railItems = state.railItems.filter((it) => !taken.has(it));
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
 * SATU blok yang disentuhnya sampai tumbang, walaupun gerbong muatan sudah penuh. Bahan keluar
 * sedikit demi sedikit seiring kerusakan (releasedUnits) dan masuk gerbong muatan — bila tidak
 * muat, bahannya jatuh ke rel di bawah pemotong (state.railItems) dan dipungut gerbong muatan saat
 * melintas lagi, jadi tidak ada bahan yang hilang.
 * Mengembalikan true bila ada blok yang tumbang (rel perlu dihitung ulang).
 */
function cut(state: GameState, rt: Runtime, dt: number, events: EventSink): boolean {
  const f = fieldFor(state.levelIndex);
  const track = trackOf(state);
  const cap = capacity(state);
  const cargo = state.train.cargo;
  const cutters = state.train.cutters;
  if (rt.targets.length !== cutters.length) rt.targets = cutters.map(() => -1);
  const p = { x: 0, z: 0 };
  const o = { x: 0, z: 0 };
  const g = { x: 0, z: 0 };
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
    const def = BALANCE.blocks[KINDS[f.kind[t]]];
    const before = state.blocks[t];
    state.blocks[t] -= cutterDps(lvl) * dt;
    const down = state.blocks[t] <= 0;
    if (down) {
      state.blocks[t] = 0;
      state.stats.totalCut++;
      rt.targets[k] = -1;
      felled = true;
    }
    // Bahan keluar sedikit demi sedikit selama digerus, bukan hanya saat blok habis.
    const units = releasedUnits(f, t, state.blocks[t]) - releasedUnits(f, t, before);
    if (units <= 0) return;
    const toCargo = Math.max(0, Math.min(units, cap - cargoTotal(cargo)));
    if (toCargo > 0) {
      cargo[def.res] += toCargo;
      events.push({ type: 'cut', cell: t, cutter: k, res: def.res, amount: toCargo, felled: down });
    }
    if (units > toCargo) {
      // Gerbong penuh: sisanya jatuh ke rel di bawah pemotong, dipungut di putaran berikutnya.
      const item: RailItem = { d, res: def.res, amount: units - toCargo };
      state.railItems.push(item);
      events.push({ type: 'drop', cell: t, cutter: k, item, felled: down });
    }
  });
  rt.fullTime = cargoTotal(cargo) >= cap ? rt.fullTime + dt : 0;
  return felled;
}

// ---------------------------------------------------------------------------
// Rel maju
// ---------------------------------------------------------------------------

/** Bagian rel yang ditempati kereta: pemotong terakhir sampai hidung lokomotif. */
export function trainSpan(state: GameState): RailSpan {
  const back = (state.train.cutters.length + 1) * BALANCE.wagonSpacing + TRAIN_MARGIN;
  return { from: trackOf(state).wrap(state.train.distance - back), length: back + TRAIN_MARGIN };
}

/**
 * Hitung ulang rel setelah blok hancur / kereta bergerak. Rel hanya berubah di bagian yang tidak
 * ditempati kereta (lahan di dekat kereta menunggu kereta lewat), jadi kereta tidak pernah
 * tergeser. Bila bentuknya berubah, jarak kereta dipetakan ke rel baru, blok yang kini terkurung
 * di dalam rel dibongkar otomatis ke gudang, kavling yang kini di dalam rel terbuka, dan bahan
 * gudang langsung dipasang. `avoidTrain = false` menerapkan semua lahan sekaligus.
 */
export function growRail(state: GameState, events: EventSink, avoidTrain = true): boolean {
  const ch = updateRail(state, avoidTrain ? trainSpan(state) : undefined);
  if (!ch) return false;
  state.train.distance = ch.to.track.wrap(ch.map.map(state.train.distance));
  for (const item of state.railItems) item.d = ch.to.track.wrap(ch.map.map(item.d));
  events.push({ type: 'railGrow' });
  const f = fieldFor(state.levelIndex);
  for (const c of enclosedBlocks(ch.to, state.blocks)) {
    const points = remainingPoints(f, c, state.blocks[c]);
    state.blocks[c] = 0;
    state.stock += points;
    state.stats.totalCut++;
    events.push({ type: 'harvest', cell: c, points });
  }
  for (let p = 0; p < state.plots.length; p++) if (!isPlotInside(ch.from, p) && isPlotInside(ch.to, p)) events.push({ type: 'plotOpen', plot: p });
  dispatchTrucks(state);
  return true;
}

// ---------------------------------------------------------------------------
// Stasiun & kota
// ---------------------------------------------------------------------------

/** Stasiun: seluruh muatan dibongkar ke penyimpanan stasiun (tidak ada yang dijual), lalu truk mengangkutnya. */
export function unload(state: GameState, events: EventSink): void {
  const points = cargoPoints(state.train.cargo);
  if (points <= 0) return;
  const cargo = { ...state.train.cargo };
  state.train.cargo = { wood: 0, stone: 0, gem: 0 };
  state.stock += points;
  events.push({ type: 'unload', cargo, points });
  dispatchTrucks(state);
}

// ---------------------------------------------------------------------------
// Truk pengantar: penyimpanan stasiun → bangunan → kembali
// ---------------------------------------------------------------------------

/** Jarak penyimpanan (titik berangkat truk) dari rel stasiun ke arah kota. */
export const STORAGE_BACK = 1.4;

/** Poin bahan yang sedang dibawa truk ke kavling `plot`. */
function inTransit(state: GameState, plot: number): number {
  let sum = 0;
  for (const t of state.trucks) if (t.plot === plot) sum += t.load;
  return sum;
}

/**
 * Berangkatkan truk yang menganggur selama penyimpanan berisi dan masih ada bangunan terbuka yang
 * butuh bahan (urut kavling: rumah dulu, gedung besar menjadi penutup distrik).
 */
export function dispatchTrucks(state: GameState): void {
  const cap = truckCapacity(state);
  const count = truckCount(state);
  const start = { x: 0, z: trackOf(state).pointAt(STATION_D).z - STORAGE_BACK };
  let p = 0;
  while (state.trucks.length < count && state.stock > 0) {
    let need = 0;
    for (; p < state.plots.length; p++) {
      if (!isPlotUnlocked(state, p) || isPlotComplete(state, p)) continue;
      need = plotTarget(state, p) - state.plots[p] - inTransit(state, p);
      if (need > 0) break;
    }
    if (p >= state.plots.length) return;
    const load = Math.min(cap, state.stock, need);
    state.stock -= load;
    const route = deliveryRoute(state.levelIndex, p, start);
    let length = 0;
    for (let i = 1; i < route.length; i++) length += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
    state.trucks.push({ plot: p, load, startZ: start.z, length: Math.max(0.5, length), s: 0 });
  }
}

/** Majukan truk; yang tiba di kavling membongkar muatannya, yang kembali ke stasiun siap berangkat lagi. */
function updateTrucks(state: GameState, dt: number, events: EventSink): void {
  if (!state.trucks.length) return;
  let freed = false;
  for (const t of state.trucks) {
    t.s += BALANCE.truck.speed * dt;
    if (t.load > 0 && t.s >= t.length) {
      const load = t.load;
      t.load = 0;
      deliver(state, t.plot, load, events);
      if (state.completed) return;
    }
  }
  const before = state.trucks.length;
  state.trucks = state.trucks.filter((t) => t.s < t.length * 2);
  freed = state.trucks.length < before;
  if (freed) dispatchTrucks(state);
}

/**
 * Truk tiba: bahan terpasang ke kavling. Setiap poin yang terpasang langsung jadi koin; bangunan
 * yang selesai memberi bonus; level selesai saat semua bangunan jadi dan hutan bersih.
 */
function deliver(state: GameState, p: number, load: number, events: EventSink): void {
  const project = plotProject(state, p);
  const built = state.plots[p];
  const drop = Math.min(load, plotTarget(state, p) - built);
  state.stock += load - drop;
  if (drop > 0) {
    state.plots[p] = built + drop;
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
