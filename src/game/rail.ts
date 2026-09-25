import { LEVELS } from '../config/levels';
import { districtCount, plotsOfLevel } from './layout';
import { buildStageMapping, StageMapping, TrackPath } from './track';
import type { GameState, Vec2 } from './types';
import { CELL, fieldFor, type Field } from './worldgen';

/**
 * Rel dinamis berbasis grid. Rel selalu lurus dengan belokan siku (L) dan lewat tepat di pusat
 * sel, satu sel di depan baris hutan terdepan:
 *
 *  1. E = sel bebas (tanpa blok hidup) yang tersambung 4-arah ke pusat, di dalam pulau.
 *  2. Buka E dengan kotak 3×3 (gabungan semua kotak 3×3 yang muat di E): tonjolan selebar
 *     1–2 sel diabaikan, jadi rel baru maju setelah minimal 3 blok berjejer hancur, dan tidak
 *     pernah berkelok untuk lubang kecil.
 *  3. Ambil komponen yang memuat pusat, isi lubangnya → F (lahan di dalam rel, termasuk rel).
 *  4. Rel = keliling F yang digeser setengah sel ke dalam, yaitu garis lewat pusat sel-sel tepi F.
 *     Dihitung sebagai tepi gabungan persegi kisi (antar pusat sel) yang keempat sudutnya di F;
 *     jepitan diagonal dibuang supaya keliling selalu satu loop sederhana.
 *
 * Blok hidup yang terkurung di dalam F (lubang) tidak bisa lagi disentuh rel; sim.ts
 * membongkarnya otomatis ke gudang. Karena blok hanya bisa hancur, F hanya bisa membesar:
 * rel hanya pernah maju keluar.
 *
 * Selama main, rel di bawah kereta tidak boleh berubah (kereta tidak boleh tergeser): lahan baru
 * di dekat kereta ditunda dan baru masuk F setelah kereta lewat (updateRail dengan RailSpan).
 * Rel tidak disimpan — saat dimuat ulang dihitung dari blok dengan semua tundaan diterapkan.
 */

/**
 * Radius lengkung belokan siku: setengah sel, jadi garis tengah ubin belok adalah seperempat
 * lingkaran penuh dari tepi ke tepi sel, dan tangga rel selebar satu sel menjadi lengkung S.
 */
export const TURN_R = 0.5;
/**
 * Jarak Chebyshev (sel) dari kereta tempat lahan baru ditunda. Dicoba berurutan: yang kecil
 * membuat rel berubah tepat di belakang kereta; yang besar cadangan bila perubahan (jepitan,
 * lubang terisi) ternyata masih menyentuh rel di bawah kereta.
 */
const KEEP_OUT = [1.6, 2.6, 3.6];

/** Satu ubin rel: pusat sel yang dilewati rel, arah masuk, dan beloknya di sel itu. */
export interface RailTile {
  cell: number;
  x: number;
  z: number;
  /** Arah masuk: 0 = +x, 1 = +z, 2 = -x, 3 = -z. */
  dir: number;
  /** 0 = lurus, 1 = belok kanan (ke arah kota), -1 = belok kiri (ke hutan). */
  turn: number;
}

export interface Rail {
  levelIndex: number;
  /** 1 = sel di dalam rel (termasuk sel yang dilewati rel). */
  inside: Uint8Array;
  /** Jarak Chebyshev (dalam sel) ke sel di luar rel: 1 = sel yang dilewati rel. 0 = di luar. */
  depth: Uint8Array;
  track: TrackPath;
  /** Ubin rel searah jalan, mulai tepat setelah stasiun. */
  tiles: RailTile[];
}

/** Bagian lintasan rel sekarang yang ditempati kereta: dari jarak `from` sepanjang `length` searah jalan. */
export interface RailSpan {
  from: number;
  length: number;
}

export interface RailChange {
  from: Rail;
  to: Rail;
  /** Jarak di rel lama → jarak di rel baru (bagian di bawah kereta dipetakan 1:1). */
  map: StageMapping;
}

interface Base {
  /** Sel di dalam pulau (boleh menjadi bagian lahan kota). */
  island: Uint8Array;
  center: number;
  /** Sel yang ditempati titik-titik periksa tiap kavling. */
  plotCells: number[][];
}

const baseCache = new Map<number, Base>();

function baseFor(levelIndex: number): Base {
  let b = baseCache.get(levelIndex);
  if (b) return b;
  const level = LEVELS[levelIndex];
  const f = fieldFor(levelIndex);
  const island = new Uint8Array(f.n);
  for (let c = 0; c < f.n; c++) island[c] = f.band[c] < districtCount(level) ? 1 : 0;
  const cellAt = (x: number, z: number) => Math.floor((z + f.half) / CELL) * f.cols + Math.floor((x + f.half) / CELL);
  const plotCells = plotsOfLevel(levelIndex).map((pl) => {
    const t = { x: -pl.facing.z, z: pl.facing.x };
    const cells = new Set<number>();
    // Titik periksa rapat (≤ 0,5 satuan) supaya kavling besar pun tidak melewatkan sel.
    const na = Math.ceil(pl.w / 0.5);
    for (let i = 0; i <= na; i++)
      for (const k of [-1, 0, 1]) {
        const a = (i / na) * 2 - 1;
        const x = pl.pos.x + ((t.x * a * pl.w) / 2) * 0.98 + ((pl.facing.x * k * pl.d) / 2) * 0.98;
        const z = pl.pos.z + ((t.z * a * pl.w) / 2) * 0.98 + ((pl.facing.z * k * pl.d) / 2) * 0.98;
        cells.add(cellAt(x, z));
      }
    return [...cells];
  });
  b = { island, center: cellAt(0.01, 0.01), plotCells };
  baseCache.set(levelIndex, b);
  return b;
}

/** BFS 4-arah dari `start` di atas sel yang `ok`. */
function flood(f: Field, start: number, ok: (c: number) => boolean): Uint8Array {
  const out = new Uint8Array(f.n);
  if (!ok(start)) return out;
  const q = [start];
  out[start] = 1;
  while (q.length) {
    const c = q.pop()!;
    const i = c % f.cols;
    const j = (c - i) / f.cols;
    const push = (n: number) => {
      if (!out[n] && ok(n)) {
        out[n] = 1;
        q.push(n);
      }
    };
    if (i > 0) push(c - 1);
    if (i < f.cols - 1) push(c + 1);
    if (j > 0) push(c - f.cols);
    if (j < f.cols - 1) push(c + f.cols);
  }
  return out;
}

/** Opening 3×3 (erosi lalu dilatasi): hanya sisa daerah yang dilalui kotak 3×3 utuh. */
function open3(f: Field, E: Uint8Array): Uint8Array {
  const cols = f.cols;
  const core = new Uint8Array(f.n);
  for (let j = 1; j < cols - 1; j++)
    for (let i = 1; i < cols - 1; i++) {
      let all = 1;
      for (let dj = -1; dj <= 1 && all; dj++) for (let di = -1; di <= 1 && all; di++) if (!E[(j + dj) * cols + i + di]) all = 0;
      core[j * cols + i] = all;
    }
  const open = new Uint8Array(f.n);
  for (let j = 1; j < cols - 1; j++)
    for (let i = 1; i < cols - 1; i++) {
      if (!core[j * cols + i]) continue;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) open[(j + dj) * cols + i + di] = 1;
    }
  return open;
}

/** Komponen `cells` yang memuat pusat, lubangnya diisi. */
function closeRegion(levelIndex: number, cells: Uint8Array): Uint8Array {
  const f = fieldFor(levelIndex);
  const cols = f.cols;
  const comp = flood(f, baseFor(levelIndex).center, (c) => cells[c] === 1);
  // Isi lubang: sel luar = tersambung 4-arah ke tepi peta tanpa melewati comp.
  const outside = new Uint8Array(f.n);
  const q: number[] = [];
  for (let k = 0; k < cols; k++)
    for (const c of [k, (cols - 1) * cols + k, k * cols, k * cols + cols - 1]) {
      if (!comp[c] && !outside[c]) {
        outside[c] = 1;
        q.push(c);
      }
    }
  while (q.length) {
    const c = q.pop()!;
    const i = c % cols;
    const j = (c - i) / cols;
    for (const n of [i > 0 ? c - 1 : -1, i < cols - 1 ? c + 1 : -1, j > 0 ? c - cols : -1, j < cols - 1 ? c + cols : -1]) {
      if (n >= 0 && !comp[n] && !outside[n]) {
        outside[n] = 1;
        q.push(n);
      }
    }
  }
  const inside = new Uint8Array(f.n);
  for (let c = 0; c < f.n; c++) inside[c] = outside[c] ? 0 : 1;
  return inside;
}

/** Lahan di dalam rel (F) untuk kondisi blok sekarang, tanpa tundaan. */
function computeInside(levelIndex: number, blocks: readonly number[]): Uint8Array {
  const f = fieldFor(levelIndex);
  const b = baseFor(levelIndex);
  const E = flood(f, b.center, (c) => b.island[c] === 1 && blocks[c] <= 0);
  return closeRegion(levelIndex, open3(f, E));
}

/**
 * F yang boleh dipakai sekarang: F lama ditambah lahan target yang jauhnya ≥ keep sel (Chebyshev)
 * dari semua titik kereta. Tambahan tetap harus selebar kotak 3×3 bersama F lama.
 */
function growAway(levelIndex: number, applied: Uint8Array, target: Uint8Array, avoid: readonly Vec2[], keep: number): Uint8Array {
  const f = fieldFor(levelIndex);
  const allowed = Uint8Array.from(applied);
  for (let c = 0; c < f.n; c++) {
    if (applied[c] || !target[c]) continue;
    let near = false;
    for (const p of avoid)
      if (Math.abs(f.x[c] - p.x) < keep && Math.abs(f.z[c] - p.z) < keep) {
        near = true;
        break;
      }
    if (!near) allowed[c] = 1;
  }
  const open = open3(f, allowed);
  for (let c = 0; c < f.n; c++) open[c] |= applied[c];
  return closeRegion(levelIndex, open);
}

/** Jarak Chebyshev (sel) ke sel luar, dibatasi 4. */
function computeDepth(f: Field, inside: Uint8Array): Uint8Array {
  const cols = f.cols;
  const depth = new Uint8Array(f.n);
  for (let c = 0; c < f.n; c++) depth[c] = inside[c] ? 4 : 0;
  for (let pass = 1; pass <= 3; pass++) {
    for (let j = 0; j < cols; j++)
      for (let i = 0; i < cols; i++) {
        const c = j * cols + i;
        if (depth[c] <= pass) continue;
        let near = false;
        for (let dj = -1; dj <= 1 && !near; dj++)
          for (let di = -1; di <= 1 && !near; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= cols || jj >= cols || depth[jj * cols + ii] === pass - 1) near = true;
          }
        if (near) depth[c] = pass;
      }
  }
  return depth;
}

/**
 * Keliling F lewat pusat sel tepi, searah jarum jam (x kanan, z bawah), mulai di tengah sisi
 * bawah (x = 0, tempat stasiun). Kisi: persegi (i, j) menghubungkan pusat sel (i..i+1, j..j+1).
 */
function traceRail(levelIndex: number, inside: Uint8Array): { track: TrackPath; tiles: RailTile[] } {
  const f = fieldFor(levelIndex);
  const cols = f.cols;
  const L = cols - 1; // jumlah persegi kisi per baris
  const H = new Uint8Array(L * L);
  for (let j = 0; j < L; j++)
    for (let i = 0; i < L; i++) {
      const c = j * cols + i;
      H[j * L + i] = inside[c] && inside[c + 1] && inside[c + cols] && inside[c + cols + 1] ? 1 : 0;
    }
  // Buang jepitan diagonal (dua persegi hanya bersentuhan di satu titik): hapus yang lebih jauh dari pusat.
  const mid = (L - 1) / 2;
  const far = (i: number, j: number) => Math.max(Math.abs(i - mid), Math.abs(j - mid));
  for (let changed = true; changed; ) {
    changed = false;
    for (let j = 0; j < L - 1; j++)
      for (let i = 0; i < L - 1; i++) {
        const a = H[j * L + i];
        const b2 = H[j * L + i + 1];
        const c2 = H[(j + 1) * L + i];
        const d = H[(j + 1) * L + i + 1];
        if (a && d && !b2 && !c2) {
          if (far(i, j) > far(i + 1, j + 1)) H[j * L + i] = 0;
          else H[(j + 1) * L + i + 1] = 0;
          changed = true;
        } else if (b2 && c2 && !a && !d) {
          if (far(i + 1, j) > far(i, j + 1)) H[j * L + i + 1] = 0;
          else H[(j + 1) * L + i] = 0;
          changed = true;
        }
      }
  }
  // Komponen yang memuat pusat.
  const start = Math.floor(mid) * L + Math.floor(mid);
  const keep = new Uint8Array(L * L);
  const q = [start];
  keep[start] = 1;
  while (q.length) {
    const s = q.pop()!;
    const i = s % L;
    const j = (s - i) / L;
    for (const n of [i > 0 ? s - 1 : -1, i < L - 1 ? s + 1 : -1, j > 0 ? s - L : -1, j < L - 1 ? s + L : -1]) {
      if (n >= 0 && H[n] && !keep[n]) {
        keep[n] = 1;
        q.push(n);
      }
    }
  }
  const has = (i: number, j: number) => i >= 0 && j >= 0 && i < L && j < L && keep[j * L + i] === 1;
  // Titik kisi (i, j) = pusat sel (i, j). Susuri tepi dengan daerah di sebelah kanan arah jalan
  // (loop searah jarum jam di layar). Arah: 0 = +x, 1 = +z, 2 = -x, 3 = -z.
  // Mulai dari tepi bawah paling bawah yang melewati x = 0: tepi horizontal di baris kisi j
  // antara titik (i0, j) dan (i0 + 1, j) dengan persegi (i0, j-1) di dalam dan (i0, j) di luar.
  const i0 = Math.floor(mid);
  let j0 = -1;
  for (let j = L; j >= 1; j--)
    if (has(i0, j - 1) && !has(i0, j)) {
      j0 = j;
      break;
    }
  const DX = [1, 0, -1, 0];
  const DZ = [0, 1, 0, -1];
  // Bebas di kiri (luar) dan persegi di kanan (dalam) untuk langkah dari titik (i, j) arah dir:
  const rightSq = (i: number, j: number, dir: number): [number, number] => {
    switch (dir) {
      case 0: return [i, j];
      case 1: return [i - 1, j];
      case 2: return [i - 1, j - 1];
      default: return [i, j - 1];
    }
  };
  const leftSq = (i: number, j: number, dir: number): [number, number] => {
    switch (dir) {
      case 0: return [i, j - 1];
      case 1: return [i, j];
      case 2: return [i - 1, j];
      default: return [i - 1, j - 1];
    }
  };
  const canGo = (i: number, j: number, dir: number) => {
    const [ri, rj] = rightSq(i, j, dir);
    const [li, lj] = leftSq(i, j, dir);
    return has(ri, rj) && !has(li, lj);
  };
  // Di tepi bawah, loop searah jarum jam berjalan ke -x (dalam di atas = kanan arah jalan).
  const pts: [number, number][] = [];
  let i = i0 + 1;
  let j = j0;
  let dir = 2;
  const sx = i;
  const sz = j;
  for (let guard = 0; guard < 4 * L * L; guard++) {
    pts.push([i, j]);
    i += DX[dir];
    j += DZ[dir];
    if (i === sx && j === sz) break;
    // Coba belok kiri dulu (ke arah hutan), lalu lurus, lalu kanan.
    for (const nd of [(dir + 3) % 4, dir, (dir + 1) % 4]) {
      if (canGo(i, j, nd)) {
        dir = nd;
        break;
      }
    }
  }
  // Sederhanakan: hanya titik belok; ubah ke koordinat dunia (pusat sel).
  const wx = (k: number) => f.x[k];
  const wz = (k: number) => f.z[k * cols];
  const corners: [number, number][] = [[0, wz(j0)]];
  const tiles: RailTile[] = [];
  const n = pts.length;
  // pts[0] berada tepat setelah titik stasiun searah jalan mundur, jadi diperiksa paling akhir.
  for (let m = 1; m <= n; m++) {
    const k = m % n;
    const [pi, pj] = pts[(k - 1 + n) % n];
    const [ci, cj] = pts[k];
    const [ni, nj] = pts[(k + 1) % n];
    const ux = ci - pi;
    const uz = cj - pj;
    const vx = ni - ci;
    const vz = nj - cj;
    const cross = ux * vz - uz * vx;
    const dir = ux > 0 ? 0 : uz > 0 ? 1 : ux < 0 ? 2 : 3;
    tiles.push({ cell: cj * cols + ci, x: wx(ci), z: wz(cj), dir, turn: Math.sign(cross) });
    if (cross === 0) continue;
    corners.push([wx(ci), wz(cj)]);
  }
  return { track: new TrackPath({ corners, radius: TURN_R }), tiles };
}

function makeRail(levelIndex: number, inside: Uint8Array): Rail {
  const { track, tiles } = traceRail(levelIndex, inside);
  return { levelIndex, inside, depth: computeDepth(fieldFor(levelIndex), inside), track, tiles };
}

const railCache = new WeakMap<GameState, Rail>();

/** Rel saat ini untuk state (dihitung dari blok bila belum ada / level berganti). */
export function railOf(state: GameState): Rail {
  let r = railCache.get(state);
  if (!r || r.levelIndex !== state.levelIndex) {
    r = makeRail(state.levelIndex, computeInside(state.levelIndex, state.blocks));
    railCache.set(state, r);
  }
  return r;
}

/** Lupakan rel tersimpan (level baru / blok diganti dari luar simulasi). */
export function resetRail(state: GameState): void {
  railCache.delete(state);
}

function sameCells(a: Uint8Array, b: Uint8Array): boolean {
  for (let c = 0; c < a.length; c++) if (a[c] !== b[c]) return false;
  return true;
}

/** Titik-titik rel `track` sepanjang span, tiap `step`. */
function spanPoints(track: TrackPath, span: RailSpan, step: number): Vec2[] {
  const n = Math.max(1, Math.ceil(span.length / step));
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) out.push(track.pointAt(span.from + (k / n) * span.length));
  return out;
}

/** Rel di sepanjang span tetap persis di tempat yang sama setelah dipetakan ke rel baru. */
function keepsSpan(from: TrackPath, to: TrackPath, map: StageMapping, span: RailSpan): boolean {
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  const n = Math.max(1, Math.ceil(span.length / 0.1));
  for (let k = 0; k <= n; k++) {
    const d = from.wrap(span.from + (k / n) * span.length);
    from.pointAt(d, a);
    to.pointAt(map.map(d), b);
    if (Math.hypot(a.x - b.x, a.z - b.z) > 1e-3) return false;
  }
  return true;
}

/**
 * Hitung ulang rel setelah ada blok hancur atau kereta bergerak. Mengembalikan perubahan bila
 * lahan di dalam rel bertambah (pemanggil memetakan posisi kereta dan memancarkan event), atau null.
 * Dengan `span`, rel di bagian itu (tempat kereta) dijamin tidak berubah: lahan di dekatnya
 * ditunda sampai kereta lewat.
 */
export function updateRail(state: GameState, span?: RailSpan): RailChange | null {
  const from = railOf(state);
  const li = state.levelIndex;
  const target = computeInside(li, state.blocks);
  if (sameCells(target, from.inside)) return null;
  if (!span) {
    const to = makeRail(li, target);
    railCache.set(state, to);
    return { from, to, map: buildStageMapping(from.track, to.track) };
  }
  const avoid = spanPoints(from.track, span, 0.25);
  const ends = [avoid[0], avoid[avoid.length - 1]];
  for (const keep of KEEP_OUT) {
    const inside = growAway(li, from.inside, target, avoid, keep);
    if (sameCells(inside, from.inside)) return null;
    const to = makeRail(li, inside);
    const map = buildStageMapping(from.track, to.track, ends);
    if (!keepsSpan(from.track, to.track, map, span)) continue;
    railCache.set(state, to);
    return { from, to, map };
  }
  return null;
}

/** Kavling sudah di dalam rel dengan jarak aman (≥ 2 sel) dari rel. */
export function isPlotInside(rail: Rail, plot: number): boolean {
  return baseFor(rail.levelIndex).plotCells[plot].every((c) => rail.depth[c] >= 3);
}

/** Blok hidup yang terkurung di dalam rel (tidak bisa lagi disentuh gerinda). */
export function enclosedBlocks(rail: Rail, blocks: readonly number[]): number[] {
  const out: number[] = [];
  for (let c = 0; c < blocks.length; c++) if (rail.inside[c] && blocks[c] > 0) out.push(c);
  return out;
}

/** Kedalaman sel di titik (x, z): 0 = di luar rel, 1 = dilewati rel, ≥ 2 = lahan kota. */
export function depthAt(rail: Rail, x: number, z: number): number {
  const f = fieldFor(rail.levelIndex);
  const i = Math.floor((x + f.half) / CELL);
  const j = Math.floor((z + f.half) / CELL);
  if (i < 0 || j < 0 || i >= f.cols || j >= f.cols) return 0;
  return rail.depth[j * f.cols + i];
}
