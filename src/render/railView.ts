import * as THREE from 'three';
import type { Rail, RailTile } from '../game/rail';
import type { TrackPath } from '../game/track';
import { cbox, mergeFlat } from './geom';
import { SHARED } from './palette';
import { BED, tileLine, tileRotation, type P2 } from './railShape';

/**
 * Rel dari ubin: satu ubin per sel yang dilewati rel (lurus, belok ke kota, belok ke hutan),
 * masing-masing alas tanah (warna tanah level, mengikuti lengkung rel) + 4 bantalan kayu + dua
 * batang rel. Rumput di sisi kanan rel digambar cityView dengan bentuk yang sama. Garis tengah ubin persis
 * mengikuti TrackPath (lurus lewat pusat sel, lengkung radius TURN_R), jadi kereta
 * yang berjalan di TrackPath pas di atas ubinnya.
 *
 * Saat rel berubah, ubin yang tidak lagi terpakai dipasangkan dengan ubin baru terdekat lalu
 * melompat memantul ke tempat barunya (berurutan seperti gelombang); ubin tanpa pasangan jatuh
 * dari atas, dan sisa ubin lama melompat lalu mengecil.
 */

const BED_H = 0.03;
const TIES = 4;
const TIE_ALONG = 0.11;
const TIE_ACROSS = 0.82;
const TIE_H = 0.022;
const RAIL_O = 0.27;
const RAIL_W = 0.06;
const RAIL_H = 0.035;
/** Tinggi permukaan batang rel: roda kereta berdiri di sini. */
export const RAIL_TOP = BED_H + TIE_H + RAIL_H;
const WOOD = '#8a5a36';
const STEEL = '#c9d0d8';

const FLIGHT = 0.34;
const SQUASH = 0.14;
const HOP_H = 0.5;
const STAGGER = 0.035;
const DROP_H = 1.4;
const PAIR_MAX = 2.6;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Penumpuk segitiga non-indexed (position/normal/color) yang menghadap ke normal yang diminta. */
class Mesher {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  tri(a: number[], b: number[], c: number[], n: number[], color: THREE.Color): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const gx = uy * vz - uz * vy;
    const gy = uz * vx - ux * vz;
    const gz = ux * vy - uy * vx;
    if (gx * gx + gy * gy + gz * gz < 1e-12) return;
    const [p, q] = gx * n[0] + gy * n[1] + gz * n[2] < 0 ? [c, b] : [b, c];
    for (const v of [a, p, q]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  quad(a: number[], b: number[], c: number[], d: number[], n: number[], color: THREE.Color): void {
    this.tri(a, b, c, n, color);
    this.tri(a, c, d, n, color);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/** Pita berpenampang kotak di antara dua garis offset (batang rel, alas rel). */
function bar(m: Mesher, a: P2[], b: P2[], y0: number, y1: number, color: THREE.Color): void {
  for (let k = 0; k < a.length - 1; k++) {
    const a0 = a[k];
    const a1 = a[k + 1];
    const b0 = b[k];
    const b1 = b[k + 1];
    m.quad([a0.x, y1, a0.z], [b0.x, y1, b0.z], [b1.x, y1, b1.z], [a1.x, y1, a1.z], [0, 1, 0], color);
    for (const [p0, p1, other] of [
      [a0, a1, b0],
      [b0, b1, a0],
    ] as const) {
      let nx = p1.z - p0.z;
      let nz = -(p1.x - p0.x);
      const l = Math.hypot(nx, nz);
      if (l < 1e-6) continue;
      nx /= l;
      nz /= l;
      if (nx * (other.x - p0.x) + nz * (other.z - p0.z) > 0) {
        nx = -nx;
        nz = -nz;
      }
      m.quad([p0.x, y0, p0.z], [p1.x, y0, p1.z], [p1.x, y1, p1.z], [p0.x, y1, p0.z], [nx, 0, nz], color);
    }
  }
}

/** Geometri satu jenis ubin (lokal, masuk searah +x). */
function tileGeometry(turn: number, soil: string): THREE.BufferGeometry {
  // Bantalan tersebar rata sepanjang garis tengah.
  const mid = tileLine(turn, 0);
  const acc = [0];
  for (let k = 1; k < mid.length; k++) acc.push(acc[k - 1] + Math.hypot(mid[k].x - mid[k - 1].x, mid[k].z - mid[k - 1].z));
  const total = acc[acc.length - 1];
  const parts: THREE.BufferGeometry[] = [];
  for (let t = 0; t < TIES; t++) {
    const s = ((t + 0.5) / TIES) * total;
    let k = 1;
    while (k < acc.length - 1 && acc[k] < s) k++;
    const seg = acc[k] - acc[k - 1] || 1;
    const u = (s - acc[k - 1]) / seg;
    const x = mid[k - 1].x + (mid[k].x - mid[k - 1].x) * u;
    const z = mid[k - 1].z + (mid[k].z - mid[k - 1].z) * u;
    const dx = mid[k].x - mid[k - 1].x;
    const dz = mid[k].z - mid[k - 1].z;
    const dl = Math.hypot(dx, dz) || 1;
    // Arah melintang ke kanan jalan; sisi dalam belokan = kanan untuk belok kanan, kiri untuk belok kiri.
    const ax = -dz / dl;
    const az = dx / dl;
    const half = TIE_ACROSS / 2;
    let inner = half;
    if (turn !== 0) {
      // Potong ujung dalam di garis bagi sudut (x + turn·z = 0) supaya bantalan kaki masuk & kaki
      // keluar tidak saling bersilang di sisi dalam belokan tajam.
      const f0 = x + turn * z;
      const df = turn * (ax + turn * az);
      if (df * f0 < 0) inner = Math.min(half, Math.max(0.05, -f0 / df - 0.03));
    }
    const len = half + inner;
    const off = ((inner - half) / 2) * turn;
    const tie = cbox(TIE_ALONG, TIE_H, len, WOOD, 0, 0, 0, 0.01);
    tie.applyMatrix4(_m.makeRotationY(Math.atan2(-dz, dx)));
    tie.translate(x + ax * off, BED_H + TIE_H / 2, z + az * off);
    parts.push(tie);
  }
  const m = new Mesher();
  // Alas tanah selebar 2·BED yang ikut melengkung (tanpa sudut persegi yang menonjol di belokan).
  bar(m, tileLine(turn, -BED), tileLine(turn, BED), 0, BED_H, new THREE.Color(soil));
  const steel = new THREE.Color(STEEL);
  for (const side of [-1, 1]) {
    bar(m, tileLine(turn, side * RAIL_O - RAIL_W / 2), tileLine(turn, side * RAIL_O + RAIL_W / 2), BED_H + TIE_H, RAIL_TOP, steel);
  }
  parts.push(m.geometry());
  return mergeFlat(parts);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface Tile {
  key: number;
  /** 0 = lurus, 1 = belok kanan, 2 = belok kiri (indeks mesh). */
  type: number;
  x: number;
  z: number;
  rot: number;
  /** Kecerahan pelat (variasi kecil per ubin). */
  shade: number;
  anim: { kind: 'move' | 'drop' | 'leave'; t: number; fx: number; fz: number; frot: number } | null;
}

function toTile(t: RailTile): Tile {
  const h = Math.sin(t.cell * 91.7) * 43758.5453;
  return {
    key: t.cell,
    type: t.turn === 0 ? 0 : t.turn > 0 ? 1 : 2,
    x: t.x,
    z: t.z,
    rot: tileRotation(t.dir),
    shade: 0.94 + (h - Math.floor(h)) * 0.1,
    anim: null,
  };
}

export class RailView {
  readonly group = new THREE.Group();
  private track: TrackPath;
  private readonly geos: THREE.BufferGeometry[];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private tiles: Tile[] = [];
  private dirty = true;

  /** Dipanggil saat ubin mendarat (untuk debu). */
  onLand: ((x: number, z: number) => void) | null = null;

  constructor(rail: Rail, soil: string) {
    this.track = rail.track;
    this.geos = [tileGeometry(0, soil), tileGeometry(1, soil), tileGeometry(-1, soil)];
    for (let i = 0; i < 3; i++) this.meshes.push(this.makeMesh(i, 64));
    this.setRail(rail, false);
  }

  get length(): number {
    return this.track.length;
  }

  private makeMesh(type: number, cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geos[type], SHARED.vertexStd, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  /** Ganti rel; dengan `animate`, ubin yang berubah melompat ke tempat barunya. */
  setRail(rail: Rail, animate = true): void {
    this.track = rail.track;
    const next = rail.tiles.map(toTile);
    this.dirty = true;
    if (!animate) {
      this.tiles = next;
      return;
    }
    const old = new Map<number, Tile>();
    for (const t of this.tiles) if (!t.anim || t.anim.kind !== 'leave') old.set(t.key, t);
    const result: Tile[] = [];
    const added: Tile[] = [];
    for (const n of next) {
      const o = old.get(n.key);
      if (o && o.type === n.type && Math.abs(lerpAngle(o.rot, n.rot, 1) - o.rot) < 1e-3) {
        result.push(o);
        old.delete(n.key);
      } else added.push(n);
    }
    const removed = [...old.values()];
    const used = new Set<Tile>();
    added.forEach((a, k) => {
      let best: Tile | null = null;
      let bestD = PAIR_MAX;
      for (const r of removed) {
        if (used.has(r)) continue;
        const d = Math.hypot(r.x - a.x, r.z - a.z);
        if (d < bestD) {
          bestD = d;
          best = r;
        }
      }
      if (best) {
        used.add(best);
        a.anim = { kind: 'move', t: -k * STAGGER, fx: best.x, fz: best.z, frot: best.rot };
      } else a.anim = { kind: 'drop', t: -k * STAGGER, fx: a.x, fz: a.z, frot: a.rot };
      result.push(a);
    });
    for (const r of removed) {
      if (used.has(r)) continue;
      r.anim = { kind: 'leave', t: 0, fx: r.x, fz: r.z, frot: r.rot };
      result.push(r);
    }
    this.tiles = result;
  }

  pointAt(d: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.track.pointAt(d);
    return out.set(p.x, 0, p.z);
  }

  tangentAt(d: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.track.tangentAt(d);
    return out.set(t.x, 0, t.z);
  }

  update(dt: number): void {
    let active = false;
    for (const t of this.tiles) {
      if (!t.anim) continue;
      const before = t.anim.t;
      t.anim.t += dt;
      if (t.anim.kind !== 'leave' && before < FLIGHT && t.anim.t >= FLIGHT) this.onLand?.(t.x, t.z);
      active = true;
    }
    if (!active && !this.dirty) return;
    this.tiles = this.tiles.filter((t) => {
      if (!t.anim) return true;
      if (t.anim.kind === 'leave') return t.anim.t < FLIGHT;
      if (t.anim.t >= FLIGHT + SQUASH) t.anim = null;
      return true;
    });
    this.write();
    this.dirty = false;
  }

  private write(): void {
    const counts = [0, 0, 0];
    for (const t of this.tiles) counts[t.type]++;
    counts.forEach((n, i) => {
      if (this.meshes[i].instanceMatrix.count < n) {
        this.group.remove(this.meshes[i]);
        this.meshes[i].dispose();
        this.meshes[i] = this.makeMesh(i, Math.ceil(n * 1.4));
      }
    });
    const slot = [0, 0, 0];
    for (const t of this.tiles) {
      const mesh = this.meshes[t.type];
      const k = slot[t.type]++;
      let x = t.x;
      let z = t.z;
      let y = 0;
      let rot = t.rot;
      let tilt = 0;
      let sy = 1;
      let sxz = 1;
      const a = t.anim;
      if (a) {
        const f = Math.min(1, Math.max(0, a.t / FLIGHT));
        const e = easeInOut(f);
        if (a.kind === 'move') {
          x = a.fx + (t.x - a.fx) * e;
          z = a.fz + (t.z - a.fz) * e;
          rot = lerpAngle(a.frot, t.rot, e);
          y = Math.sin(f * Math.PI) * HOP_H;
          tilt = Math.sin(f * Math.PI) * 0.35;
        } else if (a.kind === 'drop') {
          y = (1 - e) * DROP_H;
          // Belum gilirannya jatuh: belum terlihat.
          sxz = sy = a.t < 0 ? 0.001 : 0.4 + 0.6 * e;
        } else {
          y = Math.sin(f * Math.PI * 0.5) * HOP_H;
          sxz = sy = 1 - e;
          tilt = f * 0.6;
        }
        // Mendarat: memantul pendek (pipih lalu kembali).
        if (a.kind !== 'leave' && a.t > FLIGHT) {
          const l = Math.sin(Math.min(1, (a.t - FLIGHT) / SQUASH) * Math.PI);
          sy *= 1 - 0.3 * l;
          sxz *= 1 + 0.1 * l;
        }
      }
      _p.set(x, y, z);
      _e.set(tilt, rot, 0, 'YXZ');
      _q.setFromEuler(_e);
      _s.set(sxz, Math.max(0.001, sy), sxz);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, _c.setScalar(t.shade));
    }
    this.meshes.forEach((m, i) => {
      m.count = slot[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.meshes) m.dispose();
  }
}
