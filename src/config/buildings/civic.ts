import type { ModuleDef, Prim } from '../../game/types';
import { box, cone, cyl, log, ProjectBuilder, sphere } from './builder';
import { house, shade, type HouseSpec } from './house';

/**
 * Gedung umum kota: balai desa/kota, sekolah, puskesmas/rumah sakit, rumah makan, pemadam,
 * perpustakaan, kantor polisi, pasar, lapangan bola. Sebagian besar memakai generator `house()`
 * yang sama dengan rumah (jadi gayanya seragam) lalu ditambah detail khasnya. Gedung besar
 * dirancang untuk kavling dua slot (tapak ± 3,8 × 1,5), sisanya kavling biasa (± 1,8 × 1,4).
 * Koordinat lokal: +z menghadap jalan.
 */

const RED = '#e53935';
const WHITE = '#f7f5ef';

/** Rumah + modul tambahan: `pre` dibangun paling awal (halaman), `post` paling akhir (detail). */
function withExtras(spec: HouseSpec, post: (b: ProjectBuilder) => void, pre?: (b: ProjectBuilder) => void): ModuleDef[] {
  const before = new ProjectBuilder();
  pre?.(before);
  const after = new ProjectBuilder();
  post(after);
  return [...before.done(), ...house(spec), ...after.done()];
}

/** Tiang bendera merah-putih. */
function flag(x: number, z: number, h = 1.9): Prim[] {
  return [
    box([x, 0.04, z], [0.16, 0.08, 0.16], '#bdb6aa', 0.02),
    cyl([x, h / 2, z], h, 'y', 0.025, '#d8dde3', 8),
    box([x + 0.17, h - 0.1, z], [0.3, 0.1, 0.02], RED, 0),
    box([x + 0.17, h - 0.2, z], [0.3, 0.1, 0.02], '#ffffff', 0),
    sphere([x, h + 0.02, z], 0.035, '#ffd35a'),
  ];
}

/** Papan nama dengan ikon sederhana (ikon: palang, buku, bintang, atau garis). */
function signBoard(x: number, y: number, z: number, w: number, board: string, icon: 'cross' | 'book' | 'star' | 'bar', ink = '#ffffff'): Prim[] {
  const prims: Prim[] = [box([x, y, z], [w, 0.24, 0.05], board, 0.02)];
  const fz = z + 0.035;
  if (icon === 'cross') prims.push(box([x, y, fz], [0.16, 0.05, 0.02], ink, 0), box([x, y, fz], [0.05, 0.16, 0.02], ink, 0));
  else if (icon === 'book') prims.push(box([x - 0.05, y, fz], [0.09, 0.13, 0.02], ink, 0), box([x + 0.05, y, fz], [0.09, 0.13, 0.02], ink, 0));
  else if (icon === 'star') prims.push(box([x, y, fz], [0.13, 0.13, 0.02], ink, 0, [0, 0, Math.PI / 4]), box([x, y, fz], [0.13, 0.13, 0.02], ink, 0));
  else prims.push(box([x, y, fz], [w * 0.7, 0.06, 0.02], ink, 0));
  return prims;
}

/** Palang merah besar di atas panel putih (puskesmas / rumah sakit). */
function redCross(x: number, y: number, z: number, s: number): Prim[] {
  return [box([x, y, z], [s, s, 0.05], WHITE, 0.02), box([x, y, z + 0.035], [s * 0.72, s * 0.24, 0.02], RED, 0), box([x, y, z + 0.035], [s * 0.24, s * 0.72, 0.02], RED, 0)];
}

/** Pagar rendah di depan (kiri & kanan jalan masuk). */
function frontFence(w: number, z: number, color: string): Prim[] {
  const prims: Prim[] = [];
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.35;
    const x1 = sx * (w / 2);
    const mid = (x0 + x1) / 2;
    prims.push(box([mid, 0.2, z], [Math.abs(x1 - x0), 0.04, 0.03], color, 0), box([mid, 0.1, z], [Math.abs(x1 - x0), 0.04, 0.03], color, 0));
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 0.3));
    for (let i = 0; i <= n; i++) prims.push(box([x0 + ((x1 - x0) * i) / n, 0.14, z], [0.035, 0.28, 0.035], color, 0));
  }
  return prims;
}

/** Menara kecil dengan atap kerucut di bubungan (lonceng / jam). */
function cupola(y: number, body: string, roof: string, clock: boolean): Prim[] {
  const prims: Prim[] = [box([0, y + 0.25, 0], [0.5, 0.5, 0.5], body, 0.03), cone([0, y + 0.78, 0], 0.42, 0.55, roof, 4, [0, Math.PI / 4, 0])];
  if (clock) prims.push(cyl([0, y + 0.28, 0.26], 0.03, 'z', 0.16, '#ffffff', 16), box([0, y + 0.32, 0.28], [0.02, 0.1, 0.01], '#2d3748', 0), box([0.03, y + 0.28, 0.28], [0.07, 0.02, 0.01], '#2d3748', 0));
  else prims.push(sphere([0, y + 0.22, 0], 0.12, '#e8b53a'));
  return prims;
}

// ---------------------------------------------------------------------------------------

/** Balai desa / balai kota: dua lantai lebar, beranda, menara jam/lonceng, bendera. */
export function townHall(wall: 'log' | 'brick', walls: [string, string], roof: [string, string]): ModuleDef[] {
  const w = 3.6;
  const d = 1.5;
  const floorH = 0.9;
  const top = 0.12 + floorH * 2;
  return withExtras(
    { w, d, floors: 2, floorH, wall, wallColors: walls, trim: '#fbfaf5', roof: 'gable', roofColors: roof, ridge: 'x', door: '#6b4a2b', frontWindows: 4, sideWindows: true, balcony: wall === 'log' ? '#c89660' : '#9aa3ad', bigDoor: false },
    (b) => {
      // Tiang beranda di depan pintu.
      const cols: Prim[] = [];
      for (const x of [-0.5, 0.5]) cols.push(cyl([x, 0.55, d / 2 + 0.34], 0.9, 'y', 0.06, '#f3efe4', 10));
      cols.push(box([0, 1.02, d / 2 + 0.3], [1.3, 0.08, 0.5], shade(roof[0], -0.05), 0.02));
      b.mod(4, 0.8, cols);
      b.mod(4, 0.7, cupola(top + d * 0.42, walls[0], roof[1], wall === 'brick'));
      b.mod(4, 0.6, signBoard(0, 0.12 + floorH + 0.62, d / 2 + 0.1, 1.2, '#2f7d5b', 'bar'));
      b.mod(4, 0.6, flag(-w / 2 + 0.25, d / 2 + 0.3));
    },
    (b) => b.mod(0, 0.2, [box([0, 0.05, d / 2 + 0.28], [1.4, 0.1, 0.5], '#d9d2c3', 0.02)]),
  );
}

/** Sekolah: dua lantai panjang dengan deretan jendela, bendera di halaman, pagar. */
export function school(wall: 'plank' | 'brick', walls: [string, string], roof: [string, string]): ModuleDef[] {
  const w = 3.8;
  const d = 1.4;
  return withExtras(
    { w, d, floors: 2, floorH: 0.82, wall, wallColors: walls, trim: '#ffffff', roof: 'gable', roofColors: roof, ridge: 'x', door: '#2f5d8f', frontWindows: 5, sideWindows: true },
    (b) => {
      b.mod(4, 0.6, flag(w / 2 - 0.3, d / 2 + 0.28, 1.7));
      b.mod(4, 0.6, signBoard(0, 0.12 + 0.82 + 0.1, d / 2 + 0.07, 1.1, '#1f4e79', 'star', '#ffd35a'));
      b.mod(4, 0.6, frontFence(w, d / 2 + 0.36, '#ffffff'));
    },
  );
}

/** Puskesmas (kecil) / rumah sakit (besar, bertingkat): dinding putih, palang merah. */
export function clinic(big: boolean, roof: [string, string]): ModuleDef[] {
  const w = big ? 3.6 : 1.8;
  const d = big ? 1.5 : 1.4;
  const floors = big ? 3 : 1;
  const floorH = big ? 0.8 : 1.0;
  const top = 0.12 + floors * floorH;
  return withExtras(
    { w, d, floors, floorH, wall: 'plank', wallColors: [WHITE, '#e9eef2'], trim: '#7fc4e8', roof: big ? 'flat' : 'gable', roofColors: big ? ['#c9d3dc', '#9fb3c4'] : roof, ridge: 'x', door: '#7fc4e8', frontWindows: big ? 4 : 2, sideWindows: true, awning: big ? ['#7fc4e8', '#ffffff'] : undefined },
    (b) => {
      b.mod(4, 0.8, redCross(0, big ? top - 0.35 : 0.12 + floorH + 0.28, d / 2 + 0.06, big ? 0.46 : 0.34));
      if (big) {
        // Tanda "H" helipad di atap datar.
        b.mod(4, 0.6, [cyl([0, top + 0.12, 0], 0.02, 'y', 0.5, '#4b5563', 20), box([-0.14, top + 0.14, 0], [0.07, 0.01, 0.42], '#ffffff', 0), box([0.14, top + 0.14, 0], [0.07, 0.01, 0.42], '#ffffff', 0), box([0, top + 0.14, 0], [0.28, 0.01, 0.07], '#ffffff', 0)]);
      }
      b.mod(4, 0.5, [box([w / 2 - 0.25, 0.3, d / 2 + 0.3], [0.08, 0.6, 0.08], '#d8dde3', 0), box([w / 2 - 0.25, 0.62, d / 2 + 0.3], [0.26, 0.2, 0.04], RED, 0.02)]);
    },
  );
}

/** Rumah makan / restoran: atap datar, tenda bergaris, meja payung di depan. */
export function restaurant(wall: 'plank' | 'brick', walls: [string, string], awning: [string, string], sign: string): ModuleDef[] {
  const w = 1.8;
  const d = 1.3;
  return withExtras(
    { w, d, floors: 1, floorH: 1.05, wall, wallColors: walls, trim: '#ffffff', roof: 'flat', roofColors: ['#8b6a4a', shade(walls[0], -0.1)], door: '#6b4a2b', frontWindows: 1, awning, sign },
    (b) => {
      for (const x of [-0.62, 0.62]) {
        b.mod(4, 0.5, [
          cyl([x, 0.18, d / 2 + 0.36], 0.34, 'y', 0.12, '#f3efe4', 12),
          cyl([x, 0.42, d / 2 + 0.36], 0.46, 'y', 0.015, '#8a8f98', 6),
          cone([x, 0.66, d / 2 + 0.36], 0.26, 0.14, awning[0], 10),
          box([x - 0.16, 0.12, d / 2 + 0.36], [0.08, 0.18, 0.08], '#c89660', 0.01),
          box([x + 0.16, 0.12, d / 2 + 0.36], [0.08, 0.18, 0.08], '#c89660', 0.01),
        ]);
      }
    },
  );
}

/** Pos pemadam kebakaran: pintu garasi lebar, dinding merah, menara selang. */
export function fireStation(wall: 'plank' | 'brick'): ModuleDef[] {
  const w = 1.9;
  const d = 1.4;
  const floorH = 1.1;
  return withExtras(
    { w, d, floors: 1, floorH, wall, wallColors: ['#d63a33', '#c4302a'], trim: '#ffffff', roof: 'flat', roofColors: ['#7e848b', '#b1352f'], door: '#f3efe4', frontWindows: 0, bigDoor: true },
    (b) => {
      b.mod(4, 0.8, [box([-w / 2 + 0.2, 0.9, -d / 2 + 0.2], [0.34, 1.8, 0.34], '#c4302a', 0.03), box([-w / 2 + 0.2, 1.84, -d / 2 + 0.2], [0.42, 0.08, 0.42], '#7e848b', 0.02)]);
      b.mod(4, 0.6, [sphere([0.55, 0.12 + floorH + 0.06, d / 2 + 0.05], 0.07, '#ffd35a'), sphere([-0.55, 0.12 + floorH + 0.06, d / 2 + 0.05], 0.07, '#ffd35a')]);
      b.mod(4, 0.5, [box([w / 2 - 0.15, 0.18, d / 2 + 0.3], [0.14, 0.3, 0.14], RED, 0.03), sphere([w / 2 - 0.15, 0.36, d / 2 + 0.3], 0.06, RED)]);
    },
  );
}

/** Perpustakaan: dinding bata, serambi bertiang & segitiga depan, papan buku. */
export function library(walls: [string, string]): ModuleDef[] {
  const w = 1.8;
  const d = 1.3;
  const floorH = 1.1;
  return withExtras(
    { w, d, floors: 1, floorH, wall: 'brick', wallColors: walls, trim: '#fbfaf5', roof: 'gable', roofColors: ['#5b6474', '#4b5563'], ridge: 'x', door: '#6b4a2b', frontWindows: 2 },
    (b) => {
      const cols: Prim[] = [];
      for (const x of [-0.6, -0.2, 0.2, 0.6]) cols.push(cyl([x, 0.6, d / 2 + 0.28], 0.98, 'y', 0.055, '#f3efe4', 10));
      b.mod(4, 0.8, cols);
      b.mod(4, 0.6, [box([0, 1.13, d / 2 + 0.26], [1.5, 0.08, 0.5], '#f3efe4', 0.02), box([0, 0.06, d / 2 + 0.28], [1.5, 0.12, 0.5], '#d9d2c3', 0.02)]);
      b.mod(4, 0.5, signBoard(0, 1.3, d / 2 + 0.3, 0.7, '#1f4e79', 'book'));
    },
  );
}

/** Kantor polisi: biru-putih, lampu sirene di atap, papan bintang. */
export function policeStation(): ModuleDef[] {
  const w = 1.8;
  const d = 1.4;
  const floorH = 0.9;
  const top = 0.12 + floorH * 2;
  return withExtras(
    { w, d, floors: 2, floorH, wall: 'plank', wallColors: ['#e9eef2', '#dbe3ea'], trim: '#1f4e79', roof: 'flat', roofColors: ['#7e848b', '#1f4e79'], door: '#1f4e79', frontWindows: 2 },
    (b) => {
      b.mod(4, 0.6, signBoard(0, 0.12 + floorH + 0.1, d / 2 + 0.07, 1.0, '#1f4e79', 'star', '#ffd35a'));
      b.mod(4, 0.6, [box([0, top + 0.3, 0], [0.34, 0.1, 0.16], '#4b5563', 0.02), sphere([-0.08, top + 0.4, 0], 0.07, '#3d7bff'), sphere([0.08, top + 0.4, 0], 0.07, RED)]);
    },
  );
}

/** Pasar: lantai paving, lapak-lapak berpayung warna-warni, keranjang buah. */
export function market(canopies: string[]): ModuleDef[] {
  const b = new ProjectBuilder();
  const w = 3.8;
  const d = 1.5;
  for (let i = 0; i < 4; i++) b.mod(0, 0.2, box([-w / 2 + (w / 4) * (i + 0.5), 0.04, 0], [w / 4 - 0.02, 0.08, d], '#d9c9a8', 0.02));
  const stalls = [-1.35, -0.45, 0.45, 1.35];
  stalls.forEach((x, i) => {
    const posts: Prim[] = [];
    for (const sx of [-0.36, 0.36]) for (const z of [-0.45, 0.45]) posts.push(log([x + sx, 0.5, z], 0.84, 'y', 0.035, '#8a5a36'));
    b.mod(1, 0.8, posts);
    b.mod(2, 0.8, [box([x, 0.3, 0.35], [0.76, 0.36, 0.3], '#b98246', 0.02), box([x, 0.49, 0.35], [0.8, 0.04, 0.34], '#8a5a36', 0.01)]);
    const c = canopies[i % canopies.length];
    b.mod(3, 0.9, [box([x, 0.98, 0.18], [0.86, 0.05, 0.62], c, 0.02, [0.22, 0, 0]), box([x, 0.98, -0.3], [0.86, 0.05, 0.5], shade(c, -0.08), 0.02, [-0.28, 0, 0])]);
    const goods: Prim[] = [];
    const fruit = ['#ff7043', '#ffd35a', '#7cc34a', '#e53935'];
    for (let k = 0; k < 4; k++) goods.push(sphere([x - 0.27 + k * 0.18, 0.56, 0.35], 0.07, fruit[(k + i) % fruit.length]));
    b.mod(4, 0.5, goods);
  });
  b.mod(4, 0.6, [box([-w / 2 + 0.05, 0.7, d / 2 - 0.05], [0.08, 1.4, 0.08], '#8a5a36', 0), box([w / 2 - 0.05, 0.7, d / 2 - 0.05], [0.08, 1.4, 0.08], '#8a5a36', 0), box([0, 1.36, d / 2 - 0.05], [w, 0.22, 0.06], '#2f7d5b', 0.02)]);
  return b.done();
}

/** Lapangan bola / stadion kecil: rumput bergaris, garis kapur, gawang, tribun. */
export function sportsField(stands: string, lights: boolean): ModuleDef[] {
  const b = new ProjectBuilder();
  const w = 3.9;
  const pd = 1.15;
  const pz = 0.2;
  for (let i = 0; i < 4; i++) b.mod(0, 0.2, box([-w / 2 + (w / 4) * (i + 0.5), 0.03, pz], [w / 4, 0.06, pd], i % 2 ? '#5fb84a' : '#6cc657', 0));
  const L = '#ffffff';
  b.mod(1, 0.6, [
    box([0, 0.065, pz - pd / 2 + 0.04], [w - 0.1, 0.01, 0.03], L, 0),
    box([0, 0.065, pz + pd / 2 - 0.04], [w - 0.1, 0.01, 0.03], L, 0),
    box([-w / 2 + 0.06, 0.065, pz], [0.03, 0.01, pd - 0.06], L, 0),
    box([w / 2 - 0.06, 0.065, pz], [0.03, 0.01, pd - 0.06], L, 0),
    box([0, 0.065, pz], [0.03, 0.01, pd - 0.06], L, 0),
    cyl([0, 0.066, pz], 0.01, 'y', 0.2, L, 16),
    cyl([0, 0.068, pz], 0.01, 'y', 0.17, '#6cc657', 16),
  ]);
  for (const sx of [-1, 1]) {
    const gx = sx * (w / 2 - 0.1);
    b.mod(2, 0.7, [box([gx, 0.2, pz - 0.22], [0.04, 0.34, 0.04], L, 0), box([gx, 0.2, pz + 0.22], [0.04, 0.34, 0.04], L, 0), box([gx, 0.36, pz], [0.04, 0.04, 0.48], L, 0), box([gx + sx * 0.12, 0.2, pz], [0.02, 0.3, 0.44], '#dfe7ee', 0)]);
  }
  for (let r = 0; r < 3; r++) b.mod(3, 0.8, box([0, 0.08 + r * 0.12, -0.52 - r * 0.1], [w - 0.4 - r * 0.2, 0.12 + r * 0.02, 0.14], r % 2 ? shade(stands, -0.08) : stands, 0.02));
  const people: Prim[] = [];
  const shirts = ['#e53935', '#3d7bff', '#ffd35a', '#2fbf71', '#ff7aa2'];
  for (let k = 0; k < 9; k++) people.push(sphere([-1.5 + k * 0.38, 0.3 + (k % 3) * 0.12, -0.55 - (k % 3) * 0.1], 0.06, shirts[k % shirts.length]));
  b.mod(4, 0.6, people);
  if (lights) {
    for (const sx of [-1, 1]) b.mod(4, 0.6, [cyl([sx * (w / 2 - 0.05), 0.85, -0.72], 1.7, 'y', 0.035, '#9aa3ad', 8), box([sx * (w / 2 - 0.05), 1.72, -0.66], [0.3, 0.14, 0.06], '#fff6c2', 0.02)]);
  } else {
    b.mod(4, 0.5, [flag(-w / 2 + 0.05, pz + pd / 2 + 0.05, 0.9)].flat());
  }
  return b.done();
}
