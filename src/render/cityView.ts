import * as THREE from 'three';
import { RAIL_CLEAR, railOffset, ringPath, stationPoint } from '../game/layout';
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
 * Tanah kota: rumput yang menutupi seluruh lahan di dalam rel (tumbuh setiap rel melebar),
 * jalan lingkar di celah antar distrik, jalan utama dari alun-alun ke stasiun, dan air mancur
 * di tengah. Hanya tampilan — posisi kavling tetap dari layout.ts.
 */
export class CityView {
  readonly group = new THREE.Group();
  private readonly ground: THREE.Mesh;
  private readonly streets = new THREE.Group();
  private readonly avenue: THREE.Mesh;
  private readonly paveMat = new THREE.MeshStandardMaterial({ color: PAVE, roughness: 1 });
  private stage = 0;
  private pending = -1;
  private pendingT = 0;
  private grow = 1;
  private growFrom = 1;
  private readonly water: THREE.Mesh;
  private time = 0;

  constructor(private readonly level: LevelDefinition, stage: number) {
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
    this.build(stage);
  }

  /** Rel melebar ke `stage`: tanah & jalan baru dibangun setelah `delay` detik (menunggu morph rel). */
  setStage(stage: number, delay: number): void {
    if (stage === this.stage && this.pending < 0) return;
    this.pending = stage;
    this.pendingT = delay;
  }

  private groundHalf(stage: number): number {
    return this.level.ringStart + railOffset(this.level, stage) - EDGE;
  }

  private build(stage: number): void {
    const prevHalf = this.groundHalf(this.stage);
    this.stage = stage;
    // Tanah: cincin rel sekarang dikurangi koridor rel, diisi penuh.
    const path = ringPath(this.level, railOffset(this.level, stage) - EDGE);
    const pts: THREE.Vector2[] = [];
    for (let d = 0; d < path.length; d += 0.2) {
      const p = path.pointAt(d);
      pts.push(new THREE.Vector2(p.x, -p.z));
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
    geo.rotateX(-Math.PI / 2);
    this.ground.geometry.dispose();
    this.ground.geometry = geo;
    this.ground.position.y = 0.008;
    this.growFrom = prevHalf / this.groundHalf(stage);
    this.grow = this.growFrom < 1 ? 0 : 1;

    // Jalan lingkar di celah tiap distrik lama.
    for (const m of this.streets.children) (m as THREE.Mesh).geometry.dispose();
    this.streets.clear();
    for (let k = 1; k <= stage; k++) {
      const m = new THREE.Mesh(ringStrip(this.level, railOffset(this.level, k - 1) - STREET_IN, STREET_W, 0.014), this.paveMat);
      m.receiveShadow = true;
      this.streets.add(m);
    }

    // Jalan utama: alun-alun → stasiun.
    const end = stationPoint(this.level, stage).z - EDGE;
    const start = 0.7;
    this.avenue.scale.set(0.9, end - start, 1);
    this.avenue.position.set(0, 0.016, (start + end) / 2);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.pending >= 0) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) {
        this.build(this.pending);
        this.pending = -1;
      }
    }
    if (this.grow < 1) {
      this.grow = Math.min(1, this.grow + dt / 0.8);
      const e = 1 - Math.pow(1 - this.grow, 3);
      this.ground.scale.setScalar(this.growFrom + (1 - this.growFrom) * e);
    } else this.ground.scale.setScalar(1);
    this.water.position.y = 0.15 + Math.sin(this.time * 3) * 0.01;
  }

  dispose(): void {
    this.ground.geometry.dispose();
    for (const m of this.streets.children) (m as THREE.Mesh).geometry.dispose();
  }
}
