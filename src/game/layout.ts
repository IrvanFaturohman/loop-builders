import { buildingSize } from '../config/buildings';
import { LEVELS } from '../config/levels';
import type { LevelDefinition, LotDef, Vec2 } from './types';

/**
 * Tata letak pulau: rel dasar, baris hutan, pita (zona jenis blok), dan rencana kota.
 *
 * Pulau berbentuk persegi. `ringDistance` = jarak Chebyshev bertanda ke rel awal (persegi
 * setengah-lebar `ringStart`), jadi baris hutan dan pita berupa cincin persegi sejajar grid. Rel
 * yang sebenarnya dinamis (lihat rail.ts): mengikuti tepi lahan yang sudah bersih.
 *
 * Kota berbentuk grid: alun-alun di tengah (gedung utama menghadap air mancur), jalan lingkar di
 * tepi dalam lahan tiap distrik, empat jalan raya dari alun-alun, dan jalan samping yang segaris
 * antar distrik sehingga terbentuk blok-blok. Tiap distrik d ≥ 1 = satu baris kavling di lahan
 * bekas pita d-1, menghadap keluar ke jalan lingkar berikutnya. Gedung besar mengambil satu blok
 * dua slot; slot yang tidak terpakai menjadi taman.
 *
 * Loop berjalan searah jarum jam (di layar: x ke kanan, z ke bawah) mulai dari tengah sisi
 * bawah, tempat stasiun berada. Sisi kiri kereta = sisi luar loop = arah hutan.
 */

/** Lebar kavling biasa sepanjang jalan; kavling besar (gedung) = 2 slot + celah. */
export const LOT_W = 2.0;
/** Kedalaman kavling. */
export const LOT_D = 1.8;
/** Celah antar kavling dalam satu blok. */
const LOT_GAP = 0.2;
/** Lebar jalan lingkar & jalan samping. */
export const ROAD_W = 0.5;
/** Lebar jalan raya (empat poros dari alun-alun). */
export const AVENUE_W = 0.8;
/** Posisi jalan samping sepanjang baris (segaris di semua distrik → membentuk grid). */
const SIDE_STREETS = [5, 10, 15];
/** Setengah lebar koridor rel yang bebas kavling. */
export const RAIL_CLEAR = 0.85;
/** Hutan dimulai lewat jarak bertanda ini dari rel awal (baris pertama tepat satu sel di luar rel). */
export const FOREST_START = 0.5;

/** Jumlah distrik = jumlah pita hutan. */
export function districtCount(level: LevelDefinition): number {
  return level.districts.length;
}

/** Jarak bertanda awal pita ke-k (juga dasar cincin kavling distrik k+1). */
export function bandStart(level: LevelDefinition, k: number): number {
  return k * level.ringStep;
}

/** Jarak Chebyshev bertanda titik (x, z) ke rel awal: negatif di dalam, positif di luar. */
export function ringDistance(level: LevelDefinition, x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z)) - level.ringStart;
}

/**
 * Pita hutan tempat titik berada: -1 = kota awal (bukan hutan), k = pita ke-k (bobot jenis blok
 * `bands[k]`, hasilnya membiayai distrik k), districtCount = di luar pulau.
 */
export function bandOf(level: LevelDefinition, x: number, z: number): number {
  const sd = ringDistance(level, x, z) - FOREST_START;
  if (sd <= 0) return -1;
  return Math.min(districtCount(level), Math.ceil(sd / level.ringStep) - 1);
}

/** Jarak bertanda tepi luar pulau (baris hutan terakhir). */
export function islandOffset(level: LevelDefinition): number {
  return FOREST_START + bandStart(level, districtCount(level));
}

export interface ResolvedPlot {
  /** Indeks global kavling (urutan distrik lalu urutan di distrik). */
  index: number;
  district: number;
  def: LotDef;
  /** Pusat kavling. */
  pos: Vec2;
  /** Arah hadap bangunan (lokal +z menghadap jalan). */
  rotY: number;
  /** Arah hadap (unit, sejajar sumbu) dari kavling ke jalan di depannya. */
  facing: Vec2;
  /** Lebar kavling sepanjang jalan & kedalamannya. */
  w: number;
  d: number;
  /** Titik tengah jalan tepat di depan kavling (tujuan truk pengantar bahan). */
  front: Vec2;
  /** Setengah lebar jalan lingkar di depan kavling (0 = kavling alun-alun). */
  ring: number;
}

/** Slot kosong di blok kota yang dijadikan taman (hanya hiasan, tanpa biaya). */
export interface ParkSlot {
  district: number;
  pos: Vec2;
  facing: Vec2;
  w: number;
  d: number;
  /** Sudut cincin (taman persegi) atau slot di sepanjang baris. */
  corner: boolean;
}

/** Potongan jalan lurus (garis tengah + lebar); muncul begitu lahannya sudah di dalam rel. */
export interface RoadPiece {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  w: number;
}

export interface CityPlan {
  plots: ResolvedPlot[];
  parks: ParkSlot[];
  roads: RoadPiece[];
}

/** Tepi dalam lahan distrik d ≥ 1 (bekas pita d-1), sebagai setengah lebar persegi. */
function districtEdge(level: LevelDefinition, d: number): number {
  return level.ringStart + FOREST_START + bandStart(level, d - 1);
}

/** Setengah lebar garis tengah jalan lingkar k (k = 1..jumlah distrik): di tepi dalam lahan distrik k. */
export function ringRoadHalf(level: LevelDefinition, k: number): number {
  return districtEdge(level, k) + 0.05 + ROAD_W / 2;
}

/** Setengah lebar garis tengah baris kavling distrik d ≥ 1 (menghadap keluar ke jalan lingkar d+1). */
function rowHalf(level: LevelDefinition, d: number): number {
  return ringRoadHalf(level, d) + ROAD_W / 2 + 0.05 + LOT_D / 2;
}

/** Sisi persegi: arah hadap keluar & sumbu sepanjang baris. */
const SIDES: { out: Vec2; along: Vec2 }[] = [
  { out: { x: 0, z: 1 }, along: { x: 1, z: 0 } }, // selatan (stasiun)
  { out: { x: 0, z: -1 }, along: { x: -1, z: 0 } }, // utara
  { out: { x: 1, z: 0 }, along: { x: 0, z: -1 } }, // timur
  { out: { x: -1, z: 0 }, along: { x: 0, z: 1 } }, // barat
];

/** Alun-alun (distrik 0): gedung utama di utara menghadap air mancur, empat kavling mengapitnya. */
const PLAZA: { pos: Vec2; facing: Vec2; w: number }[] = [
  { pos: { x: 0, z: -2 }, facing: { x: 0, z: 1 }, w: LOT_W * 2 + LOT_GAP },
  { pos: { x: -2, z: 0 }, facing: { x: 1, z: 0 }, w: LOT_W },
  { pos: { x: 2, z: 0 }, facing: { x: -1, z: 0 }, w: LOT_W },
  { pos: { x: -1.9, z: 2 }, facing: { x: 0, z: -1 }, w: LOT_W },
  { pos: { x: 1.9, z: 2 }, facing: { x: 0, z: -1 }, w: LOT_W },
];

interface Slot {
  side: number;
  /** Posisi sepanjang baris (koordinat sumbu `along`). */
  u: number;
  /** Nomor blok (urutan menjauhi jalan raya) & sisi jalan raya (+1 / -1). */
  block: number;
  half: number;
  /** Slot ke-berapa di bloknya, dan jumlah slot di blok itu. */
  k: number;
  n: number;
}

/** Slot kavling satu baris distrik: blok-blok di antara jalan raya, jalan samping, dan sudut. */
function rowSlots(c: number): Slot[] {
  const limit = c - LOT_D / 2 - 0.1;
  const cuts = [AVENUE_W / 2 + 0.1, ...SIDE_STREETS.flatMap((s) => [s - ROAD_W / 2 - 0.05, s + ROAD_W / 2 + 0.05])];
  const out: Slot[] = [];
  for (let side = 0; side < 4; side++)
    for (const half of [1, -1])
      for (let block = 0; block * 2 < cuts.length; block++) {
        const a = cuts[block * 2];
        const b = Math.min(limit, cuts[block * 2 + 1] ?? Infinity);
        const n = Math.floor((b - a + LOT_GAP) / (LOT_W + LOT_GAP));
        if (n <= 0) continue;
        const used = n * LOT_W + (n - 1) * LOT_GAP;
        const start = a + (b - a - used) / 2;
        for (let k = 0; k < n; k++) out.push({ side, u: half * (start + LOT_W / 2 + k * (LOT_W + LOT_GAP)), block, half, k, n });
      }
  return out;
}

function buildPlan(level: LevelDefinition): CityPlan {
  const plots: ResolvedPlot[] = [];
  const parks: ParkSlot[] = [];
  const push = (district: number, def: LotDef, pos: Vec2, facing: Vec2, w: number, ring: number, reach: number) => {
    const front = { x: pos.x + facing.x * reach, z: pos.z + facing.z * reach };
    plots.push({ index: plots.length, district, def, pos, facing, w, d: LOT_D, front, ring, rotY: Math.atan2(facing.x, facing.z) });
  };

  level.districts.forEach((dist, di) => {
    // Kavling kecil diberi nomor lebih dulu (diisi bahan lebih dulu): rumah cepat jadi, gedung
    // besar menjadi penutup distrik.
    const placed: { def: LotDef; pos: Vec2; facing: Vec2; w: number; ring: number; reach: number }[] = [];
    const big = dist.lots.filter((l) => buildingSize(l.building) > 1);
    const small = dist.lots.filter((l) => buildingSize(l.building) <= 1);
    if (di === 0) {
      if (big.length > 1 || small.length > PLAZA.length - 1) throw new Error(`${level.id}: alun-alun maksimal 1 gedung besar + ${PLAZA.length - 1} kavling`);
      small.forEach((def, i) => placed.push({ def, pos: PLAZA[i + 1].pos, facing: PLAZA[i + 1].facing, w: LOT_W, ring: 0, reach: LOT_D / 2 + 0.35 }));
      for (const def of big) placed.push({ def, pos: PLAZA[0].pos, facing: PLAZA[0].facing, w: PLAZA[0].w, ring: 0, reach: LOT_D / 2 + 0.35 });
    } else {
      const c = rowHalf(level, di);
      const ring = ringRoadHalf(level, di + 1);
      const slots = rowSlots(c);
      const free = new Set(slots);
      const at = (s: Slot, u: number) => {
        const side = SIDES[s.side];
        return { pos: { x: side.out.x * c + side.along.x * u, z: side.out.z * c + side.along.z * u }, facing: side.out };
      };
      // Gedung besar (2 slot) di blok dekat jalan raya: selatan dulu (paling terlihat dari stasiun), lalu utara, timur, barat.
      const bigPlaced: typeof placed = [];
      big.forEach((def, i) => {
        const pair = slots.filter((s) => free.has(s) && s.n >= 2 && s.k === 0 && free.has(slots[slots.indexOf(s) + 1]));
        pair.sort((a, b) => (a.side === i % 4 ? 0 : 1) - (b.side === i % 4 ? 0 : 1) || a.block - b.block || b.half - a.half);
        const s = pair[0];
        if (!s) throw new Error(`${level.id}: tidak ada blok untuk ${def.building} di distrik ${di}`);
        const t = slots[slots.indexOf(s) + 1];
        free.delete(s);
        free.delete(t);
        bigPlaced.push({ def, ...at(s, (s.u + t.u) / 2), w: LOT_W * 2 + LOT_GAP, ring, reach: ring - c });
      });
      // Kavling biasa bergiliran antar sisi & sisi jalan raya, dari blok terdekat jalan raya.
      const order = [...free].sort((a, b) => a.block - b.block || a.k - b.k || a.side - b.side || b.half - a.half);
      if (small.length > order.length) throw new Error(`${level.id}: distrik ${di} butuh ${small.length} kavling, hanya ada ${order.length} slot`);
      small.forEach((def, i) => {
        const s = order[i];
        free.delete(s);
        placed.push({ def, ...at(s, s.u), w: LOT_W, ring, reach: ring - c });
      });
      placed.push(...bigPlaced);
      // Sisa slot jadi taman; sudut cincin jadi taman persegi.
      for (const s of free) parks.push({ district: di, ...at(s, s.u), w: LOT_W, d: LOT_D, corner: false });
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        parks.push({ district: di, pos: { x: sx * c, z: sz * c }, facing: { x: 0, z: sz }, w: LOT_D, d: LOT_D, corner: true });
      }
    }
    for (const p of placed) push(di, p.def, p.pos, p.facing, p.w, p.ring, p.reach);
  });
  return { plots, parks, roads: buildRoads(level) };
}

/** Jaringan jalan dalam potongan sepanjang ±1 (muncul sepotong demi sepotong saat rel maju). */
function buildRoads(level: LevelDefinition): RoadPiece[] {
  const roads: RoadPiece[] = [];
  const N = districtCount(level);
  const edge = level.ringStart + islandOffset(level);
  const line = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len));
    for (let i = 0; i < n; i++) roads.push({ x0: x0 + ((x1 - x0) * i) / n, z0: z0 + ((z1 - z0) * i) / n, x1: x0 + ((x1 - x0) * (i + 1)) / n, z1: z0 + ((z1 - z0) * (i + 1)) / n, w });
  };
  // Jalan lingkar tiap distrik.
  for (let k = 1; k <= N; k++) {
    const r = ringRoadHalf(level, k);
    const e = r + ROAD_W / 2;
    line(-e, r, e, r, ROAD_W);
    line(-e, -r, e, -r, ROAD_W);
    line(r, -r + ROAD_W / 2, r, r - ROAD_W / 2, ROAD_W);
    line(-r, -r + ROAD_W / 2, -r, r - ROAD_W / 2, ROAD_W);
  }
  // Empat jalan raya: selatan dari air mancur ke stasiun; tiga lainnya dari balik kavling alun-alun.
  line(0, 1, 0, edge, AVENUE_W);
  line(0, -3, 0, -edge, AVENUE_W);
  line(3, 0, edge, 0, AVENUE_W);
  line(-3, 0, -edge, 0, AVENUE_W);
  // Jalan samping di tiap baris distrik, segaris antar distrik.
  for (let d = 1; d < N; d++) {
    const r0 = ringRoadHalf(level, d) + ROAD_W / 2;
    const r1 = ringRoadHalf(level, d + 1) - ROAD_W / 2;
    const limit = rowHalf(level, d) - LOT_D / 2 - 0.1;
    for (const s of SIDE_STREETS) {
      if (s > limit) continue;
      for (const u of [s, -s]) {
        line(u, r0, u, r1, ROAD_W);
        line(u, -r0, u, -r1, ROAD_W);
        line(r0, u, r1, u, ROAD_W);
        line(-r0, u, -r1, u, ROAD_W);
      }
    }
  }
  return roads;
}

const planCache = new Map<number, CityPlan>();

/** Rencana kota sebuah level: kavling, taman, dan jalan (di-cache). */
export function cityPlanOf(levelIndex: number): CityPlan {
  let p = planCache.get(levelIndex);
  if (!p) {
    p = buildPlan(LEVELS[levelIndex]);
    planCache.set(levelIndex, p);
  }
  return p;
}

/** Kavling sebuah level (di-cache). */
export function plotsOfLevel(levelIndex: number): ResolvedPlot[] {
  return cityPlanOf(levelIndex).plots;
}

/** Kotak batas pulau (untuk kamera & bayangan). */
export function islandBounds(level: LevelDefinition): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const h = level.ringStart + islandOffset(level);
  return { minX: -h, maxX: h, minZ: -h, maxZ: h };
}

/** Jari-jari lintasan truk mengitari air mancur alun-alun. */
const PLAZA_LOOP = 1.05;

/**
 * Rute truk pengantar bahan dari stasiun (`start`, di rel sisi selatan) ke depan kavling: masuk
 * lewat jalan raya selatan, lalu menyusuri jalan lingkar kavling itu (arah terpendek) sampai
 * tepat di depannya. Kavling alun-alun dicapai dengan mengitari air mancur.
 */
export function deliveryRoute(levelIndex: number, plot: number, start: Vec2): Vec2[] {
  const p = plotsOfLevel(levelIndex)[plot];
  const route: Vec2[] = [{ x: 0, z: start.z }];
  if (p.district === 0) {
    route.push({ x: 0, z: PLAZA_LOOP });
    const a0 = Math.PI / 2;
    let a1 = Math.atan2(p.pos.z, p.pos.x);
    while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
    while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.3));
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      route.push({ x: Math.cos(a) * PLAZA_LOOP, z: Math.sin(a) * PLAZA_LOOP });
    }
    return route;
  }
  const r = p.ring;
  route.push({ x: 0, z: r });
  // Keliling persegi searah jarum jam dari tengah sisi selatan: S(-x) → W(-z) → N(+x) → E(+z) → S.
  const corners: Vec2[] = [
    { x: -r, z: r },
    { x: -r, z: -r },
    { x: r, z: -r },
    { x: r, z: r },
  ];
  const f = p.front;
  let along: number;
  if (Math.abs(f.z - r) < 1e-6 && f.x <= 0) along = -f.x;
  else if (Math.abs(f.x + r) < 1e-6) along = r + (r - f.z);
  else if (Math.abs(f.z + r) < 1e-6) along = 3 * r + (f.x + r);
  else if (Math.abs(f.x - r) < 1e-6) along = 5 * r + (f.z + r);
  else along = 7 * r + (r - f.x);
  const total = 8 * r;
  if (along <= total / 2) {
    for (let k = 0; k < 4 && along > r + 2 * r * k; k++) route.push(corners[k]);
  } else {
    for (let k = 3; k >= 0 && total - along > r + 2 * r * (3 - k); k--) route.push(corners[k]);
  }
  route.push(f);
  return route;
}
