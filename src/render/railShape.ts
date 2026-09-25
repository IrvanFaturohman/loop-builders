import { TURN_R } from '../game/rail';

/**
 * Bentuk satu ubin rel dalam koordinat lokal: rel masuk dari (-0.5, 0) searah +x, belok di
 * pusat sel. Dipakai bersama railView (alas, bantalan, batang rel) dan cityView (rumput di sisi
 * kanan rel), supaya lengkung rumput persis mengikuti lengkung rel.
 */

export type P2 = { x: number; z: number };

/** Titik sampel busur per ubin belok. */
export const ARC_N = 10;
/** Setengah lebar alas rel (tanah di bawah bantalan). */
export const BED = 0.45;

/**
 * Garis ubin pada offset `o` ke kanan (+z). Sisi dalam belokan yang offset-nya melebihi radius
 * menjadi sudut tajam. Selalu ARC_N + 3 titik.
 */
export function tileLine(turn: number, o: number): P2[] {
  const n = ARC_N;
  if (turn === 0) return Array.from({ length: n + 3 }, (_, k) => ({ x: -0.5 + k / (n + 2), z: o }));
  const r = TURN_R;
  const pts: P2[] = [{ x: -0.5, z: o }];
  const rs = r - turn * o;
  if (rs <= 0.005) {
    for (let k = 0; k <= n; k++) pts.push({ x: -turn * o, z: o });
  } else {
    const a0 = (-turn * Math.PI) / 2;
    for (let k = 0; k <= n; k++) {
      const a = a0 * (1 - k / n);
      pts.push({ x: -r + rs * Math.cos(a), z: turn * r + rs * Math.sin(a) });
    }
  }
  pts.push({ x: -turn * o, z: turn * 0.5 });
  return pts;
}

/**
 * Bagian sel di kanan alas rel (sisi kota), dibatasi tepi sel: diisi rumput supaya kota selalu
 * menempel ke rel dan melengkung di belokan.
 */
export function grassPiece(turn: number): P2[] {
  const pts = tileLine(turn, BED);
  if (turn === 0) pts.push({ x: 0.5, z: 0.5 }, { x: -0.5, z: 0.5 });
  else if (turn > 0) pts.push({ x: -0.5, z: 0.5 });
  else pts.push({ x: 0.5, z: -0.5 }, { x: 0.5, z: 0.5 }, { x: -0.5, z: 0.5 });
  return pts.filter((p, i) => {
    const q = pts[(i - 1 + pts.length) % pts.length];
    return Math.hypot(p.x - q.x, p.z - q.z) > 1e-6;
  });
}

const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

/** Titik lokal ubin → dunia untuk ubin di (x, z) dengan arah masuk `dir`. */
export function tileToWorld(p: P2, x: number, z: number, dir: number): P2 {
  const dx = DX[dir];
  const dz = DZ[dir];
  return { x: x + p.x * dx - p.z * dz, z: z + p.x * dz + p.z * dx };
}

/** Sudut rotasi-y three.js yang memetakan +x lokal ke arah masuk `dir`. */
export function tileRotation(dir: number): number {
  return Math.atan2(-DZ[dir], DX[dir]);
}
