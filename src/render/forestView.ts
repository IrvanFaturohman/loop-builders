import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import type { BlockKind, GameState } from '../game/types';
import { isCellInside, type Rail } from '../game/rail';
import { fieldFor, KINDS, type Field } from '../game/worldgen';
import { cbox, ccyl, colored, mergeFlat, place } from './geom';
import { SHARED } from './palette';

/**
 * Hutan voxel: satu InstancedMesh per jenis blok (pohon hijau/kuning/merah, batu, kristal,
 * koin) + tunggul/puing. Hanya sel yang berubah (rusak, tumbang, tumbuh) yang di-update
 * matriksnya, jadi ribuan blok tetap ringan.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function treeGeo(canopy: string, dark: string): THREE.BufferGeometry {
  return mergeFlat([cbox(0.22, 0.5, 0.22, '#7a5230', 0, 0.25, 0, 0.03), cbox(0.9, 0.78, 0.9, canopy, 0, 0.82, 0, 0.1), cbox(0.62, 0.36, 0.62, dark, 0.05, 1.28, -0.04, 0.08)]);
}

function kindGeometry(kind: BlockKind): THREE.BufferGeometry {
  switch (kind) {
    case 'tree':
      return treeGeo('#5cbf4a', '#6ccf58');
    case 'treeGold':
      return treeGeo('#f0bf2c', '#ffd24a');
    case 'treeRed':
      return treeGeo('#e0503f', '#f06a55');
    case 'rock':
      return mergeFlat([cbox(0.95, 0.42, 0.95, '#8e96a1', 0, 0.21, 0, 0.1), cbox(0.55, 0.26, 0.5, '#aab1bb', 0.12, 0.52, 0.06, 0.07)]);
    default:
      return mergeFlat([
        cbox(0.9, 0.3, 0.9, '#7d8590', 0, 0.15, 0, 0.08),
        place(colored(new THREE.ConeGeometry(0.2, 0.9, 5), '#ff3f5f'), 0, 0.72, 0),
        place(colored(new THREE.ConeGeometry(0.14, 0.62, 5), '#ff7a8f'), 0.24, 0.58, 0.1, 0, 0, -0.35),
        place(colored(new THREE.ConeGeometry(0.13, 0.55, 5), '#e8284c'), -0.22, 0.55, -0.08, 0.3, 0, 0.35),
      ]);
  }
}

interface CellAnim {
  t: number;
  kind: 'hit' | 'fall' | 'pop';
}

export class ForestView {
  readonly group = new THREE.Group();
  private readonly field: Field;
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** sel → indeks instance di mesh jenisnya */
  private readonly slot: Int32Array;
  private readonly stumps: THREE.InstancedMesh;
  private readonly stumpSlot: Int32Array;
  private readonly lastHp: Float32Array;
  private readonly jitter: Float32Array;
  private readonly anims = new Map<number, CellAnim>();
  private readonly dirty = new Set<number>();
  private first = true;
  /** Sel yang sudah di belakang rel (lahan kota): tunggulnya disembunyikan. */
  private inside: Uint8Array;

  constructor(levelIndex: number, soilColor: string) {
    const f = fieldFor(levelIndex);
    this.field = f;
    this.slot = new Int32Array(f.n).fill(-1);
    this.stumpSlot = new Int32Array(f.n).fill(-1);
    this.lastHp = new Float32Array(f.n).fill(NaN);
    this.jitter = new Float32Array(f.n * 3);
    this.inside = new Uint8Array(f.n);

    // Tanah hutan (cokelat) — terlihat di sela pohon & bekas tebangan.
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(f.half * 2 + 1, f.half * 2 + 1), new THREE.MeshStandardMaterial({ color: soilColor, roughness: 1 }));
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.004;
    soil.receiveShadow = true;
    this.group.add(soil);

    const counts = KINDS.map(() => 0);
    let stumpCount = 0;
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      this.slot[c] = counts[f.kind[c]]++;
      this.stumpSlot[c] = stumpCount++;
      // Blok tersusun rapi dalam baris: tanpa geser, rotasi kelipatan 90°, variasi skala kecil.
      const h = Math.sin(c * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      this.jitter[c * 3] = 0;
      this.jitter[c * 3 + 1] = Math.floor(r * 4) * (Math.PI / 2);
      this.jitter[c * 3 + 2] = 0.92 + ((r * 7.3) % 1) * 0.12;
    }
    KINDS.forEach((k, i) => {
      const mesh = new THREE.InstancedMesh(kindGeometry(k), SHARED.vertexStd, Math.max(1, counts[i]));
      mesh.count = counts[i];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, counts[i]) * 3), 3);
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    const stumpGeo = mergeFlat([ccyl(0.16, 0.2, '#7a5230', 8, 0, 0.1, 0, 0, 0, 0, '#d9b27a'), cbox(0.3, 0.05, 0.1, '#6b4a2b', 0.12, 0.03, 0.06, 0.01)]);
    this.stumps = new THREE.InstancedMesh(stumpGeo, SHARED.vertexStd, Math.max(1, stumpCount));
    this.stumps.count = stumpCount;
    this.stumps.frustumCulled = false;
    this.stumps.receiveShadow = true;
    this.stumps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, stumpCount) * 3), 3);
    this.group.add(this.stumps);

    // Warna: variasi kecerahan per blok; tunggul batu = abu-abu.
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      const v = 0.88 + ((this.jitter[c * 3 + 2] - 0.9) / 0.2) * 0.24;
      this.meshes[f.kind[c]].setColorAt(this.slot[c], _c.setRGB(v, v, v));
      const isTree = KINDS[f.kind[c]].startsWith('tree');
      this.stumps.setColorAt(this.stumpSlot[c], isTree ? _c.setRGB(1, 1, 1) : _c.set('#9aa1ab'));
    }
  }

  /** Posisi dunia pusat sebuah sel (untuk efek). */
  cellPos(c: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.field.x[c], 0.6, this.field.z[c]);
  }

  private writeCell(c: number, state: GameState): void {
    const f = this.field;
    const k = f.kind[c];
    if (k < 0) return;
    const hp = state.blocks[c];
    const max = BALANCE.blocks[KINDS[k]].hp;
    const anim = this.anims.get(c);
    const jx = this.jitter[c * 3];
    const rot = this.jitter[c * 3 + 1];
    const js = this.jitter[c * 3 + 2];
    let scale = 0;
    let tilt = 0;
    let sink = 0;
    if (hp > 0) {
      scale = js;
      if (anim?.kind === 'hit') {
        const s = Math.sin(anim.t * 40) * anim.t * 0.35;
        tilt = s;
        scale *= 1 - anim.t * 0.08;
      } else if (anim?.kind === 'pop') {
        const k2 = 1 - anim.t / 0.35;
        scale *= Math.max(0.05, 1 + Math.sin(k2 * Math.PI) * 0.18) * Math.min(1, 0.4 + k2);
      }
      scale *= 0.82 + 0.18 * Math.min(1, hp / max);
    } else if (hp === 0) {
      if (anim?.kind === 'fall') {
        const k2 = anim.t / 0.3; // 1 → 0
        scale = js * k2;
        tilt = (1 - k2) * 1.1;
        sink = (1 - k2) * 0.3;
      }
    }
    _p.set(f.x[c] + jx, -sink, f.z[c] - jx * 0.6);
    _e.set(tilt * 0.6, rot, tilt);
    _q.setFromEuler(_e);
    _s.setScalar(Math.max(0.0001, scale));
    _m.compose(_p, _q, _s);
    this.meshes[k].setMatrixAt(this.slot[c], _m);
    this.meshes[k].instanceMatrix.needsUpdate = true;
    // tunggul terlihat saat blok sudah ditebang (dan tunas masih kecil)
    // Tunggul hilang begitu lahannya menjadi kota (pita di dalam rel sekarang).
    const stump = hp === 0 && !this.inside[c] && !(anim?.kind === 'fall' && anim.t > 0.2);
    _p.set(f.x[c] + jx, 0, f.z[c] - jx * 0.6);
    _q.setFromAxisAngle(_s.set(0, 1, 0), rot);
    _s.setScalar(stump ? js : 0.0001);
    _m.compose(_p, _q, _s);
    this.stumps.setMatrixAt(this.stumpSlot[c], _m);
    this.stumps.instanceMatrix.needsUpdate = true;
  }

  /**
   * Sinkron dengan state: bandingkan HP tiap sel dengan frame lalu, mulai animasi
   * kena gerinda / tumbang, dan tulis ulang hanya sel yang berubah.
   */
  update(dt: number, state: GameState): number[] {
    const f = this.field;
    const felled: number[] = [];
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      const hp = state.blocks[c];
      const prev = this.lastHp[c];
      if (this.first) {
        this.lastHp[c] = hp;
        this.dirty.add(c);
        continue;
      }
      if (hp !== prev) {
        if (hp > 0 && prev > hp) this.anims.set(c, { t: 0.25, kind: 'hit' });
        else if (hp === 0 && prev > 0) {
          this.anims.set(c, { t: 0.3, kind: 'fall' });
          felled.push(c);
        } else if (hp > 0 && prev <= 0) this.anims.set(c, { t: 0.35, kind: 'pop' });
        this.lastHp[c] = hp;
        this.dirty.add(c);
      }
    }
    this.first = false;
    for (const [c, a] of this.anims) {
      a.t -= dt;
      this.dirty.add(c);
      if (a.t <= 0) this.anims.delete(c);
    }
    for (const c of this.dirty) this.writeCell(c, state);
    this.dirty.clear();
    return felled;
  }

  /** Dipanggil World tiap rel maju: tunggul yang kini di belakang rel menghilang. */
  setRail(rail: Rail): void {
    const f = this.field;
    for (let c = 0; c < f.n; c++) {
      if (f.kind[c] < 0) continue;
      const v = isCellInside(rail, c) ? 1 : 0;
      if (v !== this.inside[c]) {
        this.inside[c] = v;
        this.dirty.add(c);
      }
    }
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.stumps.geometry.dispose();
  }
}
