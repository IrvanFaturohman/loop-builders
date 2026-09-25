import * as THREE from 'three';
import type { RailItem, Resource } from '../game/types';
import { itemGeometry } from './items';
import { SHARED } from './palette';
import { RAIL_TOP, type RailView } from './railView';

/**
 * Tumpukan bahan di rel (state.railItems): balok kecil yang jatuh dari pemotong saat gerbong
 * muatan penuh. Satu InstancedMesh per jenis bahan; posisi dibaca dari state tiap frame (ikut
 * rel yang berubah). Item yang baru jatuh disembunyikan selama efek terbangnya, lalu mendarat
 * dengan pantulan kecil. Item yang berdekatan di rel menumpuk ke atas.
 */

const RESOURCES: Resource[] = ['wood', 'stone', 'gem'];
const SCALE = 0.6;
/** Lama item terbang dari pohon ke rel (sama dengan efek fly di World). */
export const DROP_FLY = 0.3;
const LAND = 0.22;
/** Lebar "kolom" tumpukan sepanjang rel. */
const BIN = 0.32;
const LAYER = 0.08;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();

export class RailItemsView {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<Resource, THREE.InstancedMesh>();
  /** Waktu jatuh tiap item (item dari save tidak punya: langsung terlihat). */
  private readonly born = new WeakMap<RailItem, number>();
  private readonly jitter = new WeakMap<RailItem, [number, number, number]>();
  private time = 0;

  constructor() {
    for (const r of RESOURCES) this.meshes.set(r, this.makeMesh(r, 32));
  }

  private makeMesh(r: Resource, cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(itemGeometry(r), SHARED.vertexStd, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    this.group.add(m);
    return m;
  }

  /** Item baru jatuh (efek terbangnya sedang berjalan). */
  dropped(item: RailItem): void {
    this.born.set(item, this.time);
  }

  /** Titik dunia tempat item mendarat (untuk tujuan efek terbang). */
  landing(item: RailItem, track: RailView, out: THREE.Vector3): THREE.Vector3 {
    return track.pointAt(item.d, out).setY(RAIL_TOP + 0.05);
  }

  update(dt: number, items: readonly RailItem[], track: RailView): void {
    this.time += dt;
    const counts = new Map<Resource, number>(RESOURCES.map((r) => [r, 0]));
    for (const it of items) counts.set(it.res, (counts.get(it.res) ?? 0) + 1);
    for (const r of RESOURCES) {
      const m = this.meshes.get(r)!;
      if (m.instanceMatrix.count < counts.get(r)!) {
        this.group.remove(m);
        m.dispose();
        this.meshes.set(r, this.makeMesh(r, Math.ceil(counts.get(r)! * 1.5)));
      }
    }
    const slot = new Map<Resource, number>(RESOURCES.map((r) => [r, 0]));
    const stack = new Map<number, number>();
    for (const it of items) {
      const b = this.born.get(it);
      const age = b === undefined ? 99 : this.time - b;
      const bin = Math.floor(it.d / BIN);
      const layer = stack.get(bin) ?? 0;
      stack.set(bin, layer + 1);
      let j = this.jitter.get(it);
      if (!j) {
        j = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
        this.jitter.set(it, j);
      }
      track.pointAt(it.d, _p);
      track.tangentAt(it.d, _t);
      // Sedikit acak menyamping & berputar supaya terlihat seperti tumpukan, bukan barisan.
      _p.x += -_t.z * j[0] * 0.3;
      _p.z += _t.x * j[0] * 0.3;
      _p.y = RAIL_TOP + 0.04 + layer * LAYER;
      let s = SCALE;
      if (age < DROP_FLY) s = 0.0001;
      else if (age < DROP_FLY + LAND) {
        const k = (age - DROP_FLY) / LAND;
        _p.y += Math.sin(k * Math.PI) * 0.12;
        s *= 1 + Math.sin(k * Math.PI) * 0.15;
      }
      _e.set(0, Math.atan2(-_t.z, _t.x) + Math.PI / 2 + j[1] * 0.9, j[2] * 0.2);
      _q.setFromEuler(_e);
      _s.setScalar(s);
      _m.compose(_p, _q, _s);
      const m = this.meshes.get(it.res)!;
      const k = slot.get(it.res)!;
      m.setMatrixAt(k, _m);
      slot.set(it.res, k + 1);
    }
    for (const r of RESOURCES) {
      const m = this.meshes.get(r)!;
      m.count = slot.get(r)!;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
  }
}
