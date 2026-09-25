import * as THREE from 'three';
import { deliveryRoute } from '../game/layout';
import type { TruckTrip, Vec2 } from '../game/types';
import { cbox, ccyl, mergeFlat } from './geom';
import { itemGeometry, type ItemKind } from './items';
import { SHARED } from './palette';

/**
 * Truk pengantar bahan, digambar dari state.trucks (logikanya di sim.ts): berangkat dari
 * penyimpanan stasiun membawa balok, menyusuri jalan kota ke bangunan, membongkar, lalu kembali
 * dengan bak kosong. Posisi = jarak tempuh `s` sepanjang deliveryRoute (pulang = rute dibalik).
 */

/** Jarak ke kanan dari garis tengah jalan (lajur kiri-kanan). */
const LANE = 0.1;
/** Panjang "pantulan" saat membongkar (satuan jarak tempuh setelah tiba). */
const UNLOAD_BOUNCE = 0.5;
const CAB_COLORS = ['#ff5a5f', '#3d9bff', '#ffcf3a', '#2fbf71', '#ff8a3d', '#9b6bff'];

function truckGeometry(cab: string): THREE.BufferGeometry {
  const wheel = (x: number, z: number) => ccyl(0.075, 0.06, '#2b313c', 10, x, 0.075, z, Math.PI / 2, 0, 0, '#9aa1ab');
  return mergeFlat([
    cbox(0.72, 0.08, 0.34, '#4b5563', 0, 0.12, 0, 0.02),
    cbox(0.24, 0.24, 0.32, cab, 0.22, 0.28, 0, 0.05),
    cbox(0.05, 0.12, 0.26, '#bfe6ff', 0.345, 0.32, 0, 0.01),
    cbox(0.44, 0.03, 0.34, '#8a929e', -0.12, 0.175, 0, 0.01),
    cbox(0.44, 0.1, 0.03, cab, -0.12, 0.23, 0.155, 0.01),
    cbox(0.44, 0.1, 0.03, cab, -0.12, 0.23, -0.155, 0.01),
    cbox(0.03, 0.1, 0.34, cab, -0.33, 0.23, 0, 0.01),
    wheel(0.22, 0.17),
    wheel(0.22, -0.17),
    wheel(-0.2, 0.17),
    wheel(-0.2, -0.17),
  ]);
}

interface Route {
  pts: Vec2[];
  cum: number[];
}

interface View {
  group: THREE.Group;
  cargo: THREE.Group;
  heading: number;
  fresh: boolean;
}

export class TruckFleet {
  readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[];
  private readonly itemGeo: THREE.BufferGeometry;
  private readonly views = new Map<TruckTrip, View>();
  private readonly routes = new Map<string, Route>();
  private next = 0;

  constructor(
    private readonly levelIndex: number,
    item: ItemKind,
  ) {
    this.geos = CAB_COLORS.map(truckGeometry);
    this.itemGeo = itemGeometry(item);
  }

  private route(trip: TruckTrip): Route {
    const key = `${trip.plot}|${trip.startZ}`;
    let r = this.routes.get(key);
    if (!r) {
      const pts = deliveryRoute(this.levelIndex, trip.plot, { x: 0, z: trip.startZ });
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      r = { pts, cum };
      this.routes.set(key, r);
    }
    return r;
  }

  private create(): View {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.geos[this.next++ % this.geos.length], SHARED.vertexStd);
    body.castShadow = true;
    const cargo = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.itemGeo, SHARED.vertexStd);
      m.position.set(-0.12 + (i - 1) * 0.13, 0.26 + (i === 1 ? 0.08 : 0), 0);
      m.rotation.y = Math.PI / 2;
      m.scale.setScalar(0.55);
      cargo.add(m);
    }
    group.add(body, cargo);
    this.group.add(group);
    return { group, cargo, heading: 0, fresh: true };
  }

  /** Sinkronkan truk dengan state (dipanggil tiap frame). */
  update(dt: number, trips: readonly TruckTrip[]): void {
    const turn = 1 - Math.exp(-dt * 14);
    for (const [trip, v] of this.views) {
      if (!trips.includes(trip)) {
        this.group.remove(v.group);
        this.views.delete(trip);
      }
    }
    for (const trip of trips) {
      let v = this.views.get(trip);
      if (!v) {
        v = this.create();
        this.views.set(trip, v);
      }
      const r = this.route(trip);
      const going = trip.s < trip.length;
      const s = Math.min(trip.length, going ? trip.s : 2 * trip.length - trip.s);
      const dir = going ? 1 : -1;
      const { pts, cum } = r;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const u = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
      const a = pts[i - 1];
      const b = pts[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const dx = ((b.x - a.x) / l) * dir;
      const dz = ((b.z - a.z) / l) * dir;
      const h = Math.atan2(-dz, dx);
      if (v.fresh) {
        v.heading = h;
        v.fresh = false;
      } else {
        let d = h - v.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        v.heading += d * turn;
      }
      // Lajur kanan arah jalan.
      v.group.position.set(a.x + (b.x - a.x) * u - dz * LANE, 0, a.z + (b.z - a.z) * u + dx * LANE);
      v.group.rotation.y = v.heading;
      v.cargo.visible = trip.load > 0;
      // Pantulan kecil sesaat setelah membongkar di depan bangunan.
      const after = trip.s - trip.length;
      const k = after > 0 && after < UNLOAD_BOUNCE ? Math.sin((after / UNLOAD_BOUNCE) * Math.PI) : 0;
      v.group.scale.set(1 + k * 0.06, 1 - k * 0.1, 1 + k * 0.06);
    }
  }

  dispose(): void {
    for (const v of this.views.values()) this.group.remove(v.group);
    this.views.clear();
    for (const g of this.geos) g.dispose();
  }
}
