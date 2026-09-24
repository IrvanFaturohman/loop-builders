import * as THREE from 'three';
import { bandStart, districtCount, RAIL_CLEAR, ringPath } from '../game/layout';
import { depthAt, type Rail } from '../game/rail';
import { fieldFor } from '../game/worldgen';
import type { LevelDefinition } from '../game/types';
import { ccyl, mergeFlat } from './geom';
import { SHARED } from './palette';

/** Jarak tepi tanah kota dari garis tengah rel (sedikit di dalam koridor rel). */
const EDGE = RAIL_CLEAR + 0.05;
/** Jalan lingkar di celah antar distrik (di dalam bekas rel lama). */
const STREET_IN = 0.78;
const STREET_W = 0.42;
const PAVE = '#eadcc2';

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8fd16a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#84c85f';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.repeat.set(0.5, 0.5);
  return t;
}

/** Pita datar selebar w mengikuti cincin pada offset tertentu. */
function ringStrip(level: LevelDefinition, offset: number, w: number, y: number): THREE.BufferGeometry {
  const path = ringPath(level, offset);
  const n = Math.max(16, Math.ceil(path.length / 0.25));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * path.length;
    const p = path.pointAt(d % path.length);
    const o = path.outwardAt(d % path.length);
    pos.push(p.x - (o.x * w) / 2, y, p.z - (o.z * w) / 2, p.x + (o.x * w) / 2, y, p.z + (o.z * w) / 2);
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Tanah kota: rumput yang menutupi seluruh lahan di dalam rel (ikut tumbuh setiap rel maju),
 * jalan lingkar di celah antar distrik yang sudah seluruhnya di dalam rel, jalan utama dari
 * alun-alun ke stasiun, dan air mancur di tengah. Hanya tampilan — kavling dari layout.ts.
 */
export class CityView {
  readonly group = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly streets = new THREE.Group();
  private readonly avenue: THREE.Mesh;
  private readonly paveMat = new THREE.MeshStandardMaterial({ color: PAVE, roughness: 1 });
  private streetCount = -1;
  private readonly water: THREE.Mesh;
  private time = 0;

  constructor(private readonly level: LevelDefinition, rail: Rail) {
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
    this.ground.receiveShadow = true;
    this.avenue = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.paveMat);
    this.avenue.rotation.x = -Math.PI / 2;
    this.avenue.receiveShadow = true;

    const fountain = new THREE.Mesh(
      mergeFlat([ccyl(0.62, 0.16, '#b9c0c9', 20, 0, 0.08, 0), ccyl(0.16, 0.5, '#d7dde4', 10, 0, 0.3, 0), ccyl(0.3, 0.06, '#b9c0c9', 14, 0, 0.5, 0)]),
      SHARED.vertexStd,
    );
    fountain.castShadow = true;
    this.water = new THREE.Mesh(new THREE.CircleGeometry(0.54, 20), new THREE.MeshStandardMaterial({ color: '#6fc8ff', roughness: 0.2, metalness: 0.1 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.15;
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), this.paveMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.018;
    plaza.receiveShadow = true;

    this.group.add(this.ground, this.streets, this.avenue, plaza, fountain, this.water);
    this.ground.position.y = 0.008;
    this.setRail(rail);
  }

  /** Bangun ulang tanah mengikuti rel sekarang (dipanggil tiap rel maju). */
  setRail(rail: Rail): void {
    // Tanah: satu kotak per sel di belakang rel, tepinya lurus-siku seperti rel.
    const f = fieldFor(rail.levelIndex);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let c = 0; c < f.n; c++) {
      if (rail.depth[c] < 2) continue;
      const x0 = f.x[c] - 0.5;
      const z0 = f.z[c] - 0.5;
      const v = pos.length / 3;
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        pos.push(x0 + dx, 0, z0 + dz);
        uv.push((x0 + dx) * 0.5, (z0 + dz) * 0.5);
      }
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.ground.geometry.dispose();
    this.ground.geometry = geo;

    // Jalan lingkar distrik k muncul begitu seluruh cincinnya sudah di belakang rel.
    let n = 0;
    for (let k = 1; k < districtCount(this.level); k++) {
      const path = ringPath(this.level, bandStart(this.level, k - 1) - STREET_IN);
      const p = { x: 0, z: 0 };
      let ok = true;
      for (let d = 0; d < path.length && ok; d += 0.5) {
        path.pointAt(d, p);
        if (depthAt(rail, p.x, p.z) < 2) ok = false;
      }
      if (!ok) break;
      n = k;
    }
    if (n !== this.streetCount) {
      this.streetCount = n;
      for (const m of this.streets.children) (m as THREE.Mesh).geometry.dispose();
      this.streets.clear();
      for (let k = 1; k <= n; k++) {
        const m = new THREE.Mesh(ringStrip(this.level, bandStart(this.level, k - 1) - STREET_IN, STREET_W, 0.014), this.paveMat);
        m.receiveShadow = true;
        this.streets.add(m);
      }
    }

    // Jalan utama: alun-alun → stasiun (titik rel di jarak 0).
    const end = rail.track.pointAt(0).z - EDGE;
    const start = 0.7;
    this.avenue.scale.set(0.9, Math.max(0.1, end - start), 1);
    this.avenue.position.set(0, 0.016, (start + end) / 2);
  }

  update(dt: number): void {
    this.time += dt;
    this.water.position.y = 0.15 + Math.sin(this.time * 3) * 0.01;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    for (const m of this.streets.children) (m as THREE.Mesh).geometry.dispose();
  }
}
